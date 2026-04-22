import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { logger } from './utils/logger';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { startReminderWorker } from './services/reminder.service';
import { cleanupExpiredOTPs } from './services/auth.service';
import { prisma } from './db/prisma';
import { InvoiceStatus } from '@prisma/client';

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

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200, // 200 webhook hits per minute per IP (Meta sends bursts)
  standardHeaders: true,
  legacyHeaders: false,
});

const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30, // 30 admin API calls per minute per IP
  message: { success: false, error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Static Files (PDF invoices — dev only, R2 in production) ─
app.use('/invoices', express.static(path.join(__dirname, '..', 'tmp', 'invoices')));

// ── Health Check (with DB connectivity) ───────────────────
app.get('/health', async (_req, res) => {
  try {
    // Verify database is reachable
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      service: 'billkaro-api',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: config.NODE_ENV,
      db: 'connected',
    });
  } catch (err) {
    res.status(503).json({
      status: 'degraded',
      service: 'billkaro-api',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: config.NODE_ENV,
      db: 'disconnected',
    });
  }
});

// ── API Routes ────────────────────────────────────────────
app.use('/webhook', webhookLimiter, webhookRoutes);
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/admin', adminLimiter, adminRoutes);

// ── Error Handling ────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ── Start Server ──────────────────────────────────────────
const PORT = config.PORT;

const server = app.listen(PORT, () => {
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

  // Clean up expired OTPs every hour
  setInterval(async () => {
    try {
      await cleanupExpiredOTPs();
      logger.debug('🧹 Expired OTPs cleaned up');
    } catch (err) {
      logger.warn('OTP cleanup failed', { error: err });
    }
  }, 60 * 60 * 1000); // 1 hour

  // BUG #4 FIX: Auto-update overdue invoice statuses every hour
  // This ensures invoices are marked OVERDUE even without Redis/reminders
  setInterval(async () => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const result = await prisma.invoice.updateMany({
        where: {
          status: { in: [InvoiceStatus.PENDING, InvoiceStatus.PARTIALLY_PAID] },
          dueDate: { lt: today },
        },
        data: { status: InvoiceStatus.OVERDUE },
      });

      if (result.count > 0) {
        logger.info(`⏰ Marked ${result.count} invoices as OVERDUE`);
      }
    } catch (err) {
      logger.warn('Overdue status update failed', { error: err });
    }
  }, 60 * 60 * 1000); // 1 hour

  // Also run once at startup
  (async () => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const result = await prisma.invoice.updateMany({
        where: {
          status: { in: [InvoiceStatus.PENDING, InvoiceStatus.PARTIALLY_PAID] },
          dueDate: { lt: today },
        },
        data: { status: InvoiceStatus.OVERDUE },
      });
      if (result.count > 0) {
        logger.info(`⏰ Startup: Marked ${result.count} invoices as OVERDUE`);
      }
    } catch (err) {
      logger.warn('Startup overdue check failed', { error: err });
    }

    // ── One-time data fix: Rename business for admin account ──
    try {
      const updated = await prisma.user.updateMany({
        where: { phone: '919452661608', businessName: 'Mindzvue Technology LLP' },
        data: { businessName: 'BillKaro By CelerApps' },
      });
      if (updated.count > 0) {
        logger.info('✅ Renamed business: Mindzvue Technology LLP → BillKaro By CelerApps');
      }
    } catch (err) {
      logger.warn('Business name migration failed', { error: err });
    }
  })();
});

// ── Graceful Shutdown ─────────────────────────────────────
// Handles SIGTERM (Railway/Docker) and SIGINT (Ctrl+C)
// Ensures in-flight requests complete before exiting
function gracefulShutdown(signal: string) {
  logger.info(`${signal} received — shutting down gracefully...`);
  server.close(async () => {
    try {
      await prisma.$disconnect();
      logger.info('Database disconnected');
    } catch (err) {
      logger.warn('Error disconnecting database', { error: err });
    }
    logger.info('Server shut down cleanly');
    process.exit(0);
  });

  // Force shutdown after 10 seconds if graceful shutdown hangs
  setTimeout(() => {
    logger.warn('Forced shutdown after 10s timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;
