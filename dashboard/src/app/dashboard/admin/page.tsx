'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { ShieldCheck, Calendar, Phone, TrendingUp, Users, FileText, Activity, Search } from 'lucide-react';
import { formatDate, formatCurrency, formatNumber } from '@/lib/utils';

export default function AdminPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);
  const [showModal, setShowModal] = useState<{ type: string; user: any; val?: any } | null>(null);

  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [userRes, statsRes] = await Promise.all([
        apiFetch<{ users: any[] }>('/api/admin/users'),
        apiFetch<{ stats: any }>('/api/admin/stats')
      ]);
      setUsers(userRes.users);
      setStats(statsRes.stats);
    } catch (error) {
      console.error('Failed to fetch admin data', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (userId: string, actionData: any) => {
    setUpdating(userId);
    setOpenDropdownId(null); // Close dropdown on action
    try {
      await apiFetch(`/api/admin/users/${userId}/subscription`, {
        method: 'PATCH',
        body: JSON.stringify(actionData),
      });
      await fetchData();
      setShowModal(null);
    } catch (error) {
      console.error('Action failed', error);
    } finally {
      setUpdating(null);
    }
  };

  const filteredUsers = users.filter(u => 
    u.businessName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.phone?.includes(searchTerm)
  );

  return (
    <div className="admin-container" onClick={() => setOpenDropdownId(null)}>
      <header style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <div style={{ background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e', padding: '8px', borderRadius: '12px' }}>
            <ShieldCheck size={24} />
          </div>
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>Super Admin Panel</h1>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', margin: 0 }}>Live platform stats and user management</p>
          </div>
        </div>
      </header>

      {/* Stats Cards */}
      <div className="grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '32px' }}>
        <div className="glass-card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e', padding: '10px', borderRadius: '10px' }}><TrendingUp size={20} /></div>
            <span style={{ fontSize: '12px', color: '#22c55e', fontWeight: 600 }}>Total Revenue</span>
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800 }}>{stats ? formatCurrency(stats.totalRevenue) : '...'}</div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '4px' }}>Platform Lifecycle</div>
        </div>
        <div className="glass-card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', padding: '10px', borderRadius: '10px' }}><Users size={20} /></div>
            <span style={{ fontSize: '12px', color: '#3b82f6', fontWeight: 600 }}>Total Users</span>
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800 }}>{stats ? formatNumber(stats.totalUsers) : '...'}</div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '4px' }}>{stats ? stats.activeUsers : '...'} Active Subscriptions</div>
        </div>
        <div className="glass-card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ background: 'rgba(168, 85, 247, 0.1)', color: '#a855f7', padding: '10px', borderRadius: '10px' }}><FileText size={20} /></div>
            <span style={{ fontSize: '12px', color: '#a855f7', fontWeight: 600 }}>Total Invoices</span>
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800 }}>{stats ? formatNumber(stats.totalInvoices) : '...'}</div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '4px' }}>Lifetime Generated</div>
        </div>
        <div className="glass-card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ background: 'rgba(249, 115, 22, 0.1)', color: '#f97316', padding: '10px', borderRadius: '10px' }}><Activity size={20} /></div>
            <span style={{ fontSize: '12px', color: '#f97316', fontWeight: 600 }}>Today's Activity</span>
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800 }}>{stats ? formatNumber(stats.dailyInvoices) : '...'}</div>
          <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '4px' }}>Invoices Created Today</div>
        </div>
      </div>

      <div className="glass-card" style={{ padding: '0', overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '20px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Business Management</h3>
          <div style={{ position: 'relative', flex: '1', maxWidth: '360px' }}>
            <input 
              type="text" 
              placeholder="Search by name or phone..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="form-input"
              style={{ paddingLeft: '40px', height: '42px', fontSize: '14px', width: '100%', background: 'rgba(255,255,255,0.03)' }}
              onClick={(e) => e.stopPropagation()}
            />
            <div style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }}>
              <Search size={18} />
            </div>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                <th style={{ padding: '16px 24px', fontSize: '12px', textTransform: 'uppercase', color: 'var(--color-text-muted)', fontWeight: 600 }}>Business</th>
                <th style={{ padding: '16px 24px', fontSize: '12px', textTransform: 'uppercase', color: 'var(--color-text-muted)', fontWeight: 600, width: '180px' }}>Plan / Status</th>
                <th style={{ padding: '16px 24px', fontSize: '12px', textTransform: 'uppercase', color: 'var(--color-text-muted)', fontWeight: 600, width: '150px' }}>Expiry</th>
                <th style={{ padding: '16px 24px', fontSize: '12px', textTransform: 'uppercase', color: 'var(--color-text-muted)', fontWeight: 600, textAlign: 'right', width: '220px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} style={{ padding: '48px', textAlign: 'center' }}>Loading platform data...</td></tr>
              ) : filteredUsers.length === 0 ? (
                <tr><td colSpan={4} style={{ padding: '48px', textAlign: 'center' }}>No matching businesses found</td></tr>
              ) : (
                filteredUsers.map((u) => (
                  <tr key={u.id} className="hover-row" style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '16px 24px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '36px', height: '36px', background: 'var(--color-surface)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: 'var(--color-primary)', border: '1px solid var(--color-border)' }}>
                          {u.businessName?.[0] || 'B'}
                        </div>
                        <div>
                          <div style={{ fontSize: '14px', fontWeight: 600 }}>{u.businessName}</div>
                          <div style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>+{u.phone}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '16px 24px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {['919452661608', '919082573335'].includes(u.phone) ? (
                          <span style={{ fontSize: '10px', fontWeight: 800, color: '#f59e0b', background: 'rgba(245, 158, 11, 0.1)', padding: '4px 8px', borderRadius: '6px', width: 'fit-content', border: '1px solid rgba(245, 158, 11, 0.2)' }}>SUPER ADMIN</span>
                        ) : (
                          <>
                            <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-primary)' }}>{u.subscriptionPlan}</span>
                            {u.isSuspended ? (
                              <span style={{ fontSize: '10px', color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)', padding: '2px 6px', borderRadius: '4px', width: 'fit-content' }}>Suspended</span>
                            ) : (
                              <span style={{ fontSize: '10px', color: '#22c55e', background: 'rgba(34, 197, 94, 0.1)', padding: '2px 6px', borderRadius: '4px', width: 'fit-content' }}>Active</span>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '16px 24px' }}>
                      {['919452661608', '919082573335'].includes(u.phone) ? (
                        <span style={{ fontSize: '12px', fontWeight: 700, color: '#22c55e', background: 'rgba(34, 197, 94, 0.1)', padding: '4px 10px', borderRadius: '6px', border: '1px solid rgba(34, 197, 94, 0.2)' }}>∞ Never Expires</span>
                      ) : (
                        <div style={{ fontSize: '13px' }}>{u.subscriptionExpiresAt ? formatDate(u.subscriptionExpiresAt) : 'N/A'}</div>
                      )}
                    </td>
                    <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', minHeight: '32px' }}>
                        {!['919452661608', '919082573335'].includes(u.phone) ? (
                          <>
                            <div className="action-dropdown-container">
                              <button 
                                className="btn btn-outline btn-sm" 
                                style={{ padding: '6px 10px' }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenDropdownId(openDropdownId === u.id ? null : u.id);
                                }}
                              >
                                Extend ▾
                              </button>
                              <div className="dropdown-menu" style={{ display: openDropdownId === u.id ? 'flex' : 'none' }}>
                                <button onClick={() => setShowModal({ type: 'extend', user: u, val: 1 })}>1 Month</button>
                                <button onClick={() => setShowModal({ type: 'extend', user: u, val: 3 })}>3 Months</button>
                                <button onClick={() => setShowModal({ type: 'extend', user: u, val: 6 })}>6 Months</button>
                                <button onClick={() => setShowModal({ type: 'extend', user: u, val: 12 })}>12 Months</button>
                              </div>
                            </div>
                            
                            <button 
                              onClick={() => setShowModal({ type: u.isSuspended ? 'reactivate' : 'suspend', user: u })}
                              className={`btn btn-sm ${u.isSuspended ? 'btn-success' : 'btn-danger'}`}
                              style={{ minWidth: '90px' }}
                            >
                              {u.isSuspended ? 'Reactivate' : 'Suspend'}
                            </button>
                          </>
                        ) : (
                          <span style={{ fontSize: '12px', color: 'var(--color-text-muted)', fontStyle: 'italic', paddingRight: '8px' }}>System Account</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="glass-card modal-content" style={{ maxWidth: '400px', width: '90%', textAlign: 'center', padding: '32px' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>
              {showModal.type === 'extend' ? '📅' : showModal.type === 'suspend' ? '⚠️' : '✅'}
            </div>
            <h2 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '12px' }}>
              {showModal.type === 'extend' ? `Extend Subscription` : showModal.type === 'suspend' ? 'Suspend Account' : 'Reactivate Account'}
            </h2>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '14px', marginBottom: '24px' }}>
              {showModal.type === 'extend' 
                ? `You are extending ${showModal.user.businessName}'s plan by ${showModal.val} months.`
                : showModal.type === 'suspend'
                  ? `This will immediately block ${showModal.user.businessName} from accessing the platform.`
                  : `This will restore access for ${showModal.user.businessName}.`
              }
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button className="btn btn-outline" onClick={() => setShowModal(null)}>Cancel</button>
              <button 
                className={`btn ${showModal.type === 'suspend' ? 'btn-danger' : 'btn-primary'}`}
                disabled={!!updating}
                onClick={() => {
                  if (showModal.type === 'extend') {
                    handleAction(showModal.user.id, { monthsToAdd: showModal.val });
                  } else {
                    handleAction(showModal.user.id, { isSuspended: showModal.type === 'suspend' });
                  }
                }}
              >
                {updating ? 'Processing...' : 'Confirm Action'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .admin-container { max-width: 1200px; margin: 0 auto; }
        .hover-row:hover { background: rgba(255, 255, 255, 0.02); }
        .modal-overlay {
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(0,0,0,0.8); backdrop-filter: blur(4px);
          display: flex; align-items: center; justify-content: center; z-index: 1000;
        }
        .action-dropdown-container { position: relative; }
        .dropdown-menu {
          position: absolute; right: 0; top: 100%;
          background: #121A12; border: 1px solid var(--color-border);
          border-radius: 12px; width: 160px; flex-direction: column;
          z-index: 50; box-shadow: 0 20px 40px rgba(0,0,0,0.6);
          padding: 6px; margin-top: 4px; border: 1px solid rgba(37, 211, 102, 0.2);
        }
        .dropdown-menu button {
          padding: 10px 14px; background: none; border: none; color: #E8E8F0;
          text-align: left; font-size: 13px; cursor: pointer; transition: all 0.2s;
          border-radius: 8px; width: 100%;
        }
        .dropdown-menu button:hover { background: rgba(37, 211, 102, 0.15); color: #25D366; }
        .btn-danger { background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); }
        .btn-danger:hover { background: #ef4444; color: white; }
      `}</style>
    </div>
  );
}
