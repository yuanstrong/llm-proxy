import { loadConfig } from './config';
import { loadDotEnv } from './env';
import { createManagementServer } from './management-server';
import { ProviderManager } from './provider-manager';

loadDotEnv();
const config = loadConfig(process.env.LLM_PROXY_CONFIG);
const manager = new ProviderManager(config);
const server = createManagementServer(config, manager);

server.listen(config.management.port, config.management.host, () => {
  console.log('LLM Proxy manager started');
  console.log(`  Management: http://${config.management.host}:${config.management.port}`);
  console.log(`  Providers: ${Object.keys(config.providers).length}`);
  console.log('  Start providers from the management UI or /admin/api/providers/:name/start');
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await manager.shutdown();
  server.close(() => process.exit(0));
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
