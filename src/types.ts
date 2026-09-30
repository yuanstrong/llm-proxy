export type ApiFormat = 'anthropic' | 'openai-completions' | 'openai-responses';

export interface ProviderConfig {
  name: string;
  api_key?: string;
  endpoints: Partial<Record<ApiFormat, string>>;
  models: Record<string, string>;
}

export interface AppConfig {
  listen: { host: string; port: number };
  provider: ProviderConfig;
}
