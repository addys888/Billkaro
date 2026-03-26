import { HOLIDAYS_2026, BUSINESS_HOURS } from '../config/constants';

const IST_OFFSET = 5.5 * 60 * 60 * 1000; // 5:30 hours in ms

/**
 * Get current time in IST
 */
export function nowIST(): Date {
  const utc = new Date();
  return new Date(utc.getTime() + IST_OFFSET);
}

/**
 * Format date as DD-MMM-YYYY (e.g., "26-Mar-2026")
 */
export function formatDateShort(date: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = date.getDate().toString().padStart(2, '0');
  const m = months[date.getMonth()];
  const y = date.getFullYear();
  return `${d}-${m}-${y}`;
}

/**
 * Format date as DD/MM/YYYY
 */
export function formatDateNumeric(date: Date): string {
  const d = date.getDate().toString().padStart(2, '0');
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

/**
 * Add days to a date
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Calculate days between two dates
 */
export function daysBetween(from: Date, to: Date): number {
  const diff = to.getTime() - from.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

/**
 * Check if a date is a Sunday
 */
export function isSunday(date: Date): boolean {
  return date.getDay() === 0;
}

/**
 * Check if a date is a national holiday
 */
export function isHoliday(date: Date): boolean {
  const dateStr = date.toISOString().split('T')[0];
  return (HOLIDAYS_2026 as readonly string[]).includes(dateStr);
}

/**
 * Check if current IST time is within business hours
 */
export function isBusinessHours(): boolean {
  const now = nowIST();
  const hour = now.getHours();
  return hour >= BUSINESS_HOURS.START && hour < BUSINESS_HOURS.END;
}

/**
 * Get the next valid business day (skips Sundays and holidays)
 */
export function getNextBusinessDay(date: Date): Date {
  let candidate = new Date(date);
  while (isSunday(candidate) || isHoliday(candidate)) {
    candidate = addDays(candidate, 1);
  }
  return candidate;
}

/**
 * Schedule a time at 10 AM IST on a given date (good for reminders)
 */
export function scheduleAt10AM(date: Date): Date {
  const scheduled = new Date(date);
  // Set to 10 AM IST (4:30 AM UTC)
  scheduled.setUTCHours(4, 30, 0, 0);
  return scheduled;
}

/**
 * Get the current Indian financial year string (e.g., "2025-26")
 */
export function getCurrentFinancialYear(): string {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed
  const year = now.getFullYear();

  if (month >= 3) {
    // April onwards = current year - next year
    return `${year}-${(year + 1).toString().slice(2)}`;
  } else {
    // Jan-Mar = previous year - current year
    return `${year - 1}-${year.toString().slice(2)}`;
  }
}

/**
 * Calculate due date from creation date and payment terms
 */
export function calculateDueDate(createdAt: Date, paymentTermsDays: number): Date {
  return addDays(createdAt, paymentTermsDays);
}
