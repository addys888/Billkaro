'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api';
import { formatCurrency, formatCompact } from '@/lib/utils';

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
  const [period, setPeriod] = useState('month');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [period]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [overviewData, trendsData] = await Promise.all([
        apiFetch<OverviewData>(`/api/dashboard/overview?period=${period}`),
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
      <div>
        <div className="main-header">
          <h1>Financial Overview</h1>
        </div>
        <div className="stats-grid">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="stat-card">
              <div className="skeleton" style={{ width: 44, height: 44, marginBottom: 12 }} />
              <div className="skeleton" style={{ width: '60%', height: 28, marginBottom: 8 }} />
              <div className="skeleton" style={{ width: '40%', height: 16 }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="main-header">
        <h1>📊 Financial Overview</h1>
        <select
          className="select"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          id="period-select"
        >
          <option value="week">This Week</option>
          <option value="month">This Month</option>
          <option value="quarter">This Quarter</option>
          <option value="year">This Year</option>
        </select>
      </div>

      {/* KPI Cards */}
      <div className="stats-grid">
        <div className="stat-card primary">
          <div className="stat-icon">💰</div>
          <div className="stat-value">{formatCompact(overview.totalInvoiced)}</div>
          <div className="stat-label">Total Invoiced</div>
          <div className="stat-sub">{overview.invoiceCount} invoices</div>
        </div>
        <div className="stat-card success">
          <div className="stat-icon">✅</div>
          <div className="stat-value">{formatCompact(overview.totalCollected)}</div>
          <div className="stat-label">Collected</div>
          <div className="stat-sub">{overview.paidCount} paid</div>
        </div>
        <div className="stat-card warning">
          <div className="stat-icon">⏳</div>
          <div className="stat-value">{formatCompact(overview.totalPending)}</div>
          <div className="stat-label">Pending</div>
          <div className="stat-sub">{overview.pendingCount} invoices</div>
        </div>
        <div className="stat-card danger">
          <div className="stat-icon">🔴</div>
          <div className="stat-value">{formatCompact(overview.totalOverdue)}</div>
          <div className="stat-label">Overdue</div>
          <div className="stat-sub">{overview.overdueCount} invoices</div>
        </div>
      </div>

      {/* Secondary Stats */}
      <div className="stats-grid" style={{ marginBottom: 32 }}>
        <div className="stat-card">
          <div className="stat-value" style={{ fontSize: '1.5rem', color: overview.collectionRate >= 70 ? '#10b981' : '#f59e0b' }}>
            {overview.collectionRate}%
          </div>
          <div className="stat-label">Collection Rate</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ fontSize: '1.5rem' }}>
            {overview.avgDaysToPay} <span style={{ fontSize: '0.875rem', color: '#94a3b8' }}>days</span>
          </div>
          <div className="stat-label">Avg. Days to Pay</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Overdue Invoices */}
        <div className="card">
          <div className="card-header">
            <h3>🔴 Overdue Invoices</h3>
            <span className="badge badge-danger">{overview.overdueCount}</span>
          </div>
          {overview.overdueInvoices.length === 0 ? (
            <div className="empty-state" style={{ padding: '24px 0' }}>
              <p>🎉 No overdue invoices!</p>
            </div>
          ) : (
            <ul className="overdue-list">
              {overview.overdueInvoices.map((inv) => (
                <li key={inv.id} className="overdue-item">
                  <div>
                    <div className="client-name">{inv.clientName}</div>
                    <div className="text-xs text-muted">#{inv.invoiceNo}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="amount">{formatCurrency(inv.totalAmount)}</div>
                    <div className="days">{inv.daysOverdue}d overdue</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Monthly Trends */}
        <div className="card">
          <div className="card-header">
            <h3>📈 Monthly Trends</h3>
          </div>
          {trends && trends.months.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {trends.months.map((m) => {
                const maxVal = Math.max(...trends.months.map((t) => t.invoiced)) || 1;
                return (
                  <div key={m.month}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', marginBottom: 4 }}>
                      <span>{m.month}</span>
                      <span style={{ fontWeight: 600 }}>{formatCompact(m.invoiced)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 2, height: 8 }}>
                      <div style={{
                        width: `${(m.collected / maxVal) * 100}%`,
                        background: '#10b981',
                        borderRadius: '4px 0 0 4px',
                        transition: 'width 0.5s ease',
                      }} />
                      <div style={{
                        width: `${((m.invoiced - m.collected) / maxVal) * 100}%`,
                        background: '#fbbf24',
                        borderRadius: '0 4px 4px 0',
                        transition: 'width 0.5s ease',
                      }} />
                    </div>
                  </div>
                );
              })}
              <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: '0.75rem' }}>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#10b981', marginRight: 4 }} />Collected</span>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#fbbf24', marginRight: 4 }} />Pending</span>
              </div>
            </div>
          ) : (
            <div className="empty-state" style={{ padding: '24px 0' }}>
              <p>No data yet. Invoices will appear here.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
