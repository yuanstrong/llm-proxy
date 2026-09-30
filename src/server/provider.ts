import { loadConfig } from './config';
import { loadDotEnv } from './env';
import { createLogger } from './logger';
import { createProxyServer } from './server';

const providerName = process.argv[2] ?? process.env.LLM_PROXY_PROVIDER;
loadDotEnv();
if (!providerName) {
  console.error('Provider name is required');
  process.exit(1);
}

const config = loadConfig(process.env.LLM_PROXY_CONFIG);
const provider = config.providers[providerName];
if (!provider) {
  console.error(`Unknown provider '${providerName}'`);
  process.exit(1);
}

const logger = createLogger(provider.log_level ?? 'info');
const server = createProxyServer(provider, logger);
server.listen(provider.listen.port, provider.listen.host, () => {
  logger.info(`Provider '${provider.name}' listening on http://${provider.listen.host}:${provider.listen.port}`);
});

function shutdown(): void {
  logger.info(`Provider '${provider.name}' shutting down`);
  server.close(() => process.exit(0));
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
