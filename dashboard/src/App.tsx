import React, { useState, useEffect } from 'react';
import { LayoutDashboard, FileText, Clock, LogOut, Wallet, ArrowRightLeft, PiggyBank, Receipt } from 'lucide-react';
import { BrowserRouter, Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import LoginPage from './pages/Login.tsx';
import Overview from './pages/Overview.tsx';
import Invoices from './pages/Invoices.tsx';
import History from './pages/History.tsx';
import Savings from './pages/Savings.tsx';
import Bills from './pages/Bills.tsx';
import Swap from './pages/Swap.tsx';
import { api, type UserProfile } from './lib/api.ts';
import './index.css';

// ── Auth Context ──────────────────────────────────────────────────────────────

const AuthContext = React.createContext<{
  user: UserProfile | null;
  loading: boolean;
  logout: () => void;
} | null>(null);

function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

// ── Auth Provider ─────────────────────────────────────────────────────────────

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getMe()
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const logout = () => {
    document.cookie = 'payit_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// ── Protected Route ───────────────────────────────────────────────────────────

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div className="loading-spinner" />
      </div>
    );
  }

  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

const navItems = [
  { to: '/dashboard', icon: <LayoutDashboard size={18} />, label: 'Overview' },
  { to: '/invoices', icon: <FileText size={18} />, label: 'Invoices' },
  { to: '/history', icon: <Clock size={18} />, label: 'History' },
  { to: '/add-funds', icon: <ArrowRightLeft size={18} />, label: 'Add Funds' },
  { to: '/savings', icon: <PiggyBank size={18} />, label: 'Savings & Yield' },
  { to: '/bills', icon: <Receipt size={18} />, label: 'Pay Bills' },
];

function Sidebar() {
  const { user, logout } = useAuth();

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div>
        <div className="nav-logo">PayIT</div>
        <p className="nav-subtitle">Payment Solution</p>
      </div>

      {/* Chain status */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '8px 12px', marginBottom: '8px',
        background: 'var(--color-bg-card)',
        borderRadius: 'var(--radius-md)',
        fontSize: '0.75rem', color: 'var(--color-text-muted)',
        border: '1px solid var(--color-border-subtle)',
      }}>
        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--color-success)', display: 'inline-block', flexShrink: 0 }} />
        System Online
      </div>

      {/* Nav */}
      <div className="nav-section-label">Navigation</div>
      {navItems.map(({ to, icon, label }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
        >
          {icon}
          {label}
          {label === 'Invoices' && (
            <span style={{
              marginLeft: 'auto',
              background: 'var(--color-accent-glow)',
              color: 'var(--color-accent-primary)',
              borderRadius: '100px',
              padding: '1px 7px',
              fontSize: '0.65rem',
              fontWeight: 700,
            }}>
              NEW
            </span>
          )}
        </NavLink>
      ))}

      {/* User */}
      <div style={{ marginTop: 'auto' }}>
        <div className="nav-section-label">Account</div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '12px',
          background: 'var(--color-bg-card)',
          borderRadius: 'var(--radius-md)',
          marginBottom: '8px',
        }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--color-accent-primary), var(--color-accent-secondary))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Wallet size={16} color="white" />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.firstName ?? user?.username ?? 'PayIT User'}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
              {user?.accountType}
            </div>
          </div>
        </div>

        <button
          className="nav-item"
          onClick={logout}
          style={{ width: '100%', border: 'none', background: 'transparent', cursor: 'pointer' }}
        >
          <LogOut size={18} />
          Sign Out
        </button>
      </div>
    </aside>
  );
}

// ── Dashboard Layout ──────────────────────────────────────────────────────────

function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <div className="app-layout">
        <Sidebar />
        <main className="main-content">{children}</main>
      </div>
    </ProtectedRoute>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/auth" element={<AuthCallback />} />
          <Route path="/dashboard" element={<DashboardLayout><Overview /></DashboardLayout>} />
          <Route path="/invoices" element={<DashboardLayout><Invoices /></DashboardLayout>} />
          <Route path="/history" element={<DashboardLayout><History /></DashboardLayout>} />
          <Route path="/add-funds" element={<DashboardLayout><Swap /></DashboardLayout>} />
          <Route path="/savings" element={<DashboardLayout><Savings /></DashboardLayout>} />
          <Route path="/bills" element={<DashboardLayout><Bills /></DashboardLayout>} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

// Auth callback — magic link validation redirects here
function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    // The backend has already set the cookie via redirect.
    // Try to fetch user, then redirect to dashboard.
    api.getMe()
      .then(() => navigate('/dashboard', { replace: true }))
      .catch(() => navigate('/login', { replace: true }));
  }, [navigate]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <div style={{ textAlign: 'center' }}>
        <div className="loading-spinner" style={{ margin: '0 auto 16px' }} />
        <p>Verifying your session...</p>
      </div>
    </div>
  );
}

export default App;
