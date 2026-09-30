import * as fs from 'fs';

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function parseValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const quote = trimmed[0];
    if ((quote === '"' || quote === "'") && trimmed[trimmed.length - 1] === quote) {
      return trimmed.slice(1, -1);
    }
  }

  return trimmed.replace(/\s+#.*$/, '').trim();
}

export function loadDotEnv(
  filePath = './.env',
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (!fs.existsSync(filePath)) return;

  const contents = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const assignment = trimmed.startsWith('export ') ? trimmed.slice('export '.length) : trimmed;
    const separator = assignment.indexOf('=');
    if (separator <= 0) continue;

    const name = assignment.slice(0, separator).trim();
    if (!ENV_NAME.test(name) || environment[name] !== undefined) continue;

    environment[name] = parseValue(assignment.slice(separator + 1));
  }
}
