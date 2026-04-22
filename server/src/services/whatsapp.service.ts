import { config } from '../config';
import { logger } from '../utils/logger';

const WA_API_BASE = `https://graph.facebook.com/${config.WHATSAPP_API_VERSION}/${config.WHATSAPP_PHONE_NUMBER_ID}`;

interface SendTextParams {
  to: string;
  text: string;
}

interface SendButtonParams {
  to: string;
  bodyText: string;
  buttons: Array<{ id: string; title: string }>;
}

interface SendMediaParams {
  to: string;
  type: 'document' | 'image';
  mediaUrl?: string;
  mediaId?: string;
  caption?: string;
  filename?: string;
}

/**
 * Send a plain text message via WhatsApp
 */
export async function sendTextMessage({ to, text }: SendTextParams): Promise<void> {
  await callWhatsAppAPI('/messages', {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text },
  });
}

/**
 * Send an interactive button message via WhatsApp
 */
export async function sendButtonMessage({ to, bodyText, buttons }: SendButtonParams): Promise<void> {
  if (buttons.length > 3) {
    throw new Error('WhatsApp allows a maximum of 3 buttons');
  }

  await callWhatsAppAPI('/messages', {
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: buttons.map((btn) => ({
          type: 'reply',
          reply: { id: btn.id, title: btn.title.substring(0, 20) },
        })),
      },
    },
  });
}

/**
 * Send a document (PDF) or image via WhatsApp
 */
export async function sendMediaMessage({ to, type, mediaUrl, mediaId, caption, filename }: SendMediaParams): Promise<void> {
  const mediaPayload: Record<string, string | undefined> = {};

  if (mediaId) {
    mediaPayload.id = mediaId;
  } else if (mediaUrl) {
    mediaPayload.link = mediaUrl;
  }

  if (caption) mediaPayload.caption = caption;
  if (filename) mediaPayload.filename = filename;

  await callWhatsAppAPI('/messages', {
    messaging_product: 'whatsapp',
    to,
    type,
    [type]: mediaPayload,
  });
}

/**
 * Send a template message (for outbound messages outside 24-hour window)
 */
export async function sendTemplateMessage(params: {
  to: string;
  templateName: string;
  languageCode?: string;
  components?: Array<{
    type: string;
    parameters: Array<{
      type: string;
      text?: string;
      document?: { id: string; filename?: string; link?: string };
      image?: { id?: string; link?: string };
    }>;
  }>;
}): Promise<void> {
  const { to, templateName, languageCode = 'en', components = [] } = params;

  await callWhatsAppAPI('/messages', {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components,
    },
  });
}

/**
 * Download media from WhatsApp (for voice notes, images)
 */
export async function downloadMedia(mediaId: string): Promise<Buffer> {
  // Step 1: Get media URL
  const mediaApiUrl = `https://graph.facebook.com/${config.WHATSAPP_API_VERSION}/${mediaId}`;
  const mediaInfo = await callWhatsAppAPI(mediaApiUrl, null, 'GET') as { url: string };

  // Step 2: Download the actual media
  const response = await fetch(mediaInfo.url, {
    headers: {
      Authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download media: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Upload media (PDF, image) to WhatsApp servers and get a media ID
 * This is needed because WhatsApp can't download from localhost URLs
 */
export async function uploadMedia(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<string> {
  const formData = new FormData();
  formData.append('messaging_product', 'whatsapp');
  formData.append('type', mimeType);
  formData.append('file', new Blob([buffer], { type: mimeType }), filename);

  const url = `${WA_API_BASE}/media`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}`,
      },
      body: formData,
    });

    const data = await response.json() as any;

    if (!response.ok) {
      logger.error('WhatsApp media upload failed', {
        status: response.status,
        errorData: JSON.stringify(data),
      });
      throw new Error(`Media upload failed (${response.status}): ${JSON.stringify(data)}`);
    }

    logger.info('Media uploaded to WhatsApp', { mediaId: data.id, filename });
    return data.id;
  } catch (error: any) {
    logger.error('WhatsApp media upload error', {
      filename,
      errorMessage: error?.message,
    });
    throw error;
  }
}

/**
 * Mark a message as read
 */
export async function markAsRead(messageId: string): Promise<void> {
  await callWhatsAppAPI('/messages', {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
  });
}

/**
 * Core API call helper
 */
async function callWhatsAppAPI(
  endpoint: string,
  body: Record<string, unknown> | null,
  method: string = 'POST'
): Promise<unknown> {
  const url = endpoint.startsWith('http')
    ? endpoint
    : `${WA_API_BASE}${endpoint}`;

  const options: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${config.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
  };

  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok) {
      logger.error('WhatsApp API error', {
        status: response.status,
        url,
        errorData: JSON.stringify(data),
        body: body ? JSON.stringify(body) : null
      });
      throw new Error(`WhatsApp API error (${response.status}): ${JSON.stringify(data)}`);
    }

    return data;
  } catch (error: any) {
    logger.error('WhatsApp API call failed', {
      endpoint,
      errorMessage: error?.message
    });
    throw error;
  }
}
