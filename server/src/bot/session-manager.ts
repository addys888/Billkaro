import { prisma } from '../db/prisma';
import { PrismaClient } from '@prisma/client';
import { getRedisConnection } from '../db/redis';
import { logger } from '../utils/logger';

// Use shared Redis connection (singleton — no duplicate connections)
const redis = getRedisConnection();

const SESSION_TTL = 60 * 30; // 30 minutes
const SESSION_PREFIX = 'session:';

interface ConversationSession {
  currentFlow: string | null;
  currentStep: string | null;
  flowData: Record<string, any>;
}

/**
 * Get the current conversation session for a phone number
 */
export async function getSession(phone: string): Promise<ConversationSession> {
  // Try Redis first (fast) — only if available
  if (redis) {
    try {
      const cached = await redis.get(`${SESSION_PREFIX}${phone}`);
      if (cached) return JSON.parse(cached);
    } catch {
      // Redis unavailable, continue to DB
    }
  }

  // Fall back to database
  const state = await prisma.conversationState.findUnique({ where: { phone } });
  if (state) {
    const session: ConversationSession = {
      currentFlow: state.currentFlow,
      currentStep: state.currentStep,
      flowData: state.flowData as Record<string, any>,
    };
    // Cache in Redis if available
    if (redis) {
      try {
        await redis.setex(`${SESSION_PREFIX}${phone}`, SESSION_TTL, JSON.stringify(session));
      } catch { /* ignore */ }
    }
    return session;
  }

  // No session exists
  return { currentFlow: null, currentStep: null, flowData: {} };
}

/**
 * Update the conversation session
 */
export async function updateSession(
  phone: string,
  updates: Partial<ConversationSession>
): Promise<void> {
  const current = await getSession(phone);
  const updated = { ...current, ...updates };

  // Update Redis if available
  if (redis) {
    try {
      await redis.setex(`${SESSION_PREFIX}${phone}`, SESSION_TTL, JSON.stringify(updated));
    } catch { /* ignore */ }
  }

  // Update database
  await prisma.conversationState.upsert({
    where: { phone },
    create: {
      phone,
      currentFlow: updated.currentFlow,
      currentStep: updated.currentStep,
      flowData: updated.flowData,
    },
    update: {
      currentFlow: updated.currentFlow,
      currentStep: updated.currentStep,
      flowData: updated.flowData,
    },
  });
}

/**
 * Clear the conversation session (flow complete)
 */
export async function clearSession(phone: string): Promise<void> {
  if (redis) {
    try {
      await redis.del(`${SESSION_PREFIX}${phone}`);
    } catch { /* ignore */ }
  }
  await prisma.conversationState.upsert({
    where: { phone },
    create: { phone, currentFlow: null, currentStep: null, flowData: {} },
    update: { currentFlow: null, currentStep: null, flowData: {} },
  });
}
