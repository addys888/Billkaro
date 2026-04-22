import IORedis from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Shared Redis connection singleton
 * Used by session-manager and reminder-service to avoid duplicate connections
 */
let sharedRedis: IORedis | null = null;
let connectionFailed = false;

export function getRedisConnection(): IORedis | null {
  // If we already know Redis isn't available, don't retry
  if (connectionFailed) return null;

  if (sharedRedis) return sharedRedis;

  if (!config.REDIS_URL) {
    connectionFailed = true;
    return null;
  }

  try {
    sharedRedis = new IORedis(config.REDIS_URL, {
      maxRetriesPerRequest: null, // Required for BullMQ compatibility
      retryStrategy: (times: number) => {
        if (times > 2) {
          connectionFailed = true;
          return null; // Stop retrying
        }
        return Math.min(times * 100, 1000);
      },
      lazyConnect: true,
    });

    sharedRedis.connect().catch((err: any) => {
      logger.warn('Redis not available — sessions will use DB-only mode', { error: err.message });
      sharedRedis = null;
      connectionFailed = true;
    });

    return sharedRedis;
  } catch (err: any) {
    logger.warn('Redis initialization failed', { error: err.message });
    connectionFailed = true;
    return null;
  }
}
