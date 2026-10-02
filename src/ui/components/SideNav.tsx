import {
  Activity,
  FileSliders,
  LayoutDashboard,
  MessageSquareText,
  ScrollText,
  CheckCircle2,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { navigationItems, type View } from '@/lib/navigation';

interface SideNavProps {
  view: View;
  connected: boolean;
  onViewChange: (view: View) => void;
}

const icons: Record<View, LucideIcon> = {
  overview: LayoutDashboard,
  configuration: FileSliders,
  logs: ScrollText,
  prompts: MessageSquareText,
};

function NavigationLinks({ view, onViewChange }: Pick<SideNavProps, 'view' | 'onViewChange'>): React.JSX.Element {
  return (
    <>
      {navigationItems.map((item) => {
        const Icon = icons[item.id];
        const active = item.id === view;
        return (
          <button
            key={item.id}
            type="button"
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${active ? 'bg-cyan-400/10 text-cyan-200 shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
            onClick={() => onViewChange(item.id)}
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            {item.label}
          </button>
        );
      })}
    </>
  );
}

export function SideNav({ view, connected, onViewChange }: SideNavProps): React.JSX.Element {
  return (
    <>
      <aside className="hidden w-64 shrink-0 border-r border-border/70 bg-card/35 lg:flex lg:min-h-screen lg:flex-col">
        <div className="flex items-center gap-3 border-b border-border/70 px-6 py-6">
          <div className="flex size-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-300">
            <Activity aria-hidden="true" className="size-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">Control plane</p>
            <h1 className="text-lg font-semibold tracking-tight text-foreground">LLM Proxy</h1>
          </div>
        </div>
        <nav aria-label="Main navigation" className="flex flex-1 flex-col gap-1 p-4">
          <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Workspace</p>
          <NavigationLinks view={view} onViewChange={onViewChange} />
        </nav>
        <ConnectionStatus connected={connected} />
      </aside>

      <div className="border-b border-border/70 bg-card/35 px-4 py-3 lg:hidden">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-300">
              <Activity aria-hidden="true" className="size-4" />
            </div>
            <h1 className="font-semibold tracking-tight text-foreground">LLM Proxy</h1>
          </div>
          <ConnectionStatus connected={connected} compact />
        </div>
        <nav aria-label="Main navigation" className="flex gap-1 overflow-x-auto">
          <NavigationLinks view={view} onViewChange={onViewChange} />
        </nav>
      </div>
    </>
  );
}

function ConnectionStatus({ connected, compact = false }: { connected: boolean; compact?: boolean }): React.JSX.Element {
  const Icon = connected ? CheckCircle2 : WifiOff;
  return (
    <div className={`flex items-center gap-2 text-xs font-semibold ${connected ? 'text-emerald-300' : 'text-rose-300'} ${compact ? '' : 'border-t border-border/70 px-6 py-4'}`}>
      <Icon aria-hidden="true" className="size-3.5" />
      {connected ? 'Connected' : 'Offline'}
    </div>
  );
}
