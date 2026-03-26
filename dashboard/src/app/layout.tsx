import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BillKaro — WhatsApp-First Smart Invoicing',
  description: 'Generate GST invoices via WhatsApp, collect payments automatically, and track your business finances.',
  keywords: ['invoice', 'WhatsApp', 'GST', 'billing', 'India', 'SME', 'payment collection'],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
