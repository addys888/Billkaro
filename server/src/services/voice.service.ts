import OpenAI from 'openai';
import { config } from '../config';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });

/**
 * Transcribe a voice note buffer (OGG/MP3/WAV) to text using Whisper API
 */
export async function transcribeVoiceNote(audioBuffer: Buffer, mimeType: string = 'audio/ogg'): Promise<string | null> {
  const tmpDir = os.tmpdir();
  const ext = getExtensionFromMime(mimeType);
  const tmpPath = path.join(tmpDir, `billkaro_voice_${Date.now()}.${ext}`);

  try {
    // Write buffer to temp file (Whisper API requires a file)
    fs.writeFileSync(tmpPath, audioBuffer);

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: config.OPENAI_WHISPER_MODEL,
      language: 'hi', // Hindi primary, Whisper auto-detects mixed
      response_format: 'text',
      prompt: 'This is an invoice or billing request. Common words: bill, invoice, paisa, rupees, hazaar, lakh, install, repair, service, payment.',
    });

    const text = typeof transcription === 'string' ? transcription : transcription.toString();

    if (!text || text.trim().length === 0) {
      logger.warn('Whisper returned empty transcription');
      return null;
    }

    logger.info('Voice note transcribed', { text: text.substring(0, 100) });
    return text.trim();
  } catch (error) {
    logger.error('Voice transcription failed', { error });
    return null;
  } finally {
    // Cleanup temp file
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

function getExtensionFromMime(mimeType: string): string {
  const mimeMap: Record<string, string> = {
    'audio/ogg': 'ogg',
    'audio/opus': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
  };
  return mimeMap[mimeType] || 'ogg';
}
