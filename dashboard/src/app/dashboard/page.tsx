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
    totalAmount: number;
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

  // Default color palette for charts matching sleek UI
  const COLORS = ['#2ea043', '#f0883e', '#f85149'];

  useEffect(() => {
    loadData();
  }, []);

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

  // Mock data for Aging Chart based on pending/overdue to simulate donut
  const agingData = [
    { name: 'Current', value: overview.totalPending - overview.totalOverdue > 0 ? overview.totalPending - overview.totalOverdue : 100 },
    { name: '30d', value: (overview.totalOverdue / 2) || 30 },
    { name: '60d+', value: (overview.totalOverdue / 2) || 10 },
  ];

  return (
    <div>
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

      {/* Overdue Invoices Table */}
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '24px', marginBottom: '24px' }}>
        <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '16px', textAlign: 'center' }}>
          Overdue Invoices
        </h3>
        
        {overview.overdueInvoices.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px', color: 'var(--color-text-muted)' }}>
            🎉 No overdue invoices!
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                <th style={{ padding: '12px', textAlign: 'left', color: 'var(--color-text-muted)', fontWeight: 500 }}>Name</th>
                <th style={{ padding: '12px', textAlign: 'right', color: 'var(--color-text-muted)', fontWeight: 500 }}>Price</th>
                <th style={{ padding: '12px', textAlign: 'left', color: 'var(--color-text-muted)', fontWeight: 500 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {overview.overdueInvoices.map((inv) => (
                <tr key={inv.id} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                  <td style={{ padding: '16px 12px', color: 'var(--color-text)' }}>{inv.clientName}</td>
                  <td style={{ padding: '16px 12px', textAlign: 'right', color: 'var(--color-text)' }}>{formatCurrency(inv.totalAmount)}</td>
                  <td style={{ padding: '16px 12px', display: 'flex', alignItems: 'center', gap: '8px', color: inv.daysOverdue > 10 ? '#f85149' : '#f0883e' }}>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: inv.daysOverdue > 10 ? '#f85149' : '#f0883e' }} />
                    {inv.daysOverdue} days overdue
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

        {/* Receivables Aging */}
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', padding: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '8px' }}>Receivables Aging</div>
          <div style={{ height: '120px', width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={agingData}
                  cx="50%"
                  cy="50%"
                  innerRadius={35}
                  outerRadius={50}
                  paddingAngle={5}
                  dataKey="value"
                  stroke="none"
                >
                  {agingData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', fontSize: '11px', color: 'var(--color-text-muted)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
               <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><div style={{ width: '6px', height: '6px', background: '#2ea043' }}/> Current</span>
               <span>56%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
               <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><div style={{ width: '6px', height: '6px', background: '#f0883e' }}/> 30d</span>
               <span>31%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
               <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><div style={{ width: '6px', height: '6px', background: '#f85149' }}/> 60d+</span>
               <span>13%</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
