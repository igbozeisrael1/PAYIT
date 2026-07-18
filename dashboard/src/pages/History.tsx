import React, { useState, useEffect } from 'react';
import { Activity, TrendingUp, ArrowDown, ArrowUp, ExternalLink } from 'lucide-react';
import { api, type Transaction } from '../lib/api';

const TYPE_ICON: Record<string, React.ReactNode> = {
  SEND: <ArrowUp size={14} style={{ color: 'var(--color-danger)' }} />,
  RECEIVE: <ArrowDown size={14} style={{ color: 'var(--color-success)' }} />,
  DEPOSIT: <TrendingUp size={14} style={{ color: 'var(--color-success)' }} />,
  WITHDRAWAL: <ArrowUp size={14} style={{ color: 'var(--color-warning)' }} />,
  INVOICE_PAID: <Activity size={14} style={{ color: 'var(--color-accent-primary)' }} />,
  ESCROW_LOCKED: <ArrowUp size={14} style={{ color: 'var(--color-warning)' }} />,
  ESCROW_CLAIMED: <ArrowDown size={14} style={{ color: 'var(--color-success)' }} />,
  ESCROW_REFUNDED: <ArrowDown size={14} style={{ color: 'var(--color-accent-secondary)' }} />,
};

const STATUS_COLOR: Record<string, string> = {
  CONFIRMED: 'badge-success',
  PENDING: 'badge-warning',
  FAILED: 'badge-danger',
};

const History: React.FC = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [walletType, setWalletType] = useState<'PERSONAL' | 'BUSINESS'>('BUSINESS');
  const [loading, setLoading] = useState(true);

  const fetchTx = async () => {
    setLoading(true);
    try {
      const result = await api.getTransactions({ page, walletType });
      setTransactions(result.transactions);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (err) {
      console.error('Failed to load transactions:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTx(); }, [page, walletType]);

  const fmt = (raw: string) => (Number(BigInt(raw)) / 1_000_000).toFixed(2);
  const isDebit = (type: string) => ['SEND', 'ESCROW_LOCKED', 'WITHDRAWAL'].includes(type);

  return (
    <div className="animate-fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '32px' }}>
        <div>
          <h1>Transaction History</h1>
          <p style={{ marginTop: '8px' }}>{total} total transactions</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {(['PERSONAL', 'BUSINESS'] as const).map((wt) => (
            <button
              key={wt}
              className="btn btn-ghost"
              onClick={() => { setWalletType(wt); setPage(1); }}
              style={{
                padding: '8px 16px',
                fontSize: '0.85rem',
                ...(walletType === wt ? {
                  background: 'linear-gradient(135deg, hsla(265, 90%, 65%, 0.2), hsla(280, 80%, 72%, 0.15))',
                  borderColor: 'var(--color-accent-border)',
                  color: 'var(--color-accent-primary)',
                } : {}),
              }}
            >
              {wt === 'PERSONAL' ? '👤' : '💼'} {wt}
            </button>
          ))}
        </div>
      </div>

      <div className="glass-card" style={{ overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '48px', textAlign: 'center' }}>
            <div className="loading-spinner" style={{ margin: '0 auto' }} />
          </div>
        ) : transactions.length === 0 ? (
          <div style={{ padding: '48px', textAlign: 'center' }}>
            <p>No transactions yet.</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Amount</th>
                <th>Counterparty</th>
                <th>Status</th>
                <th>Date</th>
                <th>Tx Hash</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx) => (
                <tr key={tx.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {TYPE_ICON[tx.type] ?? <Activity size={14} />}
                      <span style={{ fontSize: '0.85rem', textTransform: 'capitalize' }}>
                        {tx.type.replace(/_/g, ' ').toLowerCase()}
                      </span>
                    </div>
                  </td>
                  <td style={{
                    fontWeight: 600,
                    color: isDebit(tx.type) ? 'var(--color-danger)' : 'var(--color-success)',
                  }}>
                    {isDebit(tx.type) ? '-' : '+'}${fmt(tx.amount)}
                  </td>
                  <td>{tx.counterpartyRef ?? '—'}</td>
                  <td>
                    <span className={`badge ${STATUS_COLOR[tx.status] ?? 'badge-neutral'}`}>
                      {tx.status}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.85rem' }}>
                    {new Date(tx.createdAt).toLocaleDateString('en-NG', {
                      day: '2-digit', month: 'short', year: 'numeric',
                    })}
                  </td>
                  <td>
                    {tx.txHash ? (
                      <a
                        href={`https://testnet.monadvision.com/tx/${tx.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem' }}
                      >
                        {tx.txHash.slice(0, 8)}... <ExternalLink size={11} />
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

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '24px' }}>
          <button className="btn btn-ghost" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Previous</button>
          <span style={{ display: 'flex', alignItems: 'center', padding: '0 16px', fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>
            Page {page} of {totalPages}
          </span>
          <button className="btn btn-ghost" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
        </div>
      )}
    </div>
  );
};

export default History;
