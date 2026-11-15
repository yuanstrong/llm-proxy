import type {
  LogEntry,
  LogLevel,
  ManagementStatus,
  PromptHistoryDates,
  PromptHistoryEntry,
  ProviderStatus,
} from '../../types';

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { headers: { Accept: 'application/json', ...init?.headers }, ...init });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function getStatus(): Promise<ManagementStatus> {
  return requestJson<ManagementStatus>('/admin/api/status');
}

export function getLogs(filters: { provider?: string; level?: LogLevel }): Promise<LogEntry[]> {
  const query = new URLSearchParams();
  if (filters.provider) query.set('provider', filters.provider);
  if (filters.level) query.set('level', filters.level);
  return requestJson<LogEntry[]>(`/admin/api/logs?${query.toString()}`);
}

export function getPromptHistory(provider?: string, date?: string): Promise<PromptHistoryEntry[]> {
  const query = new URLSearchParams();
  if (provider) query.set('provider', provider);
  if (date) query.set('date', date);
  const search = query.toString();
  return requestJson<PromptHistoryEntry[]>(`/admin/api/prompt-history${search ? `?${search}` : ''}`);
}

export function getPromptHistoryDates(provider?: string): Promise<PromptHistoryDates> {
  const query = provider ? `?provider=${encodeURIComponent(provider)}` : '';
  return requestJson<PromptHistoryDates>(`/admin/api/prompt-history/dates${query}`);
}

export function changeProviderState(name: string, running: boolean): Promise<ProviderStatus> {
  const action = running ? 'stop' : 'start';
  return requestJson<ProviderStatus>(`/admin/api/providers/${encodeURIComponent(name)}/${action}`, { method: 'POST' });
}
