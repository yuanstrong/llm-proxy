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

export interface ManagementStatus {
  providerCount: number;
  providers: ProviderStatus[];
}

export interface ProviderManagerApi {
  status(): Promise<ProviderStatus[]>;
  start(name: string): Promise<ProviderStatus>;
  stop(name: string): Promise<ProviderStatus>;
}
