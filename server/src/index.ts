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

  // Clean up expired OTPs every hour
  setInterval(async () => {
    try {
      await cleanupExpiredOTPs();
      logger.debug('🧹 Expired OTPs cleaned up');
    } catch (err) {
      logger.warn('OTP cleanup failed', { error: err });
    }
  }, 60 * 60 * 1000); // 1 hour
});

export default app;
