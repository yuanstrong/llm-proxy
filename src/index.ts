import { loadConfig } from './config';
import { createServer } from './server';

const config = loadConfig();
const server = createServer(config);

server.listen(config.listen.port, config.listen.host, () => {
  const formats = Object.keys(config.provider.endpoints).join(', ');
  const modelCount = Object.keys(config.provider.models).length;
  console.log(`LLM Proxy started`);
  console.log(`  Listen: http://${config.listen.host}:${config.listen.port}`);
  console.log(`  Provider: ${config.provider.name}`);
  console.log(`  Formats: ${formats}`);
  console.log(`  Mapped models: ${modelCount}`);
});
