import React from 'react';
import { Wallet, AlertCircle } from 'lucide-react';

const Swap: React.FC = () => {
  return (
    <div className="animate-fade-in" style={{ padding: '24px', maxWidth: '600px', margin: '0 auto' }}>
      <div style={{ marginBottom: '32px', textAlign: 'center' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '8px' }}>Add Funds</h1>
        <p style={{ color: 'var(--color-text-secondary)' }}>
          Send any supported digital asset to your account. It will automatically be converted and settled as Digital Dollars.
        </p>
      </div>

      <div className="glass-card" style={{ padding: '32px' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: 'var(--color-bg-subtle)',
          borderRadius: 'var(--radius-md)',
          border: '1px dashed var(--color-border)',
          marginBottom: '24px'
        }}>
          <div style={{ textAlign: 'center' }}>
            <Wallet size={48} color="var(--color-text-muted)" style={{ margin: '0 auto 16px' }} />
            <h3 style={{ marginBottom: '8px' }}>Your Funding Address</h3>
            <p style={{ fontFamily: 'monospace', color: 'var(--color-accent-primary)', fontSize: '1.1rem', wordBreak: 'break-all' }}>
              0xYourSecureFundingAddress...
            </p>
          </div>
        </div>

        <div style={{
          display: 'flex',
          gap: '12px',
          padding: '16px',
          background: 'rgba(255, 171, 0, 0.1)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid rgba(255, 171, 0, 0.2)'
        }}>
          <AlertCircle size={20} color="#FFAB00" style={{ flexShrink: 0 }} />
          <p style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
            <strong>Automatic Conversion:</strong> Any tokens sent to this address will be automatically exchanged at the best market rate and credited to your balance as Digital Dollars.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Swap;
