export type ApiFormat = 'anthropic' | 'openai-completions' | 'openai-responses';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ProviderConfig {
  name: string;
  listen: { host: string; port: number };
  api_key?: string;
  log_level?: LogLevel;
  endpoints: Partial<Record<ApiFormat, string>>;
  models: Record<string, string>;
}

export interface AppConfig {
  management: { host: string; port: number };
  providers: Record<string, ProviderConfig>;
  configPath: string;
}

export interface ProviderStatus {
  name: string;
  listen: { host: string; port: number };
  running: boolean;
  pid?: number;
}

export interface ProviderOverview extends ProviderStatus {
  endpoints: Partial<Record<ApiFormat, string>>;
  logLevel: LogLevel;
  baseUrls: {
    openai: string;
    anthropic: string;
  };
}

export interface ManagementStatus {
  providerCount: number;
  providers: ProviderOverview[];
}

export interface LogEntry {
  timestamp?: string;
  provider: string;
  level: LogLevel;
  message: string;
}

export interface PromptHistoryEntry {
  timestamp: string;
  provider: string;
  format: ApiFormat;
  model?: string;
  prompt: string;
  response: string;
  status: number;
  durationMs: number;
}

export interface ProviderManagerApi {
  status(): Promise<ProviderStatus[]>;
  start(name: string): Promise<ProviderStatus>;
  stop(name: string): Promise<ProviderStatus>;
}
