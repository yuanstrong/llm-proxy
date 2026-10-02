import { useState } from 'react';
import { Check, ChevronDown, Copy, Play, Square, Terminal } from 'lucide-react';
import type { ProviderOverview } from '../../types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface ProviderCardProps {
  provider: ProviderOverview;
  onToggle: (provider: ProviderOverview) => Promise<void>;
}

export function ProviderCard({ provider, onToggle }: ProviderCardProps): React.JSX.Element {
  const [copied, setCopied] = useState<'openai' | 'anthropic' | null>(null);
  const [busy, setBusy] = useState(false);

  async function copyBaseUrl(type: 'openai' | 'anthropic', value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(type);
      window.setTimeout(() => setCopied(null), 1400);
    } catch {
      // Clipboard permissions are optional; the URL remains selectable text.
    }
  }

  async function toggle(): Promise<void> {
    setBusy(true);
    try { await onToggle(provider); } finally { setBusy(false); }
  }

  return (
    <Card className="overflow-hidden border-border/80 bg-card/80">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 marker:hidden [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 items-center gap-3">
            <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${provider.running ? 'bg-emerald-500/10 text-emerald-300' : 'bg-muted text-muted-foreground'}`}>
              <Terminal aria-hidden="true" className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-semibold text-foreground">{provider.name}</span>
              <span className="block truncate font-mono text-xs text-muted-foreground">{provider.listen.host}:{provider.listen.port}</span>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <Badge variant={provider.running ? 'success' : 'secondary'}>{provider.running ? `Running${provider.pid ? ` · PID ${provider.pid}` : ''}` : 'Stopped'}</Badge>
            <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </span>
        </summary>
        <div className="border-t border-border/70 px-5 pb-5 pt-4">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <Badge variant="outline">log level: {provider.logLevel}</Badge>
            <Button variant={provider.running ? 'destructive' : 'default'} size="sm" disabled={busy} onClick={() => void toggle()}>
              {provider.running ? <Square aria-hidden="true" className="size-3.5" /> : <Play aria-hidden="true" className="size-3.5" />}
              {busy ? (provider.running ? 'Stopping…' : 'Starting…') : (provider.running ? 'Stop provider' : 'Start provider')}
            </Button>
          </div>

          <div className="space-y-3">
            <div>
              <h3 className="mb-2 text-sm font-medium text-foreground">Client base URLs</h3>
              <div className="grid gap-2 lg:grid-cols-2">
                {(['openai', 'anthropic'] as const).map((type) => {
                  const value = provider.baseUrls[type];
                  return (
                    <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-background/70 p-2" key={type}>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-cyan-200" title={value}>{value}</span>
                      <Button variant="ghost" size="icon" aria-label={`Copy ${type} base URL`} onClick={() => void copyBaseUrl(type, value)}>
                        {copied === type ? <Check aria-hidden="true" className="size-4 text-emerald-300" /> : <Copy aria-hidden="true" className="size-4" />}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-border/70 pt-3">
              <h3 className="mb-2 text-sm font-medium text-foreground">Supported upstream endpoints</h3>
              {Object.entries(provider.endpoints).length ? (
                <div className="divide-y divide-border/60 rounded-lg border border-border/70 bg-background/40">
                  {Object.entries(provider.endpoints).map(([format, endpoint]) => (
                    <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5" key={format}>
                      <Badge variant="secondary">{format}</Badge>
                      <span className="max-w-full truncate font-mono text-xs text-muted-foreground" title={endpoint}>{endpoint}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-muted-foreground">No endpoints configured.</p>}
            </div>
          </div>
        </div>
      </details>
    </Card>
  );
}
