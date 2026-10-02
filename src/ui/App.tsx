import { useCallback, useEffect, useState } from 'react';
import { Activity, AlertTriangle, BookOpenText, CheckCircle2, RefreshCw, ScrollText, WifiOff } from 'lucide-react';
import type { ManagementStatus, ProviderOverview } from '../types';
import { changeProviderState, getStatus } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LogsView } from '@/components/LogsView';
import { Overview } from '@/components/Overview';
import { PromptHistoryView } from '@/components/PromptHistoryView';

type View = 'overview' | 'logs' | 'history';

export function App(): React.JSX.Element {
  const [view, setView] = useState<View>('overview');
  const [status, setStatus] = useState<ManagementStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyCount, setHistoryCount] = useState<number | null>(null);

  const refreshStatus = useCallback(async (): Promise<void> => {
    setLoading(true);
    try { setStatus(await getStatus()); setError(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to load proxy status.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  async function toggleProvider(provider: ProviderOverview): Promise<void> {
    try { await changeProviderState(provider.name, provider.running); await refreshStatus(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Provider action failed.'); }
  }

  const providers = status?.providers ?? [];
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/70 bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3"><div className="flex size-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-300"><Activity aria-hidden="true" className="size-5" /></div><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Local control plane</p><h1 className="text-lg font-semibold tracking-tight">LLM Proxy</h1></div></div>
          <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${error ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'}`}>{error ? <WifiOff aria-hidden="true" className="size-3.5" /> : <CheckCircle2 aria-hidden="true" className="size-3.5" />}{error ? 'Offline' : 'Connected'}</div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {error ? <div className="mb-5 flex items-start gap-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"><AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><p>{error}</p><Button variant="ghost" size="icon" className="ml-auto -mr-2 -mt-2 text-rose-200 hover:bg-rose-500/10" onClick={() => setError(null)} aria-label="Dismiss error">×</Button></div> : null}
        <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Operations dashboard</p><p className="max-w-2xl text-sm text-muted-foreground">See what is configured, what is running, and what is moving through the proxy.</p></div><Button variant="ghost" size="sm" onClick={() => void refreshStatus()} disabled={loading}><RefreshCw aria-hidden="true" className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh status</Button></div>

        <Tabs value={view} onValueChange={(value) => setView(value as View)}>
          <TabsList className="mb-6 h-auto w-full justify-start gap-1 overflow-x-auto rounded-lg border border-border/70 bg-card/60 p-1 sm:w-auto">
            <TabsTrigger value="overview"><BookOpenText aria-hidden="true" className="size-4" />Overview</TabsTrigger>
            <TabsTrigger value="logs"><ScrollText aria-hidden="true" className="size-4" />Logs</TabsTrigger>
            <TabsTrigger value="history"><Activity aria-hidden="true" className="size-4" />Prompt history</TabsTrigger>
          </TabsList>
          <TabsContent value="overview"><Overview status={status} historyCount={historyCount} loading={loading} onRefresh={() => void refreshStatus()} onToggleProvider={toggleProvider} /></TabsContent>
          <TabsContent value="logs"><LogsView providers={providers} onError={setError} /></TabsContent>
          <TabsContent value="history"><PromptHistoryView providers={providers} onError={setError} onCountChange={setHistoryCount} /></TabsContent>
        </Tabs>
        <p className="mt-6 text-xs text-muted-foreground">Provider API keys are never returned to this console. Prompt history contains request and response text from proxied exchanges.</p>
      </main>
    </div>
  );
}

export default App;
