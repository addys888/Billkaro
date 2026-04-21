import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { logger } from './utils/logger';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { startReminderWorker } from './services/reminder.service';
import { prisma } from './db/prisma';

// Routes
import webhookRoutes from './routes/webhook.routes';
import authRoutes from './routes/auth.routes';
import invoiceRoutes from './routes/invoice.routes';
import clientRoutes from './routes/client.routes';
import dashboardRoutes from './routes/dashboard.routes';
import adminRoutes from './routes/admin.routes';

const app = express();

// ── Security & Parsing ────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));

// CORS: Allow dashboard origin (production + dev)
const allowedOrigins = [config.DASHBOARD_URL];
if (config.NODE_ENV !== 'production') {
  allowedOrigins.push('http://localhost:3000');
}
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Rate Limiting ─────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 OTP requests per minute per IP
  message: { success: false, error: 'Too many OTP requests. Please wait a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Static Files (PDF invoices — dev only, R2 in production) ─
app.use('/invoices', express.static(path.join(__dirname, '..', 'tmp', 'invoices')));

// ── Health Check ──────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'billkaro-api',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.NODE_ENV,
  });
});

// ── One-time Seed Endpoint (remove after use) ─────────────
app.post('/api/seed-merchant', async (req, res) => {
  try {
    const { phone, businessName, secret } = req.body;

    // Simple secret protection
    if (secret !== 'billkaro-seed-2026') {
      res.status(403).json({ success: false, error: 'Invalid secret' });
      return;
    }

    if (!phone) {
      res.status(400).json({ success: false, error: 'Phone required' });
      return;
    }

    let normalizedPhone = phone.replace(/\D/g, '');
    if (!normalizedPhone.startsWith('91')) {
      normalizedPhone = `91${normalizedPhone}`;
    }

    // Check if exists
    const existing = await prisma.user.findUnique({ where: { phone: normalizedPhone } });
    if (existing) {
      res.json({ success: true, message: 'User already exists', userId: existing.id });
      return;
    }

    const user = await prisma.user.create({
      data: {
        phone: normalizedPhone,
        businessName: businessName || 'My Business',
        onboardingComplete: true,
        subscriptionStatus: 'active',
        subscriptionPlan: 'trial',
        subscriptionExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      },
    });

    res.json({ success: true, message: 'Merchant registered', userId: user.id });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ── API Routes ────────────────────────────────────────────
app.use('/webhook', webhookRoutes);
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/admin', adminRoutes);

// ── Error Handling ────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ── Start Server ──────────────────────────────────────────
const PORT = config.PORT;

app.listen(PORT, () => {
  logger.info(`🚀 BillKaro API running on port ${PORT}`);
  logger.info(`📝 Environment: ${config.NODE_ENV}`);
  logger.info(`🔗 Health check: ${config.APP_URL}/health`);

  // Start the reminder background worker
  try {
    startReminderWorker();
    logger.info('🔔 Reminder worker started');
  } catch (error) {
    logger.warn('⚠️ Reminder worker failed to start (Redis may not be available)', { error });
  }
});

export default app;
