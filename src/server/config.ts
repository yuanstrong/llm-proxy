import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'smol-toml';
import type { ApiFormat, AppConfig, LogLevel, ProviderConfig } from '../types';

const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

function resolveEnvironmentReferences(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
      const resolved = process.env[name];
      if (resolved === undefined) {
        throw new Error(`environment variable "${name}" is not set`);
      }
      return resolved;
    });
  }
  if (Array.isArray(value)) return value.map(resolveEnvironmentReferences);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, resolveEnvironmentReferences(nestedValue)]),
    );
  }
  return value;
}

function parseListenAddress(value: unknown, fieldName: string): { host: string; port: number } {
  if (typeof value !== 'string' || !value.includes(':')) {
    console.error(`config.toml: "${fieldName}" must be in "host:port" format (e.g. "127.0.0.1:8964")`);
    process.exit(1);
  }

  const lastColon = value.lastIndexOf(':');
  const host = value.substring(0, lastColon);
  const portText = value.substring(lastColon + 1);
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`config.toml: invalid port in "${fieldName}": ${value}`);
    process.exit(1);
  }

  return { host, port };
}

export function loadConfig(configPath?: string): AppConfig {
  const defaultConfigPaths = [
    path.resolve(__dirname, '..', '..', 'config.toml'),
    path.resolve(__dirname, '..', '..', '..', 'config.toml'),
  ];
  const filePath = configPath ?? defaultConfigPaths.find((candidate) => fs.existsSync(candidate)) ?? defaultConfigPaths[0];

  if (!fs.existsSync(filePath)) {
    console.error(`Config file not found: ${filePath}`);
    process.exit(1);
  }

  let raw: any;
  try {
    raw = resolveEnvironmentReferences(parse(fs.readFileSync(filePath, 'utf-8')));
  } catch (e: any) {
    console.error(`Failed to parse config.toml: ${e.message}`);
    process.exit(1);
  }

  const providers = raw.providers as Record<string, any> | undefined;
  if (!providers || Object.keys(providers).length === 0) {
    console.error('config.toml: no [providers] section defined');
    process.exit(1);
  }

  const parsedProviders: Record<string, ProviderConfig> = {};
  for (const [providerName, providerRaw] of Object.entries(providers)) {
    const endpoints = (providerRaw.endpoints ?? {}) as Record<string, string>;
    if (typeof endpoints !== 'object' || Object.keys(endpoints).length === 0) {
      console.error(`Provider "${providerName}" has no endpoints defined`);
      process.exit(1);
    }

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
    const listen = parseListenAddress(providerRaw.listen, `providers.${providerName}.listen`);
    const logLevel = providerRaw.log_level ?? 'info';
    if (typeof logLevel !== 'string' || !LOG_LEVELS.includes(logLevel as LogLevel)) {
      console.error(
        `Provider "${providerName}": log_level must be one of ${LOG_LEVELS.join(', ')}`,
      );
      process.exit(1);
    }
    parsedProviders[providerName] = {
      name: providerName,
      listen,
      api_key: providerRaw.api_key,
      log_level: logLevel as LogLevel,
      endpoints: endpoints as Partial<Record<ApiFormat, string>>,
      models,
    };
  }

  return {
    management: { host: '127.0.0.1', port: 3000 },
    providers: parsedProviders,
    configPath: filePath,
  };
}
