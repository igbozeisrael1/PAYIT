import React, { useState, useEffect } from 'react';
import { TrendingUp, FileText, DollarSign, ArrowUpRight, Activity, ExternalLink } from 'lucide-react';
import { api, type LedgerSummary, type Invoice, type BalanceResponse } from '../lib/api';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const Overview: React.FC = () => {
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [sumData, invData, balData] = await Promise.all([
          api.getLedgerSummary(),
          api.getInvoices({ page: 1 }),
          api.getBalance('BUSINESS'),
        ]);
        setSummary(sumData);
        setInvoices(invData.invoices.slice(0, 5));
        setBalance(balData);
      } catch (err) {
        console.error('Failed to load overview:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // Mock chart data (replace with real data from API)
  const chartData = [
    { month: 'Jan', revenue: 2400 }, { month: 'Feb', revenue: 1398 },
    { month: 'Mar', revenue: 9800 }, { month: 'Apr', revenue: 3908 },
    { month: 'May', revenue: 4800 }, { month: 'Jun', revenue: 3800 },
    { month: 'Jul', revenue: 5600 },
  ];

  const statusColor: Record<string, string> = {
    PAID: 'badge-success', SENT: 'badge-warning',
    OVERDUE: 'badge-danger', DRAFT: 'badge-neutral', CANCELLED: 'badge-neutral',
  };

  const fmt = (raw: string) => parseFloat((Number(BigInt(raw)) / 1_000_000).toFixed(2)).toLocaleString('en-US', { minimumFractionDigits: 2 });

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h1>Dashboard Overview</h1>
        <p style={{ marginTop: '8px' }}>
          Business wallet • Monad Blockchain •{' '}
          {balance && <span style={{ color: 'var(--color-success)' }}>● Live</span>}
        </p>
      </div>

      {/* Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '32px' }}>
        {[
          {
            label: 'USDC Balance',
            value: balance ? `$${parseFloat(balance.usdc).toFixed(2)}` : '—',
            icon: <DollarSign size={20} />,
            color: 'var(--color-accent-primary)',
          },
          {
            label: 'Total Revenue',
            value: summary ? `$${summary.totalRevenue}` : '—',
            icon: <TrendingUp size={20} />,
            color: 'var(--color-success)',
          },
          {
            label: 'VAT Collected',
            value: summary ? `$${summary.totalVat}` : '—',
            icon: <Activity size={20} />,
            color: 'var(--color-warning)',
          },
          {
            label: 'Invoices',
            value: summary ? String(summary.invoiceCount) : '—',
            icon: <FileText size={20} />,
            color: 'var(--color-accent-secondary)',
          },
        ].map(({ label, value, icon, color }) => (
          <div key={label} className="glass-card stat-card">
            <div className="stat-label">{label}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                width: '40px', height: '40px', borderRadius: 'var(--radius-md)',
                background: `hsla(0, 0%, 100%, 0.05)`,
                border: `1px solid ${color}44`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color,
              }}>
                {icon}
              </div>
              <div className="stat-value" style={{ fontSize: '1.6rem' }}>{value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Revenue Chart */}
      <div className="glass-card" style={{ padding: '24px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div>
            <h3 style={{ marginBottom: '4px' }}>Revenue Trend</h3>
            <p style={{ fontSize: '0.85rem' }}>Monthly USDC earned</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: 'var(--color-success)' }}>
            <ArrowUpRight size={16} /> +12.5% this month
          </div>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(265, 90%, 65%)" stopOpacity={0.25} />
                <stop offset="95%" stopColor="hsl(265, 90%, 65%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="month" stroke="var(--color-text-muted)" fontSize={12} tick={{ fill: 'var(--color-text-muted)' }} />
            <YAxis stroke="var(--color-text-muted)" fontSize={12} tick={{ fill: 'var(--color-text-muted)' }} />
            <Tooltip
              contentStyle={{
                background: 'var(--color-bg-card)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--color-text-primary)',
              }}
              formatter={(value: any) => [`$${value}`, 'Revenue']}
            />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="hsl(265, 90%, 65%)"
              strokeWidth={2}
              fill="url(#colorRevenue)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Recent Invoices */}
      <div className="glass-card" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3>Recent Invoices</h3>
          <a href="/invoices" style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
            View all <ExternalLink size={14} />
          </a>
        </div>
        {invoices.length === 0 ? (
          <p style={{ textAlign: 'center', padding: '32px', color: 'var(--color-text-muted)' }}>
            No invoices yet. Create your first one from the Telegram bot.
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Date</th>
                <th>On-Chain</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>{inv.clientName}</td>
                  <td>${fmt(inv.total)} USDC</td>
                  <td>
                    <span className={`badge ${statusColor[inv.status] ?? 'badge-neutral'}`}>
                      {inv.status}
                    </span>
                  </td>
                  <td>{new Date(inv.createdAt).toLocaleDateString()}</td>
                  <td>
                    {inv.onchainInvoiceId ? (
                      <span style={{ color: 'var(--color-success)', fontSize: '0.8rem' }}>
                        ✓ #{inv.onchainInvoiceId}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>Pending</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Wallet address */}
      {balance && (
        <div style={{
          marginTop: '16px',
          padding: '12px 16px',
          background: 'var(--color-bg-card)',
          borderRadius: 'var(--radius-md)',
          fontSize: '0.8rem',
          color: 'var(--color-text-muted)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <span>Business Wallet:</span>
          <code style={{ color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>
            {balance.address.slice(0, 10)}...{balance.address.slice(-8)}
          </code>
          <a
            href={`https://testnet.monadvision.com/address/${balance.address}`}
            target="_blank" rel="noopener noreferrer"
            style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem' }}
          >
            View on Monad <ExternalLink size={12} />
          </a>
        </div>
      )}
    </div>
  );
};

export default Overview;
