import { Activity, ArrowRight, History, Server } from 'lucide-react';
import type { ManagementStatus, ProviderOverview } from '../../types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ProviderCard } from '@/components/ProviderCard';

interface OverviewProps {
  status: ManagementStatus | null;
  historyCount: number | null;
  loading: boolean;
  onRefresh: () => void;
  onToggleProvider: (provider: ProviderOverview) => Promise<void>;
  onOpenConfiguration: () => void;
}

function SummaryCard({ icon: Icon, label, value, tone }: { icon: typeof Activity; label: string; value: string; tone: string }): React.JSX.Element {
  return <Card className="bg-card/80"><CardContent className="flex items-center justify-between p-5"><div><p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{value}</p></div><span className={`flex size-10 items-center justify-center rounded-xl ${tone}`}><Icon aria-hidden="true" className="size-5" /></span></CardContent></Card>;
}

export function Overview({ status, historyCount, loading, onRefresh, onToggleProvider, onOpenConfiguration }: OverviewProps): React.JSX.Element {
  const providers = status?.providers ?? [];
  const runningProviders = providers.filter((provider) => provider.running);
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard icon={Server} label="Configured providers" value={loading && !status ? '—' : String(status?.providerCount ?? 0)} tone="bg-cyan-500/10 text-cyan-300" />
        <SummaryCard icon={Activity} label="Running providers" value={loading && !status ? '—' : String(runningProviders.length)} tone="bg-emerald-500/10 text-emerald-300" />
        <SummaryCard icon={History} label="Captured exchanges" value={historyCount === null ? '—' : String(historyCount)} tone="bg-violet-500/10 text-violet-300" />
      </div>

      <Card className="bg-card/80">
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div><Badge variant="outline" className="mb-2">Runtime</Badge><CardTitle>Running providers</CardTitle><p className="mt-1 text-sm text-muted-foreground">Only providers serving traffic are shown here. Open Configuration to inspect every provider.</p></div>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>Refresh</Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && !status ? <p className="py-8 text-center text-sm text-muted-foreground">Loading runtime status…</p> : runningProviders.length ? runningProviders.map((provider) => <ProviderCard key={provider.name} provider={provider} onToggle={onToggleProvider} />) : (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-muted-foreground">No providers are running right now.</p>
              <Button variant="outline" size="sm" onClick={onOpenConfiguration}>Open Configuration <ArrowRight aria-hidden="true" className="size-3.5" /></Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
