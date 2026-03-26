// ── Invoice Constants ───────────────────────────────────────
export const INVOICE_PREFIX = 'BK';
export const FINANCIAL_YEAR_START_MONTH = 3; // April (0-indexed)

// ── GST Rates ───────────────────────────────────────────────
export const GST_RATES = [0, 5, 12, 18, 28] as const;
export const DEFAULT_GST_RATE = 18;

// ── Reminder Intervals (in days after due date) ────────────
export const REMINDER_SCHEDULE = {
  DUE_DATE: 0,
  FOLLOW_UP_1: 3,
  FOLLOW_UP_2: 7,
  ESCALATION: 15,
} as const;

// ── Business Hours (IST) ───────────────────────────────────
export const BUSINESS_HOURS = {
  START: 9,  // 9 AM IST
  END: 19,   // 7 PM IST
} as const;

// ── Indian National Holidays (2026) ────────────────────────
// Reminders will not be sent on these dates
export const HOLIDAYS_2026 = [
  '2026-01-26', // Republic Day
  '2026-03-10', // Holi
  '2026-03-30', // Eid ul-Fitr (tentative)
  '2026-04-02', // Ram Navami
  '2026-04-14', // Ambedkar Jayanti
  '2026-05-01', // May Day
  '2026-06-06', // Eid ul-Adha (tentative)
  '2026-07-06', // Muharram (tentative)
  '2026-08-15', // Independence Day
  '2026-09-04', // Milad un-Nabi (tentative)
  '2026-10-02', // Gandhi Jayanti
  '2026-10-13', // Dussehra
  '2026-11-02', // Diwali
  '2026-11-03', // Diwali (Day 2)
  '2026-11-04', // Bhai Dooj
  '2026-12-25', // Christmas
] as const;

// ── WhatsApp Button Limits ─────────────────────────────────
export const WA_MAX_BUTTONS = 3;
export const WA_MAX_BUTTON_TITLE_LENGTH = 20;

// ── Payment Score Thresholds ───────────────────────────────
export const PAYMENT_SCORE = {
  EXCELLENT: 5.0,    // Always pays on time
  GOOD: 4.0,         // Usually on time (< 3 days late)
  AVERAGE: 3.0,      // Sometimes late (3-7 days)
  BELOW_AVERAGE: 2.0, // Often late (7-15 days)
  POOR: 1.0,         // Frequently late (> 15 days)
} as const;

// ── Onboarding Steps ───────────────────────────────────────
export const ONBOARDING_STEPS = [
  'BUSINESS_NAME',
  'GSTIN',
  'UPI_ID',
  'PAYMENT_TERMS',
] as const;

// ── Bot Commands ───────────────────────────────────────────
export const BOT_COMMANDS = {
  HELP: ['help', 'madad', 'sahayata'],
  MARK_PAID: ['mark paid', 'paid', 'pay kar diya', 'payment ho gaya', 'paisa aa gaya'],
  PAUSE_REMINDERS: ['pause', 'band karo', 'reminders band', 'stop reminders'],
  RESUME_REMINDERS: ['resume', 'chalu karo', 'reminders chalu', 'start reminders'],
  LIST_PENDING: ['pending', 'due', 'baaki', 'kitna baaki'],
  CANCEL: ['cancel', 'nahi', 'no'],
} as const;
