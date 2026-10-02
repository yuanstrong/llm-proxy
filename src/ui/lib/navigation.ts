export type View = 'overview' | 'configuration' | 'logs' | 'prompts';

export const navigationItems: Array<{ id: View; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'configuration', label: 'Configuration' },
  { id: 'logs', label: 'Logs' },
  { id: 'prompts', label: 'Prompts' },
];
