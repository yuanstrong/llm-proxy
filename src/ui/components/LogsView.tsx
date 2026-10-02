import { useEffect, useState } from 'react';
import { AlertCircle, Filter, LoaderCircle, RefreshCw } from 'lucide-react';
import type { LogEntry, LogLevel, ProviderOverview } from '../../types';
import { getLogs } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface LogsViewProps { providers: ProviderOverview[]; onError: (message: string) => void; }
const levels: Array<LogLevel | ''> = ['', 'debug', 'info', 'warn', 'error'];

export function LogsView({ providers, onError }: LogsViewProps): React.JSX.Element {
  const [provider, setProvider] = useState('');
  const [level, setLevel] = useState<LogLevel | ''>('');
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  async function load(): Promise<void> {
    setLoading(true);
    try { setEntries(await getLogs({ provider: provider || undefined, level: level || undefined })); }
    catch (error) { onError(error instanceof Error ? error.message : 'Unable to load logs.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [provider, level]);

  return (
    <Card className="bg-card/80">
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0"><div><Badge variant="outline" className="mb-2">Live diagnostics</Badge><CardTitle>Provider logs</CardTitle><p className="mt-1 text-sm text-muted-foreground">Use the filters in the table header to narrow captured provider output.</p></div><Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw aria-hidden="true" className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</Button></CardHeader>
      <CardContent>
        <Table className="min-w-[760px]"><TableHeader><TableRow>
          <TableHead className="w-44">Time</TableHead>
          <TableHead className="w-52"><div className="space-y-2"><span className="flex items-center gap-1.5"><Filter aria-hidden="true" className="size-3.5" />Provider</span><Select aria-label="Filter logs by provider" value={provider} onChange={(event) => setProvider(event.target.value)}><option value="">All providers</option>{providers.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</Select></div></TableHead>
          <TableHead className="w-40"><div className="space-y-2"><span>Level</span><Select aria-label="Filter logs by level" value={level} onChange={(event) => setLevel(event.target.value as LogLevel | '')}>{levels.map((item) => <option key={item || 'all'} value={item}>{item ? item[0].toUpperCase() + item.slice(1) : 'All levels'}</option>)}</Select></div></TableHead>
          <TableHead>Message</TableHead>
        </TableRow></TableHeader><TableBody>{loading ? <TableRow><TableCell colSpan={4} className="h-28 text-center text-muted-foreground"><LoaderCircle className="mx-auto mb-2 size-5 animate-spin" />Loading logs…</TableCell></TableRow> : entries.length ? entries.map((entry, index) => <TableRow key={`${entry.provider}-${entry.level}-${index}`}><TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">{entry.timestamp ? formatTime(entry.timestamp) : '—'}</TableCell><TableCell className="font-medium">{entry.provider}</TableCell><TableCell><Badge variant={entry.level === 'error' ? 'destructive' : entry.level === 'warn' ? 'warning' : entry.level === 'info' ? 'default' : 'secondary'}>{entry.level}</Badge></TableCell><TableCell className="max-w-xl font-mono text-xs text-muted-foreground">{entry.message}</TableCell></TableRow>) : <TableRow><TableCell colSpan={4} className="h-28 text-center text-muted-foreground"><AlertCircle className="mx-auto mb-2 size-5" />No matching log entries.</TableCell></TableRow>}</TableBody></Table>
      </CardContent>
    </Card>
  );
}

function formatTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString(); }
