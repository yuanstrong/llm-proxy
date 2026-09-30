import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'smol-toml';
import { AppConfig, ProviderConfig } from './types';

export function loadConfig(configPath?: string): AppConfig {
  const filePath = configPath ?? path.resolve(__dirname, '..', 'config.toml');

  if (!fs.existsSync(filePath)) {
    console.error(`Config file not found: ${filePath}`);
    process.exit(1);
  }

  let raw: any;
  try {
    raw = parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e: any) {
    console.error(`Failed to parse config.toml: ${e.message}`);
    process.exit(1);
  }

  // Validate listen
  const listenStr = raw.listen;
  if (typeof listenStr !== 'string' || !listenStr.includes(':')) {
    console.error('config.toml: "listen" must be in "host:port" format (e.g. "127.0.0.1:8964")');
    process.exit(1);
  }
  const lastColon = listenStr.lastIndexOf(':');
  const host = listenStr.substring(0, lastColon);
  const port = parseInt(listenStr.substring(lastColon + 1), 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    console.error(`config.toml: invalid port in "listen": ${listenStr}`);
    process.exit(1);
  }

  // Validate provider selection
  const providerName = process.env.LLM_PROXY_PROVIDER;
  if (!providerName) {
    console.error('LLM_PROXY_PROVIDER environment variable is required');
    console.error('Usage: LLM_PROXY_PROVIDER=<name> pnpm start');
    process.exit(1);
  }

  const providers = raw.providers as Record<string, any> | undefined;
  if (!providers || Object.keys(providers).length === 0) {
    console.error('config.toml: no [providers] section defined');
    process.exit(1);
  }

  const providerRaw = providers[providerName];
  if (!providerRaw) {
    const available = Object.keys(providers).join(', ');
    console.error(`Provider "${providerName}" not found in config.toml. Available: ${available}`);
    process.exit(1);
  }

  // Validate endpoints
  const endpoints = (providerRaw.endpoints ?? {}) as Record<string, string>;
  if (typeof endpoints !== 'object' || Object.keys(endpoints).length === 0) {
    console.error(`Provider "${providerName}" has no endpoints defined`);
    process.exit(1);
  }

  // Validate each endpoint URL
  for (const [format, url] of Object.entries(endpoints)) {
    if (typeof url !== 'string') {
      console.error(`Provider "${providerName}": endpoint "${format}" must be a URL string`);
      process.exit(1);
    }
    try {
      new URL(url);
    } catch {
      console.error(`Provider "${providerName}": endpoint "${format}" has invalid URL: ${url}`);
      process.exit(1);
    }
  }

  const models = (providerRaw.models ?? {}) as Record<string, string>;

  const provider: ProviderConfig = {
    name: providerName,
    api_key: providerRaw.api_key,
    endpoints,
    models,
  };

  return { listen: { host, port }, provider };
}
