'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { isLoggedIn, getUser, clearToken } from '@/lib/api';
import { getInitials } from '@/lib/utils';
import { LayoutDashboard, FileText, Users, Settings, LogOut, Sun, Moon, ChevronDown } from 'lucide-react';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<any>(null);
  const [isDark, setIsDark] = useState(true);

  // Initialize Theme and User
  useEffect(() => {
    if (!isLoggedIn()) {
      router.push('/login');
      return;
    }
    setUser(getUser());

    // Apply dark mode class on mount (default to true)
    document.documentElement.classList.add('dark');
  }, [router]);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  const handleLogout = () => {
    clearToken();
    router.push('/login');
  };

  const navItems = [
    { href: '/dashboard', label: 'Overview', icon: <LayoutDashboard size={18} /> },
    { href: '/dashboard/invoices', label: 'Invoices', icon: <FileText size={18} /> },
    { href: '/dashboard/clients', label: 'Clients', icon: <Users size={18} /> },
    { href: '/dashboard/settings', label: 'Settings', icon: <Settings size={18} /> },
  ];

  if (!user) return null;

  return (
    <div className="layout">
      {/* Background Glow */}
      <div className="glass-glow"></div>

      <aside className="sidebar">
        <div className="sidebar-brand" style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '18px', fontWeight: 'bold' }}>
          <div style={{ background: '#22c55e', color: '#fff', borderRadius: '4px', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', fontSize: '18px' }}>
            B
          </div>
          BillKaro
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar-link ${pathname === item.href ? 'active' : ''}`}
              style={{ display: 'flex', alignItems: 'center', gap: '12px' }}
            >
              <span style={{ opacity: pathname === item.href ? 1 : 0.6 }}>{item.icon}</span>
              <span style={{ fontWeight: pathname === item.href ? 600 : 400 }}>{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button
            className="btn btn-outline btn-sm"
            style={{ width: '100%', display: 'flex', justifyContent: 'center', color: 'var(--color-text-muted)', borderColor: 'var(--color-border)' }}
            onClick={handleLogout}
            id="logout-btn"
          >
            <LogOut size={16} /> Logout
          </button>
        </div>
      </aside>

      <main className="main-content" style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        {/* Top Header */}
        <header style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', padding: '16px 32px', gap: '20px', zIndex: 10 }}>
          {/* Period Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', padding: '6px 12px', borderRadius: 'var(--radius-full)', fontSize: '14px', cursor: 'pointer', color: 'var(--color-text-secondary)' }}>
            This Month <ChevronDown size={14} />
          </div>

          {/* Theme Toggle */}
          <button
            onClick={() => setIsDark(!isDark)}
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', width: '38px', height: '38px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--color-text-secondary)' }}
            aria-label="Toggle Dark Mode"
          >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>

          {/* User Profile Area */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div className="user-avatar" style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--color-primary-50)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
              {getInitials(user?.businessName || 'BK')}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text)' }}>{user?.businessName || 'My Business'}</span>
              <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>{user?.phone ? `+${user.phone}` : ''}</span>
            </div>
          </div>
        </header>

        {/* Scrollable Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 32px 32px 32px' }}>
          {children}
        </div>
      </main>
    </div>
  );
}
