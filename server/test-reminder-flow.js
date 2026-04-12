/**
 * 🧪 Reminder Flow Simulator
 * 
 * This script simulates the complete reminder lifecycle for a partially-paid invoice
 * and shows exactly what WhatsApp messages would be sent at each stage.
 * 
 * Run: node test-reminder-flow.js
 */

// ── Simulated Invoice Data ─────────────────────────────────
const invoice = {
  invoiceNo: 'BK-MP-2604-0005',
  totalAmount: 10030,
  amountPaid: 5000,
  description: 'AC Repair + Installation',
  dueDate: new Date('2026-04-19'), // 7 days from now
  client: {
    name: 'Rahul Sharma',
    phone: '919888888888',
  },
  user: {
    businessName: 'Mindzvue Technology LLP',
    phone: '919452661608',
    upiId: '9452661608@ybl',
  },
  paymentLink: 'upi://pay?pa=9452661608@ybl&pn=Mindzvue&am=5030',
};

const balanceDue = invoice.totalAmount - invoice.amountPaid;

// ── Helper ─────────────────────────────────────────────────
function formatCurrency(n) {
  return '₹' + n.toLocaleString('en-IN');
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDate(date) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${date.getDate().toString().padStart(2,'0')}-${months[date.getMonth()]}-${date.getFullYear()}`;
}

// ── Reminder Schedule ──────────────────────────────────────
const SCHEDULE = [
  { type: 'DUE_DATE',    daysAfter: 0,  label: 'Due Date Reminder' },
  { type: 'FOLLOW_UP_1', daysAfter: 3,  label: 'Follow-up #1' },
  { type: 'FOLLOW_UP_2', daysAfter: 7,  label: 'Follow-up #2 + Owner Alert' },
  { type: 'ESCALATION',  daysAfter: 15, label: 'Escalation (Owner Only)' },
];

const partialNote = invoice.amountPaid > 0
  ? `\n(${formatCurrency(invoice.amountPaid)} already received — thank you!)`
  : '';

console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('   🔔 BillKaro REMINDER FLOW SIMULATION');
console.log('═══════════════════════════════════════════════════════════');
console.log('');
console.log(`📄 Invoice: #${invoice.invoiceNo}`);
console.log(`👤 Client: ${invoice.client.name} (${invoice.client.phone})`);
console.log(`🏢 Business: ${invoice.user.businessName}`);
console.log(`💰 Total: ${formatCurrency(invoice.totalAmount)}`);
console.log(`💵 Paid: ${formatCurrency(invoice.amountPaid)}`);
console.log(`📊 Balance Due: ${formatCurrency(balanceDue)}`);
console.log(`📅 Due Date: ${formatDate(invoice.dueDate)}`);
console.log('');

// ── Timeline ───────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════');
console.log('   📅 REMINDER TIMELINE');
console.log('═══════════════════════════════════════════════════════════');
console.log('');

for (const r of SCHEDULE) {
  const date = addDays(invoice.dueDate, r.daysAfter);
  // Skip Sundays
  while (date.getDay() === 0) date.setDate(date.getDate() + 1);
  const dayLabel = r.daysAfter === 0 ? 'On due date' : `Due + ${r.daysAfter} days`;
  console.log(`  ${r.type === 'DUE_DATE' ? '🟢' : r.type === 'FOLLOW_UP_1' ? '🟡' : r.type === 'FOLLOW_UP_2' ? '🟠' : '🔴'} ${formatDate(date)} (${dayLabel}) — ${r.label}`);
  console.log(`     Sent at: 10:00 AM IST | Business hours: 9AM-7PM`);
  console.log('');
}

// ── Actual WhatsApp Messages ───────────────────────────────
console.log('═══════════════════════════════════════════════════════════');
console.log('   📱 ACTUAL WHATSAPP MESSAGES');
console.log('═══════════════════════════════════════════════════════════');

// ── Message 1: Due Date ────────────────────────────────────
console.log('');
console.log('┌─────────────────────────────────────────────────────────┐');
console.log('│ 🟢 STAGE 1: DUE DATE REMINDER                          │');
console.log('│ 📅 Sent on: ' + formatDate(invoice.dueDate).padEnd(43) + '│');
console.log('│ 📤 To: CLIENT (' + invoice.client.phone + ')'.padEnd(37) + '│');
console.log('├─────────────────────────────────────────────────────────┤');
console.log('│                                                         │');

const msg1 = `Hi ${invoice.client.name} 🙏,

A friendly reminder that invoice #${invoice.invoiceNo} for ${formatCurrency(balanceDue)} (${invoice.description}) is due today.${partialNote}

💳 Quick Pay: ${invoice.paymentLink}

Thank you!
— ${invoice.user.businessName}`;

msg1.split('\n').forEach(line => {
  console.log('│  ' + line.padEnd(55) + '│');
});
console.log('│                                                         │');
console.log('└─────────────────────────────────────────────────────────┘');

// ── Message 2: Follow-up 1 (Day +3) ───────────────────────
console.log('');
console.log('┌─────────────────────────────────────────────────────────┐');
console.log('│ 🟡 STAGE 2: FOLLOW-UP #1 (3 days after due)            │');
console.log('│ 📅 Sent on: ' + formatDate(addDays(invoice.dueDate, 3)).padEnd(43) + '│');
console.log('│ 📤 To: CLIENT (' + invoice.client.phone + ')'.padEnd(37) + '│');
console.log('├─────────────────────────────────────────────────────────┤');
console.log('│                                                         │');

const msg2 = `Hi ${invoice.client.name},

Hope you're doing well! Just following up on invoice #${invoice.invoiceNo} — ${formatCurrency(balanceDue)} is pending.${partialNote}

Due date was: ${formatDate(invoice.dueDate)}

If already paid, please ignore this message 🙏
💳 Pay now: ${invoice.paymentLink}

— ${invoice.user.businessName}`;

msg2.split('\n').forEach(line => {
  console.log('│  ' + line.padEnd(55) + '│');
});
console.log('│                                                         │');
console.log('└─────────────────────────────────────────────────────────┘');

// ── Message 3: Follow-up 2 (Day +7) ───────────────────────
console.log('');
console.log('┌─────────────────────────────────────────────────────────┐');
console.log('│ 🟠 STAGE 3: FOLLOW-UP #2 (7 days overdue)              │');
console.log('│ 📅 Sent on: ' + formatDate(addDays(invoice.dueDate, 7)).padEnd(43) + '│');
console.log('│ 📤 To: CLIENT (' + invoice.client.phone + ')'.padEnd(37) + '│');
console.log('├─────────────────────────────────────────────────────────┤');
console.log('│                                                         │');

const msg3 = `Hi ${invoice.client.name},

This is a reminder that invoice #${invoice.invoiceNo} — ${formatCurrency(balanceDue)} is now 7 days overdue (due: ${formatDate(invoice.dueDate)}).${partialNote}

To avoid any inconvenience, kindly clear the payment at your earliest convenience.

💳 Pay now: ${invoice.paymentLink}
📞 Questions? Call ${invoice.user.phone}

— ${invoice.user.businessName}`;

msg3.split('\n').forEach(line => {
  console.log('│  ' + line.padEnd(55) + '│');
});
console.log('│                                                         │');
console.log('└─────────────────────────────────────────────────────────┘');

// Owner notification for stage 3
console.log('');
console.log('  ┌───────────────────────────────────────────────────────┐');
console.log('  │ 📣 OWNER NOTIFICATION (Stage 3)                       │');
console.log('  │ 📤 To: MERCHANT (' + invoice.user.phone + ')'.padEnd(35) + '│');
console.log('  ├───────────────────────────────────────────────────────┤');
console.log('  │                                                       │');
const ownerMsg3 = `⚠️ Invoice *#${invoice.invoiceNo}* — ${formatCurrency(balanceDue)} pending from ${invoice.client.name} is now 7 days overdue. Client has been sent a follow-up.`;
ownerMsg3.split('\n').forEach(line => {
  console.log('  │  ' + line.padEnd(53) + '│');
});
console.log('  │                                                       │');
console.log('  └───────────────────────────────────────────────────────┘');

// ── Message 4: Escalation (Day +15) ───────────────────────
console.log('');
console.log('┌─────────────────────────────────────────────────────────┐');
console.log('│ 🔴 STAGE 4: ESCALATION (15 days overdue)                │');
console.log('│ 📅 Sent on: ' + formatDate(addDays(invoice.dueDate, 15)).padEnd(43) + '│');
console.log('│ 📤 To: MERCHANT ONLY (' + invoice.user.phone + ')'.padEnd(33) + '│');
console.log('│ ⚠️  Client is NOT disturbed at this stage                │');
console.log('├─────────────────────────────────────────────────────────┤');
console.log('│                                                         │');

const msg4 = `⚠️ *Overdue Alert*

${invoice.client.name} has NOT paid invoice *#${invoice.invoiceNo}* — ${formatCurrency(balanceDue)} pending. It's now 15 days overdue.

What would you like to do?

  [📞 Call Client]
  [📤 Final Reminder]
  [⏸️ Pause]`;

msg4.split('\n').forEach(line => {
  console.log('│  ' + line.padEnd(55) + '│');
});
console.log('│                                                         │');
console.log('└─────────────────────────────────────────────────────────┘');

// ── Dashboard Status ───────────────────────────────────────
console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('   📊 DASHBOARD REMINDER TRACKING');
console.log('═══════════════════════════════════════════════════════════');
console.log('');
console.log('  ❌ Currently: NO reminder visibility in dashboard');
console.log('  ❌ No API endpoint to fetch reminder status');
console.log('  ❌ No way to see upcoming/sent/failed reminders');
console.log('');
console.log('  📋 Reminders ARE stored in the database:');
console.log('  ┌────────────────────────────────────────────────────────┐');
console.log('  │  Table: reminders                                      │');
console.log('  │  Fields: id, invoiceId, reminderType, scheduledAt,     │');
console.log('  │          sentAt, status, bullJobId                     │');
console.log('  │  Status: SCHEDULED | SENT | CANCELLED | PAUSED        │');
console.log('  └────────────────────────────────────────────────────────┘');
console.log('');
console.log('  💡 The data exists — just needs a dashboard UI + API!');
console.log('');

// ── What stops reminders ───────────────────────────────────
console.log('═══════════════════════════════════════════════════════════');
console.log('   🛑 WHAT STOPS REMINDERS');
console.log('═══════════════════════════════════════════════════════════');
console.log('');
console.log('  ✅ Invoice marked PAID → All reminders CANCELLED');
console.log('  ✅ Merchant types "Pause #0005" → Reminders PAUSED');
console.log('  ✅ Escalation button [⏸️ Pause] → Reminders CANCELLED');
console.log('  ✅ Partial payment does NOT stop reminders');
console.log('     (they continue for remaining balance)');
console.log('');

// ── Requirements ───────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════');
console.log('   ⚙️ REQUIREMENTS FOR REMINDERS TO WORK');
console.log('═══════════════════════════════════════════════════════════');
console.log('');
console.log('  1. Redis server must be running');
console.log('     REDIS_URL=redis://localhost:6379');
console.log('');
console.log('  2. BullMQ worker must be started');
console.log('     (startReminderWorker() called on server boot)');
console.log('');
console.log('  3. WhatsApp API credentials configured');
console.log('     (to actually send the messages)');
console.log('');
console.log('  Without Redis: Reminders saved to DB but NEVER fire.');
console.log('');
console.log('═══════════════════════════════════════════════════════════');
