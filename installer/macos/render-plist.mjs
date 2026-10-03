import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [outputPath, label, nodeBin, appRoot, configPath, runtimeHome, envPath] = process.argv.slice(2);

if (![outputPath, label, nodeBin, appRoot, configPath, runtimeHome, envPath].every(Boolean)) {
  console.error(
    'Usage: node render-plist.mjs <output> <label> <node-bin> <app-root> <config-path> <runtime-home> <env-path>',
  );
  process.exit(2);
}

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

const templatePath = new URL('./launch-agent.plist.in', import.meta.url);
const template = await readFile(templatePath, 'utf8');
const replacements = {
  __LABEL__: label,
  __NODE_BIN__: nodeBin,
  __APP_ROOT__: appRoot,
  __CONFIG_PATH__: configPath,
  __RUNTIME_HOME__: runtimeHome,
  __ENV_PATH__: envPath,
};

let rendered = template;
for (const [placeholder, value] of Object.entries(replacements)) {
  rendered = rendered.replaceAll(placeholder, escapeXml(value));
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, rendered, 'utf8');
