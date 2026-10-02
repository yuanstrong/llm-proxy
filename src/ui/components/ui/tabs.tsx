import * as React from 'react';
import { cn } from '@/lib/utils';

interface TabsContextValue { value: string; onValueChange: (value: string) => void; }
const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabs(): TabsContextValue {
  const context = React.useContext(TabsContext);
  if (!context) throw new Error('Tabs components must be used inside Tabs');
  return context;
}

interface TabsProps extends React.HTMLAttributes<HTMLDivElement> { value: string; onValueChange: (value: string) => void; }
function Tabs({ className, value, onValueChange, ...props }: TabsProps): React.JSX.Element {
  return <TabsContext.Provider value={{ value, onValueChange }}><div className={cn(className)} {...props} /></TabsContext.Provider>;
}

const TabsList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground', className)} {...props} />
));
TabsList.displayName = 'TabsList';

interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { value: string; }
const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(({ className, value, onClick, ...props }, ref) => {
  const tabs = useTabs();
  const active = tabs.value === value;
  return <button ref={ref} type="button" data-state={active ? 'active' : 'inactive'} className={cn('inline-flex items-center justify-center gap-2 rounded-sm px-3 py-1.5 text-sm font-medium transition-all hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm', className)} onClick={(event) => { tabs.onValueChange(value); onClick?.(event); }} {...props} />;
});
TabsTrigger.displayName = 'TabsTrigger';

interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> { value: string; }
const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(({ className, value, ...props }, ref) => {
  const tabs = useTabs();
  return <div ref={ref} data-state={tabs.value === value ? 'active' : 'inactive'} hidden={tabs.value !== value} className={cn('mt-4 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)} {...props} />;
});
TabsContent.displayName = 'TabsContent';

export { Tabs, TabsList, TabsTrigger, TabsContent };
