import React from 'react';
import { Wallet, ExternalLink } from 'lucide-react';

interface LoginPageProps {}

const LoginPage: React.FC<LoginPageProps> = () => {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
    }}>
      <div className="glass-card animate-fade-in" style={{
        maxWidth: '480px',
        width: '100%',
        padding: '48px',
        textAlign: 'center',
      }}>
        {/* Logo */}
        <div style={{ marginBottom: '12px' }}>
          <div style={{
            width: '64px', height: '64px',
            borderRadius: '16px',
            background: 'linear-gradient(135deg, var(--color-accent-primary), var(--color-accent-secondary))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
            boxShadow: '0 8px 32px var(--color-accent-glow)',
          }}>
            <Wallet size={32} color="white" />
          </div>
          <div className="nav-logo" style={{ fontSize: '2.2rem', padding: 0 }}>PayIT</div>
          <p style={{ marginTop: '4px', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
            The Ultimate Stablecoin Payment Solution
          </p>
        </div>

        {/* Divider */}
        <div style={{
          height: '1px',
          background: 'var(--color-border)',
          margin: '32px 0',
        }} />

        {/* Instructions */}
        <h2 style={{ marginBottom: '16px', fontSize: '1.3rem' }}>Access Your Dashboard</h2>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', lineHeight: 1.7 }}>
          PayIT uses secure magic links — no passwords needed.
        </p>

        <div style={{
          background: 'var(--color-bg-card)',
          borderRadius: 'var(--radius-md)',
          padding: '20px',
          margin: '24px 0',
          textAlign: 'left',
        }}>
          {[
            { step: '1', text: 'Open PayIT bot on Telegram' },
            { step: '2', text: 'Send the command /dashboard' },
            { step: '3', text: 'Tap the magic link sent to you' },
          ].map(({ step, text }) => (
            <div key={step} style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '12px' }}>
              <div style={{
                width: '28px', height: '28px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, var(--color-accent-primary), var(--color-accent-secondary))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.75rem', fontWeight: '700', color: 'white',
                flexShrink: 0,
              }}>
                {step}
              </div>
              <span style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>{text}</span>
            </div>
          ))}
        </div>

        <a
          href="https://t.me/PayITBot"
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-primary"
          style={{ width: '100%', justifyContent: 'center', padding: '14px' }}
        >
          <ExternalLink size={18} />
          Open PayIT on Telegram
        </a>

        <p style={{
          marginTop: '24px',
          fontSize: '0.75rem',
          color: 'var(--color-text-muted)',
          lineHeight: 1.6,
        }}>
          🔒 Your funds are secured by your private key on Monad blockchain.
          PayIT never has access to them.
        </p>

        {/* Chain badge */}
        <div style={{
          marginTop: '24px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          background: 'var(--color-bg-card)',
          padding: '6px 14px',
          borderRadius: '100px',
          fontSize: '0.75rem',
          color: 'var(--color-text-muted)',
          border: '1px solid var(--color-border-subtle)',
        }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-success)', display: 'inline-block' }} />
          Powered by Monad — 400ms finality
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
