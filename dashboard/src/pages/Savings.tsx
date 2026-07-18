import React from 'react';
import { PiggyBank, TrendingUp } from 'lucide-react';

const Savings: React.FC = () => {
  return (
    <div className="animate-fade-in" style={{ padding: '24px', maxWidth: '800px', margin: '0 auto' }}>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '8px' }}>Savings & Yield</h1>
        <p style={{ color: 'var(--color-text-secondary)' }}>
          Put your idle Digital Dollars to work. Earn sustainable interest automatically.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        <div className="glass-card" style={{ padding: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
            <div style={{ padding: '12px', background: 'rgba(52, 211, 153, 0.1)', borderRadius: '12px' }}>
              <PiggyBank size={24} color="#34D399" />
            </div>
            <div>
              <h3 style={{ fontSize: '1.2rem', margin: 0 }}>Flexible Savings</h3>
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', margin: 0 }}>Withdraw anytime</p>
            </div>
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
            8.5% <span style={{ fontSize: '1rem', color: 'var(--color-text-muted)' }}>APY</span>
          </div>
          <button className="primary-button" style={{ width: '100%', marginTop: '24px' }}>
            Start Saving
          </button>
        </div>

        <div className="glass-card" style={{ padding: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
            <div style={{ padding: '12px', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '12px' }}>
              <TrendingUp size={24} color="#3B82F6" />
            </div>
            <div>
              <h3 style={{ fontSize: '1.2rem', margin: 0 }}>Fixed Deposit</h3>
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', margin: 0 }}>Lock for higher returns</p>
            </div>
          </div>
          <div style={{ fontSize: '2.5rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
            12.0% <span style={{ fontSize: '1rem', color: 'var(--color-text-muted)' }}>APY</span>
          </div>
          <button className="secondary-button" style={{ width: '100%', marginTop: '24px' }}>
            Lock Funds
          </button>
        </div>
      </div>
    </div>
  );
};

export default Savings;
