import type { ManagementStatus, ProviderStatus } from '../types';
import './styles.css';

const providerCount = document.querySelector<HTMLElement>('#provider-count');
const runningCount = document.querySelector<HTMLElement>('#running-count');
const providerTable = document.querySelector<HTMLElement>('#provider-table');
const connectionStatus = document.querySelector<HTMLElement>('#connection-status');
const errorMessage = document.querySelector<HTMLElement>('#error-message');

function showError(message: string): void {
  if (errorMessage) {
    errorMessage.textContent = message;
    errorMessage.hidden = false;
  }
  if (connectionStatus) {
    connectionStatus.textContent = 'Offline';
    connectionStatus.className = 'status-pill status-pill-error';
  }
}

function renderStatus(status: ManagementStatus): void {
  if (errorMessage) errorMessage.hidden = true;
  if (providerCount) providerCount.textContent = String(status.providerCount);
  if (runningCount) runningCount.textContent = String(status.providers.filter(({ running }) => running).length);

  if (providerTable) {
    providerTable.replaceChildren();
    for (const provider of status.providers) {
      providerTable.append(createProviderRow(provider));
    }
  }

  if (connectionStatus) {
    connectionStatus.textContent = 'Connected';
    connectionStatus.className = 'status-pill status-pill-success';
  }
}

function createProviderRow(provider: ProviderStatus): HTMLTableRowElement {
  const row = document.createElement('tr');
  const nameCell = document.createElement('td');
  const listenCell = document.createElement('td');
  const statusCell = document.createElement('td');
  const actionCell = document.createElement('td');
  const button = document.createElement('button');

  nameCell.textContent = provider.name;
  listenCell.textContent = `${provider.listen.host}:${provider.listen.port}`;
  statusCell.textContent = provider.running
    ? `Running${provider.pid ? ` · PID ${provider.pid}` : ''}`
    : 'Stopped';
  statusCell.className = provider.running ? 'status-running' : 'status-stopped';
  button.type = 'button';
  button.className = provider.running ? 'action-button action-stop' : 'action-button action-start';
  button.textContent = provider.running ? 'Stop' : 'Start';
  button.addEventListener('click', () => void changeProviderState(provider.name, provider.running, button));
  actionCell.append(button);
  row.append(nameCell, listenCell, statusCell, actionCell);
  return row;
}

async function changeProviderState(name: string, running: boolean, button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  button.textContent = running ? 'Stopping…' : 'Starting…';
  try {
    const action = running ? 'stop' : 'start';
    const response = await fetch(`/admin/api/providers/${encodeURIComponent(name)}/${action}`, { method: 'POST' });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Provider action failed (${response.status})`);
    }
    await loadStatus();
  } catch (error) {
    showError(error instanceof Error ? error.message : 'Provider action failed.');
    button.disabled = false;
    button.textContent = running ? 'Stop' : 'Start';
  }
}

async function loadStatus(): Promise<void> {
  try {
    const response = await fetch('/admin/api/status', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Status request failed (${response.status})`);
    renderStatus((await response.json()) as ManagementStatus);
  } catch (error) {
    showError(error instanceof Error ? error.message : 'Unable to load proxy status.');
  }
}

void loadStatus();
