'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '@/lib/api';
import { formatCurrency, formatDate, getStatusBadge } from '@/lib/utils';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface Payment {
  amount: number;
  transactionId: string | null;
  paymentMethod: string | null;
  createdAt: string;
}

interface Invoice {
  id: string;
  invoiceNo: string;
  status: string;
  clientName: string;
  clientPhone: string | null;
  totalAmount: number;
  amountPaid: number;
  description: string | null;
  pdfUrl: string | null;
  paymentLink: string | null;
  sentToClient: boolean;
  dueDate: string;
  paidAt: string | null;
  createdAt: string;
  payments: Payment[];
}

interface InvoiceResponse {
  invoices: Invoice[];
  total: number;
  page: number;
  totalPages: number;
}

export default function InvoicesPage() {
  const [data, setData] = useState<InvoiceResponse | null>(null);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const loadInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: '20',
        ...(status !== 'all' && { status }),
        ...(search && { search }),
      });
      const result = await apiFetch<InvoiceResponse>(`/api/invoices?${params}`);
      setData(result);
    } catch (error) {
      console.error('Failed to load invoices:', error);
    } finally {
      setLoading(false);
    }
  }, [page, status, search]);

  useEffect(() => {
    const debounce = setTimeout(loadInvoices, 300);
    return () => clearTimeout(debounce);
  }, [loadInvoices]);

  const handleMarkPaid = async (invoiceId: string) => {
    if (!confirm('Mark this invoice as paid?')) return;
    try {
      await apiFetch(`/api/invoices/${invoiceId}/mark-paid`, {
        method: 'PATCH',
        body: JSON.stringify({ paymentMethod: 'manual' }),
      });
      loadInvoices();
    } catch (error) {
      alert('Failed to mark as paid');
    }
  };

  const handleResend = async (inv: Invoice) => {
    let phone = inv.clientPhone;
    if (!phone) {
      const input = prompt(`Cannot resend directly.\n\n${inv.clientName} has no phone number saved (likely created via voice invoice).\n\nPlease enter a valid 10-digit WhatsApp number to resend:`);
      if (!input || input.trim().length < 10) return;
      phone = input.trim();
    }
    
    try {
      await apiFetch(`/api/invoices/${inv.id}/resend`, { 
        method: 'POST',
        body: JSON.stringify({ phone })
      });
      alert(`✅ Invoice resent to ${inv.clientName} via WhatsApp!`);
      if (phone !== inv.clientPhone) {
        loadInvoices(); // Reload to show the newly saved phone number
      }
    } catch (error: any) {
      alert(error.message || 'Failed to resend invoice');
    }
  };

  const handleExportCSV = async () => {
    try {
      const result = await apiFetch<InvoiceResponse>(`/api/invoices?limit=10000`);
      if (!result.invoices || result.invoices.length === 0) {
        alert('No invoices found to export.');
        return;
      }
      
      const headers = ['Invoice No', 'Client Name', 'Client Phone', 'Amount', 'Paid', 'Balance', 'UTR', 'Status', 'Date', 'Due Date'];
      const csvData = result.invoices.map(inv => {
        const balance = inv.totalAmount - inv.amountPaid;
        const latestUTR = inv.payments?.find(p => p.transactionId && p.transactionId !== 'SCREENSHOT')?.transactionId || '';
        return [
          inv.invoiceNo,
          `"${inv.clientName}"`,
          inv.clientPhone || 'N/A',
          inv.totalAmount,
          inv.amountPaid,
          balance,
          latestUTR,
          inv.status,
          formatDate(inv.createdAt),
          formatDate(inv.dueDate)
        ];
      });
      
      const csvContent = [headers.join(','), ...csvData.map(row => row.join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `BillKaro_Invoices_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert('Failed to export CSV');
    }
  };

  const handleRecordPayment = async (inv: Invoice) => {
    const balance = inv.totalAmount - inv.amountPaid;
    const input = prompt(
      `Record payment for ${inv.invoiceNo}\n\nTotal: ₹${inv.totalAmount.toLocaleString('en-IN')}\nPaid: ₹${inv.amountPaid.toLocaleString('en-IN')}\nBalance: ₹${balance.toLocaleString('en-IN')}\n\nEnter payment amount:`
    );
    if (!input) return;
    const amount = parseFloat(input.replace(/[₹,\s]/g, ''));
    if (isNaN(amount) || amount <= 0) {
      alert('Invalid amount');
      return;
    }
    if (amount > balance) {
      alert(`Amount cannot exceed balance of ₹${balance.toLocaleString('en-IN')}`);
      return;
    }
    try {
      await apiFetch(`/api/invoices/${inv.id}/record-payment`, {
        method: 'PATCH',
        body: JSON.stringify({ amount, paymentMethod: 'manual' }),
      });
      loadInvoices();
    } catch (error) {
      alert('Failed to record payment');
    }
  };

  return (
    <div>
      <div className="main-header">
        <h1>📋 Invoices</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleExportCSV} className="btn btn-outline btn-sm" id="export-csv-btn">
            📥 Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="filters-bar">
        <div className="search-bar" style={{ flex: 1 }}>
          <span className="search-icon">🔍</span>
          <input
            className="input"
            style={{ paddingLeft: 36 }}
            placeholder="Search by client, invoice #, or amount..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            id="invoice-search"
          />
        </div>
        <select
          className="select"
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          id="status-filter"
        >
          <option value="all">All Status</option>
          <option value="pending">⏳ Pending</option>
          <option value="partially_paid">🟡 Partially Paid</option>
          <option value="paid">✅ Paid</option>
          <option value="overdue">🔴 Overdue</option>
          <option value="cancelled">❌ Cancelled</option>
        </select>
      </div>

      {/* Invoice Table */}
      <div className="card" style={{ padding: 0 }}>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Client</th>
                <th>Amount</th>
                <th>Paid</th>
                <th>UTR / Ref</th>
                <th>Status</th>
                <th>Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j}><div className="skeleton" style={{ width: '80%', height: 16 }} /></td>
                    ))}
                  </tr>
                ))
              ) : data && data.invoices.length > 0 ? (
                data.invoices.map((inv) => {
                  const badge = getStatusBadge(inv.status);
                  return (
                    <tr key={inv.id}>
                      <td style={{ fontWeight: 600, color: '#2563eb' }}>{inv.invoiceNo}</td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{inv.clientName}</div>
                        {inv.clientPhone ? (
                          <a
                            href={`https://wa.me/${inv.clientPhone}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs"
                            style={{ color: '#25D366', textDecoration: 'none' }}
                            title={`WhatsApp ${inv.clientName}`}
                          >
                            📱 {inv.clientPhone.replace(/^91/, '+91 ')}
                          </a>
                        ) : (
                          <span className="text-xs text-muted">No phone</span>
                        )}
                        {inv.description && (
                          <div className="text-xs text-muted" style={{ marginTop: 2 }}>{inv.description}</div>
                        )}
                      </td>
                      <td style={{ fontWeight: 700 }}>{formatCurrency(inv.totalAmount)}</td>
                      <td>
                        {inv.amountPaid > 0 ? (
                          <div className="payment-progress">
                            <div className="progress-bar">
                              <div className="fill" style={{ width: `${Math.min(100, (inv.amountPaid / inv.totalAmount) * 100)}%` }} />
                            </div>
                            <div className="progress-text">
                              {formatCurrency(inv.amountPaid)} / {formatCurrency(inv.totalAmount)}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>
                      <td>
                        {inv.payments && inv.payments.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {inv.payments.slice(0, 2).map((p, idx) => (
                              <div key={idx} style={{ fontSize: '0.75rem' }}>
                                {p.transactionId && p.transactionId !== 'SCREENSHOT' ? (
                                  <span
                                    style={{ cursor: 'pointer', color: '#2563eb', fontFamily: 'monospace', fontSize: '0.7rem' }}
                                    title={`Click to copy: ${p.transactionId}`}
                                    onClick={() => { navigator.clipboard.writeText(p.transactionId!); }}
                                  >
                                    🔖 {p.transactionId.length > 12 ? p.transactionId.substring(0, 12) + '…' : p.transactionId}
                                  </span>
                                ) : (
                                  <span className="text-muted" style={{ fontSize: '0.7rem' }}>
                                    {p.paymentMethod === 'upi' ? '📲 UPI' : '💵 Manual'}
                                  </span>
                                )}
                                <span className="text-muted" style={{ fontSize: '0.65rem', marginLeft: 4 }}>
                                  {formatCurrency(p.amount)}
                                </span>
                              </div>
                            ))}
                            {inv.payments.length > 2 && (
                              <span className="text-xs text-muted">+{inv.payments.length - 2} more</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )}
                      </td>
                      <td><span className={`badge ${badge.className}`}>{badge.label}</span></td>
                      <td className="text-sm text-secondary">{formatDate(inv.createdAt)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {inv.status !== 'PAID' && (
                            <button
                              className="btn btn-sm btn-outline"
                              onClick={() => handleRecordPayment(inv)}
                              title={`Record payment for ${inv.invoiceNo}`}
                              style={{ fontSize: '0.75rem' }}
                            >
                              💰 Pay
                            </button>
                          )}
                          <button
                            className="btn btn-sm btn-outline"
                            onClick={() => handleResend(inv)}
                            title={inv.clientPhone ? `Resend to ${inv.clientName}` : `No phone for ${inv.clientName}`}
                            style={{ opacity: inv.clientPhone ? 1 : 0.5 }}
                          >
                            📤
                          </button>
                          {inv.pdfUrl && (
                            <a
                              href={inv.pdfUrl.startsWith('http') ? inv.pdfUrl : `${API_BASE}${inv.pdfUrl}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn btn-sm btn-outline"
                              title="View PDF"
                            >
                              📄
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9}>
                    <div className="empty-state">
                      <div className="icon">📄</div>
                      <h3>No invoices found</h3>
                      <p>Create your first invoice by sending a message on WhatsApp!</p>
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
    </div>
  );
}
