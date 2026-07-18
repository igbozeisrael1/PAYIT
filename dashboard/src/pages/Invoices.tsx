import React, { useState, useEffect } from 'react';
import { Download, ExternalLink, Filter, RefreshCw } from 'lucide-react';
import { api, type Invoice } from '../lib/api';

const STATUS_OPTIONS = ['All', 'SENT', 'PAID', 'OVERDUE', 'DRAFT', 'CANCELLED'];

const statusColor: Record<string, string> = {
  PAID: 'badge-success', SENT: 'badge-warning',
  OVERDUE: 'badge-danger', DRAFT: 'badge-neutral', CANCELLED: 'badge-neutral',
};

const Invoices: React.FC = () => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState('All');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const fetchInvoices = async () => {
    setLoading(true);
    try {
      const result = await api.getInvoices({
        page,
        status: statusFilter === 'All' ? undefined : statusFilter,
      });
      setInvoices(result.invoices);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (err) {
      console.error('Failed to load invoices:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchInvoices(); }, [page, statusFilter]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch('/api/invoices/export.csv', { credentials: 'include' });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payit-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const fmt = (raw: string) => (Number(BigInt(raw)) / 1_000_000).toFixed(2);

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '32px' }}>
        <div>
          <h1>Invoices</h1>
          <p style={{ marginTop: '8px' }}>{total} total invoice{total !== 1 ? 's' : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="btn btn-ghost" onClick={fetchInvoices} style={{ padding: '10px 14px' }}>
            <RefreshCw size={16} />
          </button>
          <button
            className="btn btn-primary"
            onClick={handleExport}
            disabled={exporting}
          >
            <Download size={16} />
            {exporting ? 'Exporting...' : 'Export CSV'}
          </button>
        </div>
      </div>

      {/* Status filter */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <Filter size={16} style={{ color: 'var(--color-text-muted)', alignSelf: 'center' }} />
        {STATUS_OPTIONS.map((status) => (
          <button
            key={status}
            className="btn btn-ghost"
            onClick={() => { setStatusFilter(status); setPage(1); }}
            style={{
              padding: '6px 14px',
              fontSize: '0.8rem',
              ...(statusFilter === status ? {
                background: 'linear-gradient(135deg, hsla(265, 90%, 65%, 0.2), hsla(280, 80%, 72%, 0.15))',
                borderColor: 'var(--color-accent-border)',
                color: 'var(--color-accent-primary)',
              } : {}),
            }}
          >
            {status}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="glass-card" style={{ overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '48px', textAlign: 'center' }}>
            <div className="loading-spinner" style={{ margin: '0 auto' }} />
          </div>
        ) : invoices.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center' }}>
            <p style={{ fontSize: '1rem', marginBottom: '8px' }}>No invoices found</p>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
              Create invoices from the PayIT Telegram bot using /invoices
            </p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Subtotal</th>
                <th>VAT</th>
                <th>WHT</th>
                <th>Total</th>
                <th>Status</th>
                <th>Due Date</th>
                <th>On-Chain</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
                    {inv.clientName}
                  </td>
                  <td>${fmt(inv.subtotal)}</td>
                  <td style={{ color: 'var(--color-warning)' }}>${fmt(inv.vatAmount)}</td>
                  <td style={{ color: 'var(--color-accent-secondary)' }}>${fmt(inv.whtAmount)}</td>
                  <td style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>
                    ${fmt(inv.total)}
                  </td>
                  <td>
                    <span className={`badge ${statusColor[inv.status] ?? 'badge-neutral'}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td>
                    {inv.dueDate
                      ? new Date(inv.dueDate).toLocaleDateString()
                      : <span style={{ color: 'var(--color-text-muted)' }}>—</span>}
                  </td>
                  <td>
                    {inv.onchainInvoiceId ? (
                      <a
                        href={`https://testnet.monadvision.com/token/${inv.onchainInvoiceId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', color: 'var(--color-success)' }}
                      >
                        #{inv.onchainInvoiceId} <ExternalLink size={12} />
                      </a>
                    ) : (
                      <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '24px' }}>
          <button
            className="btn btn-ghost"
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
          >
            ← Previous
          </button>
          <span style={{ display: 'flex', alignItems: 'center', padding: '0 16px', color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>
            Page {page} of {totalPages}
          </span>
          <button
            className="btn btn-ghost"
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
};

export default Invoices;
