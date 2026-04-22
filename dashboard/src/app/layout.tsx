import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BillKaro — WhatsApp-First Smart Invoicing',
  description: 'Generate GST invoices via WhatsApp, collect payments automatically, and track your business finances.',
  keywords: ['invoice', 'WhatsApp', 'GST', 'billing', 'India', 'SME', 'payment collection'],
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '32x32', type: 'image/x-icon' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  manifest: '/manifest.json',
  themeColor: '#1e3a8a',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'BillKaro',
  },
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
