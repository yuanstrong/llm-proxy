# Provider Process Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current single-provider proxy into a resident management server on port 3000 that discovers all configured providers, starts and stops one proxy child process per provider, and persists child PIDs under `LLM_PROXY_HOME/var/pids`.

**Architecture:** The management process loads all providers and owns the browser UI, provider status API, and child-process lifecycle. Each provider config has its own `listen = "host:port"`; a child process receives only that provider name and runs the existing proxy handler. `LLM_PROXY_HOME` defaults to `~/.llm_proxy`, while `config.toml` remains the project configuration source. The UI calls management APIs to start/stop providers and never receives API keys.

**Tech Stack:** TypeScript, Node.js `child_process`, Node.js `node:test`, native `http`, Vite, vanilla TypeScript/CSS/HTML, `smol-toml`.

---

### Task 1: Define the new configuration and process-management contract with failing tests

**Files:**
- Modify: `src/types/index.ts`
- Modify: `test/server-ui.test.ts`
- Create: `test/provider-manager.test.ts`

- [x] **Step 1: Write tests for provider-scoped listen addresses and provider count**

Extend the test fixture so providers have `listen` addresses and assert that config loading returns all configured providers rather than a single selected provider.

- [x] **Step 2: Write failing tests for the runtime PID directory and lifecycle API**

Test that `ProviderManager` creates `$LLM_PROXY_HOME/var/pids`, writes `<provider>.pid` on start, reports `running: true`, removes the file on stop, and rejects unknown provider names.

- [x] **Step 3: Run the focused tests and verify they fail for missing manager/config behavior**

Run:

```bash
pnpm test -- test/server-ui.test.ts test/provider-manager.test.ts
```

Expected: FAIL because the current config model selects one provider and no `ProviderManager` exists.

### Task 2: Refactor configuration loading and runtime-home resolution

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/server/config.ts`
- Create: `src/server/runtime.ts`
- Modify: `config.toml`

- [x] **Step 1: Define the manager and provider types**

Use these public shapes:

```typescript
export interface ProviderConfig {
  name: string;
  listen: { host: string; port: number };
  api_key?: string;
  endpoints: Partial<Record<ApiFormat, string>>;
  models: Record<string, string>;
}

export interface AppConfig {
  management: { host: string; port: number };
  providers: Record<string, ProviderConfig>;
  configPath: string;
}
```

- [x] **Step 2: Parse every provider and require `providers.<name>.listen`**

Keep `listen` parsing strict, reject non-integer ports, validate HTTP(S) endpoint URLs, and return all provider definitions. Set management to `{ host: '127.0.0.1', port: 3000 }`.

- [x] **Step 3: Add runtime-home helpers**

Implement:

```typescript
export function getRuntimeHome(env = process.env): string;
export function getPidDirectory(env = process.env): string;
export function ensureRuntimeDirectories(env = process.env): string;
```

`getRuntimeHome` must use `LLM_PROXY_HOME` when non-empty, otherwise `path.join(os.homedir(), '.llm_proxy')`. `ensureRuntimeDirectories` must create `$HOME/var/pids` recursively and return that PID directory.

- [x] **Step 4: Update the sample TOML**

Remove the root proxy `listen` field and put a distinct `listen` in every provider, for example:

```toml
[providers.deepseek]
listen = "127.0.0.1:9876"

[providers.ollama-local]
listen = "127.0.0.1:11434"
```

### Task 3: Implement provider child-process lifecycle and PID files

**Files:**
- Create: `src/server/provider-manager.ts`
- Create: `src/server/provider.ts`
- Modify: `src/server/proxy.ts`
- Modify: `src/server/server.ts`
- Modify: `test/provider-manager.test.ts`

- [x] **Step 1: Add a provider-specific proxy server factory**

Refactor proxy routing to accept one `ProviderConfig`; preserve model remapping and upstream forwarding. `provider.ts` must load the config path from `LLM_PROXY_CONFIG` or the project default, select `process.argv[2]`, and listen on that provider's configured address.

- [x] **Step 2: Implement `ProviderManager.start(name)`**

Validate the name against loaded config, remove stale PID files, spawn the child with:

```typescript
spawn(process.execPath, providerEntryArgs, {
  env: { ...process.env, LLM_PROXY_PROVIDER: name, LLM_PROXY_CONFIG: config.configPath },
  stdio: 'ignore',
})
```

Write the child PID to `$LLM_PROXY_HOME/var/pids/<name>.pid` and remove it when that exact child exits.

- [x] **Step 3: Implement `stop`, `status`, and `shutdown`**

`stop(name)` sends `SIGTERM` to the PID from the file, removes stale files, and returns the resulting state. `status()` returns every configured provider with its listen address, PID when known, and `running` boolean. `shutdown()` stops all managed children for SIGINT/SIGTERM cleanup.

- [x] **Step 4: Run lifecycle tests and verify they pass**

Run:

```bash
pnpm test -- test/provider-manager.test.ts
```

Expected: PASS with PID files created and removed in a temporary `LLM_PROXY_HOME`.

### Task 4: Make port 3000 the resident management server

**Files:**
- Create or replace: `src/server/management-server.ts`
- Modify: `src/server/index.ts`
- Modify: `test/server-ui.test.ts`

- [x] **Step 1: Add management API tests**

Test `GET /admin/api/status` returns `providerCount` and all provider states without API keys. Test `POST /admin/api/providers/<name>/start` and `/stop` delegate to the manager and return JSON state. Test unknown providers return `404`.

- [x] **Step 2: Implement the management server on `127.0.0.1:3000`**

Serve the existing UI and these endpoints:

```text
GET  /admin/api/status
POST /admin/api/providers/:name/start
POST /admin/api/providers/:name/stop
```

Do not expose provider `api_key` values. Keep static asset traversal protection.

- [x] **Step 3: Update the resident entry point**

`src/server/index.ts` must load all config, ensure runtime directories, create a `ProviderManager`, listen only on management port 3000, and install SIGINT/SIGTERM handlers that call `shutdown()` before exiting.

### Task 5: Add provider count and start/stop controls to the UI

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/ui/index.html`
- Modify: `src/ui/main.ts`
- Modify: `src/ui/styles.css`

- [x] **Step 1: Define the shared provider-status response type**

Add `ProviderStatus` and `ManagementStatus` types with provider name, listen address, running state, optional PID, and total `providerCount`.

- [x] **Step 2: Render provider count and provider cards/table**

Display the number of configured providers, each provider's listen address and state, and Start/Stop buttons. Disable the button while its request is pending and refresh status after the action completes.

- [x] **Step 3: Add API error and loading states**

Use text-safe DOM updates, show management API failures in the existing alert area, and keep API keys out of all rendered data.

### Task 6: Update scripts, build paths, documentation, and verify the complete flow

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `tsconfig.server.json`
- Modify: `docs/superpowers/plans/2026-09-30-provider-process-manager.md`

- [x] **Step 1: Keep backend and UI builds producing `dist` artifacts**

Ensure `pnpm run build` emits the manager and provider child entrypoints under `dist/server` and the UI under `dist/ui`; keep `start:built` pointing to the resident manager entrypoint.

- [x] **Step 2: Document runtime-home and PID behavior**

Document:

```bash
LLM_PROXY_HOME=/tmp/my-llm-proxy pnpm run start:built
```

and explain that PID files are written to `$LLM_PROXY_HOME/var/pids/<provider>.pid`.

- [x] **Step 3: Run the full verification suite**

Run:

```bash
pnpm test
pnpm run build
```

Then run the compiled manager with a temporary `LLM_PROXY_HOME`, verify port 3000 serves the UI, start one provider through the API, verify its PID file and provider port, stop it, and verify the PID file is removed.

- [x] **Step 4: Mark the plan checkboxes only after fresh verification**

Update this plan after the full test, build, and compiled lifecycle smoke test complete successfully.
