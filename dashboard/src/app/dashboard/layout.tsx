'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { isLoggedIn, getUser, clearToken } from '@/lib/api';
import { getInitials } from '@/lib/utils';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    if (!isLoggedIn()) {
      router.push('/login');
      return;
    }
    setUser(getUser());
  }, [router]);

  const handleLogout = () => {
    clearToken();
    router.push('/login');
  };

  const navItems = [
    { href: '/dashboard', label: 'Overview', icon: '📊' },
    { href: '/dashboard/invoices', label: 'Invoices', icon: '📋' },
    { href: '/dashboard/clients', label: 'Clients', icon: '👥' },
  ];

  if (!user) return null;

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <h1>Bill<span>Karo</span></h1>
          <p>Smart Invoicing Dashboard</p>
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar-link ${pathname === item.href ? 'active' : ''}`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-avatar">
              {getInitials(user?.businessName || 'BK')}
            </div>
            <div>
              <div className="user-name">{user?.businessName || 'My Business'}</div>
              <div className="user-phone">{user?.phone ? `+${user.phone}` : ''}</div>
            </div>
          </div>
          <button
            className="btn btn-outline btn-sm"
            style={{ width: '100%', marginTop: '12px', color: '#94a3b8', borderColor: 'rgba(255,255,255,0.1)' }}
            onClick={handleLogout}
            id="logout-btn"
          >
            🚪 Logout
          </button>
        </div>
      </aside>

      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
