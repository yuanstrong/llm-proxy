import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export function getRuntimeHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.LLM_PROXY_HOME?.trim();
  return configured || path.join(os.homedir(), '.llm_proxy');
}

export function getPidDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(getRuntimeHome(env), 'var', 'pids');
}

export function getLogDirectory(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(getRuntimeHome(env), 'var', 'logs');
}

export function ensureRuntimeDirectories(env: NodeJS.ProcessEnv = process.env): string {
  const pidDirectory = getPidDirectory(env);
  fs.mkdirSync(pidDirectory, { recursive: true });
  fs.mkdirSync(getLogDirectory(env), { recursive: true });
  return pidDirectory;
}
