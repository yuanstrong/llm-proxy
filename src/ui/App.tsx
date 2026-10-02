import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { ManagementStatus, ProviderOverview } from '../types';
import { changeProviderState, getStatus } from '@/lib/api';
import { type View } from '@/lib/navigation';
import { Button } from '@/components/ui/button';
import { Configuration } from '@/components/Configuration';
import { LogsView } from '@/components/LogsView';
import { Overview } from '@/components/Overview';
import { PromptHistoryView } from '@/components/PromptHistoryView';
import { SideNav } from '@/components/SideNav';

const pageMeta: Record<View, { eyebrow: string; title: string; description: string }> = {
  overview: {
    eyebrow: 'Operations dashboard',
    title: 'Overview',
    description: 'A quick read on the proxy and the providers serving traffic right now.',
  },
  configuration: {
    eyebrow: 'Provider setup',
    title: 'Configuration',
    description: 'Inspect every provider from config.toml and manage its runtime state.',
  },
  logs: {
    eyebrow: 'Live diagnostics',
    title: 'Logs',
    description: 'Review captured provider output and filter it directly from the table.',
  },
  prompts: {
    eyebrow: 'Request trace',
    title: 'Prompts',
    description: 'Browse the latest locally captured prompts and responses.',
  },
};

export function App(): React.JSX.Element {
  const [view, setView] = useState<View>('overview');
  const [status, setStatus] = useState<ManagementStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyCount, setHistoryCount] = useState<number | null>(null);

  const refreshStatus = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setStatus(await getStatus());
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load proxy status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  async function toggleProvider(provider: ProviderOverview): Promise<void> {
    try {
      await changeProviderState(provider.name, provider.running);
      await refreshStatus();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Provider action failed.');
    }
  }

  const providers = status?.providers ?? [];
  const currentPage = pageMeta[view];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <SideNav view={view} connected={!error} onViewChange={setView} />
        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
            {error ? (
              <div className="mb-6 flex items-start gap-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <p>{error}</p>
                <Button variant="ghost" size="icon" className="ml-auto -mr-2 -mt-2 text-rose-200 hover:bg-rose-500/10" onClick={() => setError(null)} aria-label="Dismiss error">×</Button>
              </div>
            ) : null}

            <header className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">{currentPage.eyebrow}</p>
                <h2 className="text-3xl font-semibold tracking-tight text-foreground">{currentPage.title}</h2>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{currentPage.description}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => void refreshStatus()} disabled={loading}>
                <RefreshCw aria-hidden="true" className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
                Refresh status
              </Button>
            </header>

            {view === 'overview' ? (
              <Overview
                status={status}
                historyCount={historyCount}
                loading={loading}
                onRefresh={() => void refreshStatus()}
                onToggleProvider={toggleProvider}
                onOpenConfiguration={() => setView('configuration')}
              />
            ) : null}
            {view === 'configuration' ? (
              <Configuration
                status={status}
                loading={loading}
                onRefresh={() => void refreshStatus()}
                onToggleProvider={toggleProvider}
              />
            ) : null}
            {view === 'logs' ? <LogsView providers={providers} onError={setError} /> : null}
            {view === 'prompts' ? <PromptHistoryView providers={providers} onError={setError} onCountChange={setHistoryCount} /> : null}

            <p className="mt-8 text-xs text-muted-foreground">Provider API keys are never returned to this console. Prompt history contains request and response text from proxied exchanges.</p>
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
