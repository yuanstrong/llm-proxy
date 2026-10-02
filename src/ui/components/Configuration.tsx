import { RefreshCw, Settings2 } from 'lucide-react';
import type { ManagementStatus, ProviderOverview } from '../../types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ProviderCard } from '@/components/ProviderCard';

interface ConfigurationProps {
  status: ManagementStatus | null;
  loading: boolean;
  onRefresh: () => void;
  onToggleProvider: (provider: ProviderOverview) => Promise<void>;
}

export function Configuration({ status, loading, onRefresh, onToggleProvider }: ConfigurationProps): React.JSX.Element {
  const providers = status?.providers ?? [];
  return (
    <Card className="bg-card/80">
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div><Badge variant="outline" className="mb-2"><Settings2 aria-hidden="true" className="mr-1.5 size-3.5" />config.toml</Badge><CardTitle>All providers</CardTitle><p className="mt-1 text-sm text-muted-foreground">Every configured provider, including stopped providers, with its endpoints and client URLs.</p></div>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}><RefreshCw aria-hidden="true" className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && !status ? <p className="py-8 text-center text-sm text-muted-foreground">Loading configuration…</p> : providers.length ? providers.map((provider) => <ProviderCard key={provider.name} provider={provider} onToggle={onToggleProvider} />) : <p className="py-8 text-center text-sm text-muted-foreground">No providers configured.</p>}
      </CardContent>
    </Card>
  );
}
