import React from 'react';
import { Receipt, Smartphone, Wifi, Zap } from 'lucide-react';

const Bills: React.FC = () => {
  return (
    <div className="animate-fade-in" style={{ padding: '24px', maxWidth: '800px', margin: '0 auto' }}>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '8px' }}>Pay Bills</h1>
        <p style={{ color: 'var(--color-text-secondary)' }}>
          Settle your utility bills instantly using your Digital Dollars balance.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
        <div className="glass-card" style={{ padding: '24px', textAlign: 'center', cursor: 'pointer' }}>
          <Zap size={32} color="var(--color-accent-primary)" style={{ margin: '0 auto 16px' }} />
          <h3>Electricity</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: '8px' }}>Prepaid & Postpaid</p>
        </div>
        <div className="glass-card" style={{ padding: '24px', textAlign: 'center', cursor: 'pointer' }}>
          <Smartphone size={32} color="var(--color-accent-primary)" style={{ margin: '0 auto 16px' }} />
          <h3>Airtime</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: '8px' }}>Top-up instantly</p>
        </div>
        <div className="glass-card" style={{ padding: '24px', textAlign: 'center', cursor: 'pointer' }}>
          <Wifi size={32} color="var(--color-accent-primary)" style={{ margin: '0 auto 16px' }} />
          <h3>Internet</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: '8px' }}>Data bundles</p>
        </div>
        <div className="glass-card" style={{ padding: '24px', textAlign: 'center', cursor: 'pointer' }}>
          <Receipt size={32} color="var(--color-accent-primary)" style={{ margin: '0 auto 16px' }} />
          <h3>Water & Waste</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: '8px' }}>Utility bills</p>
        </div>
      </div>
    </div>
  );
};

export default Bills;
