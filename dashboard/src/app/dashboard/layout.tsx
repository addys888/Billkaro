'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { isLoggedIn, getUser, clearToken, apiFetch } from '@/lib/api';
import { getInitials } from '@/lib/utils';
import { LayoutDashboard, FileText, Users, Settings, LogOut, Sun, Moon, ChevronDown, ShieldCheck, Menu, X } from 'lucide-react';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<any>(null);
  const [isDark, setIsDark] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Initialize Theme and User
  useEffect(() => {
    if (!isLoggedIn()) {
      router.push('/login');
      return;
    }
    
    // Fetch fresh profile with subscription details
    apiFetch<{user: any}>('/api/auth/me')
      .then(res => {
        setUser(res.user);
      })
      .catch(() => {
        setUser(getUser()); // Fallback to cache if API fails
      });

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

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  const handleLogout = () => {
    clearToken();
    router.push('/login');
  };

  if (!user) return null;

  const navItems = [
    { href: '/dashboard', label: 'Overview', icon: <LayoutDashboard size={18} /> },
    { href: '/dashboard/invoices', label: 'Invoices', icon: <FileText size={18} /> },
    { href: '/dashboard/clients', label: 'Clients', icon: <Users size={18} /> },
    { href: '/dashboard/settings', label: 'Settings', icon: <Settings size={18} /> },
  ];

  if (user?.role === 'admin') {
    navItems.push({ href: '/dashboard/admin', label: 'Admin', icon: <ShieldCheck size={18} /> });
  }

  return (
    <div className="layout">
      {/* Background Glow */}
      <div className="glass-glow"></div>

      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand" style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '18px', fontWeight: 'bold' }}>
          <div style={{ background: '#22c55e', color: '#fff', borderRadius: '4px', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', fontSize: '18px' }}>
            B
          </div>
          BillKaro
          {/* Close button on mobile */}
          <button
            className="sidebar-close-btn"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            <X size={20} />
          </button>
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
          <div className="sidebar-user-info">
            <div className="user-avatar" style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', color: 'white', fontSize: '0.875rem' }}>
              {getInitials(user?.businessName || 'BK')}
            </div>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'white' }}>{user?.businessName || 'My Business'}</div>
              <div style={{ fontSize: '11px', color: '#64748b' }}>{user?.phone ? `+${user.phone}` : ''}</div>
            </div>
          </div>
          <button
            className="btn btn-outline btn-sm"
            style={{ width: '100%', display: 'flex', justifyContent: 'center', color: 'var(--color-text-muted)', borderColor: 'var(--color-border)', marginTop: '12px' }}
            onClick={handleLogout}
            id="logout-btn"
          >
            <LogOut size={16} /> Logout
          </button>
        </div>
      </aside>

      {/* Mobile Bottom Nav */}
      <nav className="mobile-bottom-nav">
        {navItems.slice(0, 4).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`mobile-nav-item ${pathname === item.href ? 'active' : ''}`}
          >
            {item.icon}
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>

      <main className="main-content" style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <header className="top-header">
          <style>{`
            @keyframes pulse-red {
              0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); }
              70% { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); }
              100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
            }
          `}</style>

          {/* Hamburger for mobile */}
          <button
            className="hamburger-btn"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle menu"
          >
            <Menu size={22} />
          </button>

          {/* Mobile Brand */}
          <div className="mobile-brand">
            <div style={{ background: '#22c55e', color: '#fff', borderRadius: '4px', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace', fontSize: '15px', fontWeight: 'bold' }}>
              B
            </div>
            <span style={{ fontWeight: 700, fontSize: '16px' }}>BillKaro</span>
          </div>

          <div className="header-right">
            {user?.subscription && (
              <div className="subscription-badge">
                {['919452661608', '919082573335'].includes(user.phone) ? (
                  <div className="sub-pill sub-admin">
                    🛡️ <span className="sub-text-full">Super Admin: Lifetime Access</span><span className="sub-text-short">Admin</span>
                  </div>
                ) : (
                  <>
                    <div 
                      className={`sub-pill ${user.subscription.daysRemaining <= 7 ? 'sub-expiring' : 'sub-active'}`}
                      style={{ animation: user.subscription.daysRemaining <= 7 ? 'pulse-red 2s infinite' : 'none' }}
                    >
                      {user.subscription.daysRemaining <= 7 ? '⚠️' : '💎'} 
                      <span className="sub-text-full">
                        {user.subscription.daysRemaining <= 7 ? 'Expiring Soon:' : 'Active Plan:'} {user.subscription.daysRemaining} Days Left
                      </span>
                      <span className="sub-text-short">{user.subscription.daysRemaining}d</span>
                    </div>

                    {user.subscription.daysRemaining <= 3 && (
                      <button 
                        className="btn btn-primary btn-sm"
                        style={{ height: '32px', fontSize: '11px', padding: '0 12px' }}
                        onClick={() => {
                          const msg = `Hi, my BillKaro subscription is expiring in ${user.subscription.daysRemaining} days. I want to renew! (ID: ${user.id})`;
                          window.open(`https://wa.me/919452661608?text=${encodeURIComponent(msg)}`, '_blank');
                        }}
                      >
                        Renew
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Theme Toggle */}
            <button
              onClick={() => setIsDark(!isDark)}
              className="theme-toggle-btn"
              aria-label="Toggle Dark Mode"
            >
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            {/* User Profile Area — hidden on mobile (shown in sidebar) */}
            <div className="header-user-info">
              <div className="user-avatar" style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--color-primary-50)', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                {getInitials(user?.businessName || 'BK')}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text)' }}>{user?.businessName || 'My Business'}</span>
                <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>{user?.phone ? `+${user.phone}` : ''}</span>
              </div>
            </div>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="page-content">
          {children}
        </div>
      </main>
    </div>
  );
}
