'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { ShieldCheck, Calendar, Phone, Briefcase, ChevronRight, Edit3 } from 'lucide-react';
import { formatDate } from '@/lib/utils';

export default function AdminPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ users: any[] }>('/api/admin/users');
      setUsers(res.users);
    } catch (error) {
      console.error('Failed to fetch users', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateSubscription = async (userId: string, daysToAdd: number) => {
    setUpdating(userId);
    try {
      await apiFetch(`/api/admin/users/${userId}/subscription`, {
        method: 'PATCH',
        body: JSON.stringify({ daysToAdd }),
      });
      await fetchUsers();
    } catch (error) {
      console.error('Failed to update subscription', error);
    } finally {
      setUpdating(null);
    }
  };

  return (
    <div className="admin-container">
      <header style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <div style={{ background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e', padding: '8px', borderRadius: '12px' }}>
            <ShieldCheck size={24} />
          </div>
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>Super Admin Panel</h1>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', margin: 0 }}>Manage platform users and their subscription access</p>
          </div>
        </div>
      </header>

      <div className="glass-card" style={{ padding: '0', overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '16px' }}>Registered Businesses</h3>
          <span style={{ fontSize: '12px', background: 'var(--color-primary-50)', color: 'var(--color-primary)', padding: '4px 10px', borderRadius: '12px', fontWeight: 600 }}>
            {users.length} Total Users
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                <th style={{ padding: '16px 24px', fontSize: '12px', textTransform: 'uppercase', color: 'var(--color-text-muted)', fontWeight: 600 }}>Business / Phone</th>
                <th style={{ padding: '16px 24px', fontSize: '12px', textTransform: 'uppercase', color: 'var(--color-text-muted)', fontWeight: 600 }}>Subscription</th>
                <th style={{ padding: '16px 24px', fontSize: '12px', textTransform: 'uppercase', color: 'var(--color-text-muted)', fontWeight: 600 }}>Expires At</th>
                <th style={{ padding: '16px 24px', fontSize: '12px', textTransform: 'uppercase', color: 'var(--color-text-muted)', fontWeight: 600 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} style={{ padding: '48px', textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading users...</td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: '48px', textAlign: 'center', color: 'var(--color-text-muted)' }}>No users found</td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id} style={{ borderBottom: '1px solid var(--color-border)', transition: 'background 0.2s' }} className="hover-row">
                    <td style={{ padding: '16px 24px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '36px', height: '36px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-primary)' }}>
                          <Briefcase size={18} />
                        </div>
                        <div>
                          <div style={{ fontSize: '14px', fontWeight: 600 }}>{u.businessName}</div>
                          <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Phone size={10} /> +{u.phone}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '16px 24px' }}>
                      <span style={{ 
                        fontSize: '11px', 
                        padding: '3px 8px', 
                        borderRadius: '6px', 
                        background: u.subscriptionStatus === 'active' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                        color: u.subscriptionStatus === 'active' ? '#22c55e' : '#ef4444',
                        fontWeight: 600,
                        textTransform: 'uppercase'
                      }}>
                        {u.subscriptionPlan}
                      </span>
                    </td>
                    <td style={{ padding: '16px 24px' }}>
                      <div style={{ fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Calendar size={14} style={{ opacity: 0.5 }} />
                        {u.subscriptionExpiresAt ? formatDate(u.subscriptionExpiresAt) : 'Never'}
                      </div>
                    </td>
                    <td style={{ padding: '16px 24px' }}>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button 
                          className="btn btn-primary btn-sm"
                          disabled={updating === u.id}
                          onClick={() => handleUpdateSubscription(u.id, 365)}
                          style={{ padding: '4px 12px', fontSize: '12px' }}
                        >
                          {updating === u.id ? '...' : '+1 Year'}
                        </button>
                        <button 
                          className="btn btn-outline btn-sm"
                          disabled={updating === u.id}
                          onClick={() => handleUpdateSubscription(u.id, 14)}
                          style={{ padding: '4px 12px', fontSize: '12px' }}
                        >
                          +14 Days
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <style jsx>{`
        .admin-container {
          max-width: 1200px;
          margin: 0 auto;
        }
        .hover-row:hover {
          background: rgba(255, 255, 255, 0.02);
        }
      `}</style>
    </div>
  );
}
