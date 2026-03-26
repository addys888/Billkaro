const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('billkaro_token');
}

export function setToken(token: string): void {
  localStorage.setItem('billkaro_token', token);
}

export function clearToken(): void {
  localStorage.removeItem('billkaro_token');
  localStorage.removeItem('billkaro_user');
}

export function setUser(user: any): void {
  localStorage.setItem('billkaro_user', JSON.stringify(user));
}

export function getUser(): any | null {
  if (typeof window === 'undefined') return null;
  const data = localStorage.getItem('billkaro_user');
  return data ? JSON.parse(data) : null;
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

export async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    clearToken();
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
    }
    throw new Error('Authentication expired');
  }

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'API request failed');
  }

  return data as T;
}
