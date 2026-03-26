'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { formatCurrency, getStarRating } from '@/lib/utils';

interface Client {
  id: string;
  name: string;
  phone: string | null;
  gstin: string | null;
  paymentScore: number;
  totalInvoiced: number;
  totalPaid: number;
  totalPending: number;
  avgDaysToPay: number;
  invoiceCount: number;
  createdAt: string;
}

interface ClientResponse {
  clients: Client[];
  total: number;
  page: number;
  totalPages: number;
}

export default function ClientsPage() {
  const [data, setData] = useState<ClientResponse | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const loadClients = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20',
        ...(search && { search }),
      });
      const result = await apiFetch<ClientResponse>(`/api/clients?${params}`);
      setData(result);
    } catch (error) {
      console.error('Failed to load clients:', error);
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    const debounce = setTimeout(loadClients, 300);
    return () => clearTimeout(debounce);
  }, [loadClients]);

  const renderStars = (score: number) => {
    const { filled, empty } = getStarRating(score);
    return (
      <span className="stars">
        {'⭐'.repeat(filled)}
        {'☆'.repeat(empty)}
      </span>
    );
  };

  return (
    <div>
      <div className="main-header">
        <h1>👥 Client Directory</h1>
        <span className="badge badge-info">{data?.total || 0} clients</span>
      </div>

      {/* Search */}
      <div className="filters-bar">
        <div className="search-bar" style={{ flex: 1 }}>
          <span className="search-icon">🔍</span>
          <input
            className="input"
            style={{ paddingLeft: 36 }}
            placeholder="Search clients by name or phone..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            id="client-search"
          />
        </div>
      </div>

      {/* Client Table */}
      <div className="card" style={{ padding: 0 }}>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Client</th>
                <th>Invoices</th>
                <th>Total Invoiced</th>
                <th>Pending</th>
                <th>Avg. Days</th>
                <th>Rating</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j}><div className="skeleton" style={{ width: '80%', height: 16 }} /></td>
                    ))}
                  </tr>
                ))
              ) : data && data.clients.length > 0 ? (
                data.clients.map((client) => (
                  <tr key={client.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{
                          width: 36,
                          height: 36,
                          borderRadius: '50%',
                          background: 'var(--color-primary-50)',
                          color: 'var(--color-primary)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          fontSize: '0.8125rem',
                        }}>
                          {client.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600 }}>{client.name}</div>
                          <div className="text-xs text-muted">
                            {client.phone ? `+${client.phone}` : 'No phone'}
                            {client.gstin && ` • ${client.gstin}`}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="badge badge-info">{client.invoiceCount}</span>
                    </td>
                    <td style={{ fontWeight: 600 }}>
                      {formatCurrency(client.totalInvoiced)}
                    </td>
                    <td>
                      {client.totalPending > 0 ? (
                        <span style={{ color: 'var(--color-danger)', fontWeight: 600 }}>
                          {formatCurrency(client.totalPending)}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--color-success)' }}>₹0</span>
                      )}
                    </td>
                    <td className="text-sm">
                      {client.avgDaysToPay > 0 ? `${client.avgDaysToPay} days` : '—'}
                    </td>
                    <td>{renderStars(client.paymentScore)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6}>
                    <div className="empty-state">
                      <div className="icon">👥</div>
                      <h3>No clients yet</h3>
                      <p>Clients are auto-created when you send your first invoice via WhatsApp.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && data.totalPages > 1 && (
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 16px',
            borderTop: '1px solid var(--color-border)',
          }}>
            <span className="text-sm text-muted">
              Showing {((page - 1) * 20) + 1}–{Math.min(page * 20, data.total)} of {data.total}
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                className="btn btn-sm btn-outline"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                ← Prev
              </button>
              <button
                className="btn btn-sm btn-outline"
                disabled={page >= data.totalPages}
                onClick={() => setPage(page + 1)}
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div style={{ marginTop: 16, fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
        <p>⭐ <strong>Payment Score</strong> — Based on average days to pay. ⭐⭐⭐⭐⭐ = Always on time, ⭐ = Frequently late (&gt;15 days avg)</p>
      </div>
    </div>
  );
}
