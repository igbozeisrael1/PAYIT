// API client for PayIT dashboard
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error((error as { error: string }).error || 'Request failed');
  }

  return res.json() as Promise<T>;
}

export interface UserProfile {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  accountType: 'PERSONAL' | 'BUSINESS' | 'BOTH';
  activeWallet: 'PERSONAL' | 'BUSINESS';
  createdAt: string;
  wallets: Array<{ walletType: string; address: string; cachedBalance: string }>;
}

export interface Invoice {
  id: string;
  clientName: string;
  subtotal: string;
  vatAmount: string;
  whtAmount: string;
  total: string;
  status: 'DRAFT' | 'SENT' | 'PAID' | 'OVERDUE' | 'CANCELLED';
  createdAt: string;
  paidAt: string | null;
  dueDate: string | null;
  paymentLink: string | null;
  onchainInvoiceId: string | null;
}

export interface LedgerSummary {
  totalRevenue: string;
  totalVat: string;
  totalWht: string;
  invoiceCount: number;
  period: string;
}

export interface Transaction {
  id: string;
  type: string;
  status: string;
  amount: string;
  counterpartyRef: string | null;
  txHash: string | null;
  createdAt: string;
}

export interface BalanceResponse {
  usdc: string;
  address: string;
  walletType: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const api = {
  getMe: () => fetchApi<{ user: UserProfile }>('/api/me'),

  getInvoices: (params?: { page?: number; status?: string }) => {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.status) query.set('status', params.status);
    return fetchApi<{ invoices: Invoice[]; total: number; page: number; totalPages: number }>(
      `/api/invoices?${query}`,
    );
  },

  getLedgerSummary: (month?: string) => {
    const query = month ? `?month=${month}` : '';
    return fetchApi<LedgerSummary>(`/api/invoices/summary${query}`);
  },

  getTransactions: (params?: { page?: number; walletType?: string }) => {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.walletType) query.set('walletType', params.walletType);
    return fetchApi<{ transactions: Transaction[]; total: number; totalPages: number }>(
      `/api/transactions?${query}`,
    );
  },

  getBalance: (walletType?: string) => {
    const query = walletType ? `?walletType=${walletType}` : '';
    return fetchApi<BalanceResponse>(`/api/balance${query}`);
  },
};
