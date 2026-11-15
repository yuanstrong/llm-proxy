import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock3, Inbox, LoaderCircle, RefreshCw } from 'lucide-react';
import type { PromptHistoryEntry, ProviderOverview } from '../../types';
import { getPromptHistory, getPromptHistoryDates } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface PromptHistoryViewProps { providers: ProviderOverview[]; onError: (message: string) => void; onCountChange: (count: number) => void; }

export function PromptHistoryView({ providers, onError, onCountChange }: PromptHistoryViewProps): React.JSX.Element {
  const [provider, setProvider] = useState('');
  const [entries, setEntries] = useState<PromptHistoryEntry[]>([]);
  const [dates, setDates] = useState<string[]>([]);
  const [today, setToday] = useState('');
  const [date, setDate] = useState('');
  const [loading, setLoading] = useState(true);

  async function loadDates(): Promise<void> {
    try {
      const info = await getPromptHistoryDates(provider || undefined);
      setDates(info.dates);
      setToday(info.today);
      setDate((current) => (current && info.dates.includes(current) ? current : info.today));
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Unable to load prompt history dates.');
    }
  }

  async function load(): Promise<void> {
    if (!date) return;
    setLoading(true);
    try {
      const next = await getPromptHistory(provider || undefined, date);
      setEntries(next);
      onCountChange(next.length);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Unable to load prompt history.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadDates(); }, [provider]);
  useEffect(() => { if (date) void load(); }, [provider, date]);

  const dateIndex = dates.indexOf(date);
  const previousDate = dateIndex > 0 ? dates[dateIndex - 1] : undefined;
  const nextDate = dateIndex >= 0 && dateIndex < dates.length - 1 ? dates[dateIndex + 1] : undefined;

  return (
    <Card className="bg-card/80">
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0"><div><Badge variant="outline" className="mb-2">Request trace</Badge><CardTitle>Prompts</CardTitle><p className="mt-1 text-sm text-muted-foreground">Latest prompt and response exchanges appear first. Content is stored locally under the runtime home.</p></div><Button variant="outline" size="sm" onClick={() => { void loadDates(); void load(); }} disabled={loading}><RefreshCw aria-hidden="true" className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</Button></CardHeader>
      <CardContent>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <label className="block w-full max-w-xs space-y-1.5 text-xs font-medium text-muted-foreground"><span>Provider</span><Select value={provider} onChange={(event) => setProvider(event.target.value)}><option value="">All providers</option>{providers.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</Select></label>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { if (previousDate) setDate(previousDate); }} disabled={!previousDate || loading}><ChevronLeft aria-hidden="true" className="size-3.5" />Previous day</Button>
            <span className="min-w-32 text-center text-xs font-medium text-muted-foreground">{formatDate(date)}{date && date === today ? ' · Today' : ''}</span>
            <Button variant="outline" size="sm" onClick={() => { if (nextDate) setDate(nextDate); }} disabled={!nextDate || loading}>Next day<ChevronRight aria-hidden="true" className="size-3.5" /></Button>
          </div>
        </div>
        {loading ? <div className="py-12 text-center text-sm text-muted-foreground"><LoaderCircle className="mx-auto mb-2 size-5 animate-spin" />Loading prompt history…</div> : entries.length ? <div className="space-y-3">{entries.map((entry, index) => <HistoryEntry entry={entry} key={`${entry.timestamp}-${entry.provider}-${index}`} />)}</div> : <div className="py-12 text-center text-sm text-muted-foreground"><Inbox className="mx-auto mb-2 size-5" />No prompt history captured for {date ? formatDate(date) : 'this day'}.</div>}
      </CardContent>
    </Card>
  );
}

function HistoryEntry({ entry }: { entry: PromptHistoryEntry }): React.JSX.Element {
  return <article className="rounded-xl border border-border/70 bg-background/35 p-4"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 pb-3"><div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-foreground">{entry.provider}</span>{entry.model ? <><span className="text-muted-foreground">·</span><span className="font-mono text-xs text-muted-foreground">{entry.model}</span></> : null}</div><div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Clock3 aria-hidden="true" className="size-3.5" />{formatTime(entry.timestamp)}<Badge variant="secondary">{entry.format}</Badge><Badge variant={entry.status >= 400 ? 'destructive' : 'success'}>{entry.status}</Badge><span>{entry.durationMs.toFixed(0)} ms</span></div></div><div className="mt-4 grid gap-3 lg:grid-cols-2"><div><p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Prompt</p><Textarea readOnly value={entry.prompt} className="min-h-24 resize-y bg-card/60" /></div><div><p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Response</p><Textarea readOnly value={entry.response} className="min-h-24 resize-y bg-card/60" /></div></div></article>;
}

function formatTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); }

function formatDate(value: string): string {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}
