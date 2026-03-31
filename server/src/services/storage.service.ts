import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config';
import { logger } from '../utils/logger';

// Initialize S3-compatible client for Cloudflare R2
// Only created when R2 credentials are configured
let s3Client: S3Client | null = null;

function getS3Client(): S3Client | null {
  if (s3Client) return s3Client;

  if (!config.S3_ENDPOINT || !config.S3_ACCESS_KEY || !config.S3_SECRET_KEY) {
    return null; // R2 not configured — fall back to local storage
  }

  s3Client = new S3Client({
    region: config.S3_REGION || 'auto',
    endpoint: config.S3_ENDPOINT,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY,
      secretAccessKey: config.S3_SECRET_KEY,
    },
    // R2 requires this for S3 compatibility
    forcePathStyle: true,
  });

  return s3Client;
}

/**
 * Upload a file to Cloudflare R2
 * Returns the public URL of the uploaded file
 */
export async function uploadToR2(
  buffer: Buffer,
  key: string,
  contentType: string = 'application/pdf'
): Promise<string> {
  const client = getS3Client();

  if (!client) {
    // R2 not configured — save locally (dev mode)
    return saveLocally(buffer, key);
  }

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: config.S3_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    );

    const publicUrl = config.S3_PUBLIC_URL
      ? `${config.S3_PUBLIC_URL}/${key}`
      : `${config.S3_ENDPOINT}/${config.S3_BUCKET}/${key}`;

    logger.info('File uploaded to R2', { key, size: buffer.length, url: publicUrl });
    return publicUrl;
  } catch (error: any) {
    logger.error('R2 upload failed, falling back to local', {
      key,
      errorMessage: error?.message,
    });
    // Fall back to local storage if R2 fails
    return saveLocally(buffer, key);
  }
}

/**
 * Download a file from R2
 * Returns the file buffer
 */
export async function downloadFromR2(key: string): Promise<Buffer> {
  const client = getS3Client();

  if (!client) {
    // R2 not configured — read from local
    return readLocally(key);
  }

  try {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: config.S3_BUCKET,
        Key: key,
      })
    );

    const chunks: Uint8Array[] = [];
    const stream = response.Body as any;
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (error: any) {
    logger.error('R2 download failed, trying local', {
      key,
      errorMessage: error?.message,
    });
    return readLocally(key);
  }
}

/**
 * Check if a file URL is a remote URL (R2/CDN) or local path
 */
export function isRemoteUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

/**
 * Get the PDF buffer from either R2 URL or local path
 */
export async function getPDFBuffer(pdfUrl: string): Promise<Buffer> {
  if (isRemoteUrl(pdfUrl)) {
    // Fetch from R2/CDN
    const response = await fetch(pdfUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch PDF from ${pdfUrl}: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // Local file — extract filename from path like /invoices/BK-2026-0001.pdf
  const filename = pdfUrl.split('/').pop() || '';
  return readLocally(filename);
}

// ── Local storage helpers (dev mode fallback) ───────────────

import * as fs from 'fs';
import * as path from 'path';

function getLocalDir(): string {
  const dir = path.join(process.cwd(), 'tmp', 'invoices');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function saveLocally(buffer: Buffer, key: string): string {
  const filename = key.includes('/') ? key.split('/').pop()! : key;
  const filepath = path.join(getLocalDir(), filename);
  fs.writeFileSync(filepath, buffer);
  return `/invoices/${filename}`;
}

function readLocally(key: string): Buffer {
  const filename = key.includes('/') ? key.split('/').pop()! : key;
  const filepath = path.join(getLocalDir(), filename);
  return fs.readFileSync(filepath);
}
