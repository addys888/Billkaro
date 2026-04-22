'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';
import { formatCurrency, formatCompact } from '@/lib/utils';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

interface OverviewData {
  totalInvoiced: number;
  totalCollected: number;
  totalPending: number;
  totalOverdue: number;
  invoiceCount: number;
  paidCount: number;
  pendingCount: number;
  overdueCount: number;
  collectionRate: number;
  avgDaysToPay: number;
  overdueInvoices: Array<{
    id: string;
    invoiceNo: string;
    clientName: string;
    clientPhone: string | null;
    description: string;
    totalAmount: number;
    amountPaid: number;
    daysOverdue: number;
  }>;
}

interface TrendData {
  months: Array<{ month: string; invoiced: number; collected: number }>;
}

export default function DashboardPage() {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [trends, setTrends] = useState<TrendData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Default color palette for charts matching sleek UI
  const COLORS = ['#2ea043', '#f0883e', '#f85149'];

  useEffect(() => {
    loadData();
  }, []);

  // Auto-hide toast after 3 seconds
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [overviewData, trendsData] = await Promise.all([
        apiFetch<OverviewData>('/api/dashboard/overview?period=month'),
        apiFetch<TrendData>('/api/dashboard/trends?months=6'),
      ]);
      setOverview(overviewData);
      setTrends(trendsData);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSendReminder = async (invoiceId: string, invoiceNo: string) => {
    setActionLoading(`remind-${invoiceId}`);
    try {
      await apiFetch(`/api/invoices/${invoiceId}/resend`, { method: 'POST' });
      setToast({ message: `✅ Reminder sent for #${invoiceNo}`, type: 'success' });
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to send reminder', type: 'error' });
    } finally {
      setActionLoading(null);
    }
  };

  const handleMarkPaid = async (invoiceId: string, invoiceNo: string) => {
    if (!confirm(`Mark invoice #${invoiceNo} as fully paid?`)) return;
    setActionLoading(`paid-${invoiceId}`);
    try {
      await apiFetch(`/api/invoices/${invoiceId}/mark-paid`, {
        method: 'PATCH',
        body: JSON.stringify({ paymentMethod: 'manual' }),
      });
      setToast({ message: `✅ #${invoiceNo} marked as paid!`, type: 'success' });
      loadData(); // Refresh data
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to mark as paid', type: 'error' });
    } finally {
      setActionLoading(null);
    }
  };

  if (loading || !overview) {
    return (
      <div style={{ padding: '24px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '24px' }}>Loading Financial Overview...</h2>
        <div style={{ display: 'flex', gap: '24px' }}>
          {[1, 2, 3].map(n => <div key={n} style={{ flex: 1, height: '140px', background: 'var(--color-surface)', borderRadius: '12px', opacity: 0.5 }} />)}
        </div>
      </div>
    );
  }

  // Aging Chart data based on real overdue data
  const agingData = [
    { name: 'Current', value: Math.max(overview.totalPending - overview.totalOverdue, 0) || 0 },
    { name: '1-30d', value: overview.overdueInvoices.filter(i => i.daysOverdue <= 30).reduce((sum, i) => sum + (i.totalAmount - i.amountPaid), 0) || 0 },
    { name: '30d+', value: overview.overdueInvoices.filter(i => i.daysOverdue > 30).reduce((sum, i) => sum + (i.totalAmount - i.amountPaid), 0) || 0 },
  ];
  const agingTotal = agingData.reduce((s, d) => s + d.value, 0) || 1;

  return (
    <div>
      {/* Toast notification */}
      {toast && (
        <div style={{
          position: 'fixed', top: '20px', right: '20px', zIndex: 9999,
          padding: '14px 24px', borderRadius: '10px',
          background: toast.type === 'success' ? 'rgba(46, 160, 67, 0.95)' : 'rgba(248, 81, 73, 0.95)',
          color: '#fff', fontSize: '14px', fontWeight: 500,
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          animation: 'slideIn 0.3s ease-out',
          backdropFilter: 'blur(8px)',
        }}>
          {toast.message}
        </div>
      )}

      <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '24px' }}>
        Financial Overview
      </h2>

      {/* Primary KPI Cards (3 Cards) */}
      <div className="dashboard-kpi-grid" style={{ display: 'grid', gap: '24px', marginBottom: '32px' }}>
        {/* Total Invoiced */}
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '24px', textAlign: 'center' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
            Total Invoiced
          </div>
          <div style={{ fontSize: '32px', fontWeight: 800, color: '#c9d1d9', marginBottom: '4px' }}>
            {formatCurrency(overview.totalInvoiced)}
          </div>
          <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
            {overview.invoiceCount} invoices
          </div>
        </div>

        {/* Collected */}
        <div style={{ background: 'rgba(46, 160, 67, 0.05)', border: '1px solid rgba(46, 160, 67, 0.2)', borderRadius: '12px', padding: '24px', textAlign: 'center' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
            Collected
          </div>
          <div style={{ fontSize: '32px', fontWeight: 800, color: '#2ea043', marginBottom: '4px' }}>
            {formatCurrency(overview.totalCollected)}
          </div>
          <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
            {overview.paidCount} paid
          </div>
        </div>

        {/* Pending */}
        <div style={{ background: 'rgba(240, 136, 62, 0.05)', border: '1px solid rgba(240, 136, 62, 0.2)', borderRadius: '12px', padding: '24px', textAlign: 'center' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
            Pending
          </div>
          <div style={{ fontSize: '32px', fontWeight: 800, color: '#f0883e', marginBottom: '4px' }}>
            {formatCurrency(overview.totalPending)}
          </div>
          <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
            {overview.pendingCount} pending
          </div>
        </div>
      </div>

      {/* ── Enhanced Overdue / Action Center ── */}
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '24px', marginBottom: '24px' }}>
        
        {/* Header with overdue summary badge */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
              ⚡ Action Center
            </h3>
            {overview.overdueCount > 0 && (
              <span style={{
                background: 'rgba(248, 81, 73, 0.15)', color: '#f85149',
                fontSize: '12px', fontWeight: 600, padding: '4px 12px',
                borderRadius: '20px', border: '1px solid rgba(248, 81, 73, 0.3)',
              }}>
                {overview.overdueCount} overdue • {formatCurrency(overview.totalOverdue)}
              </span>
            )}
          </div>
          {overview.overdueInvoices.length > 0 && (() => {
            const remindable = overview.overdueInvoices.filter(inv => inv.clientPhone);
            return remindable.length > 0 ? (
              <button
                onClick={() => { remindable.forEach(inv => handleSendReminder(inv.id, inv.invoiceNo)); }}
                disabled={actionLoading !== null}
                style={{
                  background: 'linear-gradient(135deg, #f0883e, #f85149)',
                  color: '#fff', border: 'none', borderRadius: '8px',
                  padding: '8px 16px', fontSize: '12px', fontWeight: 600,
                  cursor: 'pointer', opacity: actionLoading ? 0.6 : 1,
                  transition: 'all 0.2s ease',
                }}
              >
                📢 Remind All ({remindable.length})
              </button>
            ) : null;
          })()}
        </div>

        {overview.overdueInvoices.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 24px', color: 'var(--color-text-muted)' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>🎉</div>
            <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '4px', color: 'var(--color-text-secondary)' }}>All caught up!</div>
            <div style={{ fontSize: '13px' }}>No overdue invoices. Nice work!</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <th style={{ padding: '12px', textAlign: 'left', color: 'var(--color-text-muted)', fontWeight: 500, whiteSpace: 'nowrap' }}>Client</th>
                  <th style={{ padding: '12px', textAlign: 'left', color: 'var(--color-text-muted)', fontWeight: 500, whiteSpace: 'nowrap' }}>Phone</th>
                  <th style={{ padding: '12px', textAlign: 'left', color: 'var(--color-text-muted)', fontWeight: 500, whiteSpace: 'nowrap' }}>Item</th>
                  <th style={{ padding: '12px', textAlign: 'right', color: 'var(--color-text-muted)', fontWeight: 500, whiteSpace: 'nowrap' }}>Amount Due</th>
                  <th style={{ padding: '12px', textAlign: 'center', color: 'var(--color-text-muted)', fontWeight: 500, whiteSpace: 'nowrap' }}>Overdue</th>
                  <th style={{ padding: '12px', textAlign: 'right', color: 'var(--color-text-muted)', fontWeight: 500, whiteSpace: 'nowrap' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {overview.overdueInvoices
                  .filter(inv => (inv.totalAmount - (inv.amountPaid || 0)) > 0) // Skip fully paid
                  .map((inv) => {
                  const balanceDue = inv.totalAmount - (inv.amountPaid || 0);
                  const hasPartialPayment = (inv.amountPaid || 0) > 0;
                  const severity = inv.daysOverdue > 14 ? 'critical' : inv.daysOverdue > 7 ? 'warning' : 'mild';
                  const severityColor = severity === 'critical' ? '#f85149' : severity === 'warning' ? '#f0883e' : '#d29922';
                  const severityBg = severity === 'critical' ? 'rgba(248,81,73,0.1)' : severity === 'warning' ? 'rgba(240,136,62,0.1)' : 'rgba(210,153,34,0.1)';
                  const hasPhone = !!inv.clientPhone;
                  
                  return (
                    <tr key={inv.id} style={{ borderBottom: '1px solid var(--color-border-light)', transition: 'background 0.2s' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      {/* Client Name */}
                      <td style={{ padding: '14px 12px', color: 'var(--color-text)', fontWeight: 500 }}>
                        {inv.clientName}
                      </td>
                      
                      {/* Client Phone */}
                      <td style={{ padding: '14px 12px' }}>
                        {hasPhone ? (
                          <span style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>
                            {inv.clientPhone!.startsWith('91') ? '+' + inv.clientPhone!.slice(0, 2) + ' ' + inv.clientPhone!.slice(2) : inv.clientPhone}
                          </span>
                        ) : (
                          <span style={{ color: '#f85149', fontSize: '11px', fontStyle: 'italic' }}>No phone</span>
                        )}
                      </td>
                      
                      {/* Description / Item */}
                      <td style={{ padding: '14px 12px', maxWidth: '160px' }}>
                        <span style={{ color: 'var(--color-text-secondary)', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}
                          title={inv.description}
                        >
                          {inv.description || '—'}
                        </span>
                      </td>
                      
                      {/* Amount Due — single clear column */}
                      <td style={{ padding: '14px 12px', textAlign: 'right' }}>
                        <span style={{ color: severityColor, fontWeight: 700, fontSize: '14px' }}>
                          {formatCurrency(balanceDue)}
                        </span>
                        {hasPartialPayment && (
                          <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                            of {formatCurrency(inv.totalAmount)} total
                          </div>
                        )}
                      </td>
                      
                      {/* Days Overdue Badge */}
                      <td style={{ padding: '14px 12px', textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          background: severityBg, color: severityColor,
                          fontSize: '11px', fontWeight: 600, padding: '4px 10px',
                          borderRadius: '12px', border: `1px solid ${severityColor}30`,
                        }}>
                          <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: severityColor }} />
                          {inv.daysOverdue}d
                        </span>
                      </td>
                      
                      {/* Action Buttons */}
                      <td style={{ padding: '14px 12px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                          {/* Send Reminder — only enabled if client has phone */}
                          <button
                            onClick={() => handleSendReminder(inv.id, inv.invoiceNo)}
                            disabled={!hasPhone || actionLoading === `remind-${inv.id}`}
                            title={hasPhone ? 'Send WhatsApp Reminder' : 'No phone number — add phone in Clients page'}
                            style={{
                              background: hasPhone ? 'rgba(240, 136, 62, 0.1)' : 'rgba(128,128,128,0.1)',
                              border: `1px solid ${hasPhone ? 'rgba(240, 136, 62, 0.3)' : 'rgba(128,128,128,0.2)'}`,
                              color: hasPhone ? '#f0883e' : '#555',
                              borderRadius: '6px', padding: '6px 10px',
                              fontSize: '12px', cursor: hasPhone ? 'pointer' : 'not-allowed', fontWeight: 500,
                              opacity: actionLoading === `remind-${inv.id}` ? 0.5 : 1,
                              transition: 'all 0.2s',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {actionLoading === `remind-${inv.id}` ? '⏳' : '📢 Remind'}
                          </button>
                          
                          {/* Mark Paid */}
                          <button
                            onClick={() => handleMarkPaid(inv.id, inv.invoiceNo)}
                            disabled={actionLoading === `paid-${inv.id}`}
                            title="Mark as Paid"
                            style={{
                              background: 'rgba(46, 160, 67, 0.1)', border: '1px solid rgba(46, 160, 67, 0.3)',
                              color: '#2ea043', borderRadius: '6px', padding: '6px 10px',
                              fontSize: '12px', cursor: 'pointer', fontWeight: 500,
                              opacity: actionLoading === `paid-${inv.id}` ? 0.5 : 1,
                              transition: 'all 0.2s',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {actionLoading === `paid-${inv.id}` ? '⏳' : '✅ Paid'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bottom 3 Cards */}
      <div className="dashboard-bottom-grid" style={{ display: 'grid', gap: '24px' }}>
        
        {/* Collection Rate */}
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '32px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '12px' }}>Collection Rate</div>
          <div style={{ fontSize: '36px', fontWeight: 800, color: '#c9d1d9', marginBottom: '24px' }}>{overview.collectionRate}%</div>
          
          <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', marginBottom: '4px' }}>Avg Days to Pay</div>
          <div style={{ fontSize: '20px', fontWeight: 700, color: '#c9d1d9' }}>{overview.avgDaysToPay} <span style={{ fontSize: '14px', fontWeight: 'normal', color: 'var(--color-text-muted)' }}>days</span></div>
        </div>

        {/* Monthly Invoice Status */}
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '24px' }}>
          <div style={{ textAlign: 'center', fontSize: '13px', fontWeight: 600, marginBottom: '24px', color: 'var(--color-text)' }}>Monthly Invoice Status</div>
          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', fontSize: '11px', color: 'var(--color-text-muted)', marginBottom: '32px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><div style={{ width: '8px', height: '8px', background: '#2ea043' }}/> Paid</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><div style={{ width: '8px', height: '8px', background: '#f0883e' }}/> Pending</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><div style={{ width: '8px', height: '8px', background: '#f85149' }}/> Overdue</span>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 'auto', gap: '12px', height: '60px' }}>
            {trends?.months.map((m) => {
               const maxVal = Math.max(...trends.months.map((t) => t.invoiced)) || 1;
               const collectedH = Math.max((m.collected / maxVal) * 100, 5);
               const pendingH = Math.max(((m.invoiced - m.collected) / maxVal) * 100, 5);
               return (
                 <div key={m.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ width: '100%', height: '4px', background: '#f0883e', borderRadius: '4px' }} />
                    <div style={{ width: '100%', height: '4px', background: '#2ea043', borderRadius: '4px', marginTop: '4px' }} />
                    <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)', marginTop: '8px' }}>{m.month.substring(0, 3)}</div>
                 </div>
               );
            })}
          </div>
        </div>

        {/* Receivables Aging — now with real data */}
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '8px' }}>Receivables Aging</div>
          <div style={{ height: '120px', width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={agingData.filter(d => d.value > 0).length > 0 ? agingData : [{ name: 'None', value: 1 }]}
                  cx="50%"
                  cy="50%"
                  innerRadius={35}
                  outerRadius={50}
                  paddingAngle={5}
                  dataKey="value"
                  stroke="none"
                >
                  {(agingData.filter(d => d.value > 0).length > 0 ? agingData : [{ name: 'None', value: 1 }]).map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={agingData.filter(d => d.value > 0).length > 0 ? COLORS[index % COLORS.length] : '#30363d'} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', fontSize: '11px', color: 'var(--color-text-muted)' }}>
            {agingData.map((d, i) => (
              <div key={d.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '6px', height: '6px', background: COLORS[i] }}/>
                  {d.name}
                </span>
                <span>{agingTotal > 0 ? Math.round((d.value / agingTotal) * 100) : 0}% • {formatCurrency(d.value)}</span>
              </div>
            ))}
          </div>
        </div>

      </div>

      <style jsx>{`
        @keyframes slideIn {
          from { transform: translateX(100px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
