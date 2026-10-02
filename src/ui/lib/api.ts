import type { LogEntry, LogLevel, ManagementStatus, PromptHistoryEntry, ProviderStatus } from '../../types';

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

export function getPromptHistory(provider?: string): Promise<PromptHistoryEntry[]> {
  const query = provider ? `?provider=${encodeURIComponent(provider)}` : '';
  return requestJson<PromptHistoryEntry[]>(`/admin/api/prompt-history${query}`);
}

export function changeProviderState(name: string, running: boolean): Promise<ProviderStatus> {
  const action = running ? 'stop' : 'start';
  return requestJson<ProviderStatus>(`/admin/api/providers/${encodeURIComponent(name)}/${action}`, { method: 'POST' });
}
