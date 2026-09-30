# LLM Proxy Admin UI and Build Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move backend server code and shared types into dedicated directories, add a small browser-based management interface, and provide Vite-backed scripts that emit backend and frontend artifacts below `dist`.

**Architecture:** `src/server/` owns the HTTP listener, routing, configuration, and upstream proxy implementation. `src/types/index.ts` is the shared type entry point. `src/ui/` contains a dependency-light Vite frontend that reads a safe, read-only status endpoint from the backend. The backend is compiled with a server-specific TypeScript project into `dist/server`, while Vite emits the UI into `dist/ui`; the server serves the built UI from that sibling directory.

**Tech Stack:** TypeScript, Node.js built-in `node:test`, `tsx`, Vite, vanilla TypeScript/CSS/HTML, native `http`/`https`, `smol-toml`.

---

### Task 1: Add a failing integration test for the new server layout and admin status endpoint

**Files:**
- Create: `test/server-ui.test.ts`
- Modify: `package.json`

- [x] **Step 1: Add a test script using Node's built-in test runner and tsx**

Add this script to `package.json`:

```json
"test": "node --import tsx --test test/**/*.test.ts"
```

- [x] **Step 2: Write the failing test**

Create `test/server-ui.test.ts`:

```typescript
import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import { createServer } from '../src/server/server';
import type { AppConfig } from '../src/types';

const config: AppConfig = {
  listen: { host: '127.0.0.1', port: 0 },
  provider: {
    name: 'test-provider',
    endpoints: { 'openai-completions': 'http://127.0.0.1:9/v1/chat/completions' },
    models: { 'claude-sonnet-4-6': 'test-model' },
  },
};

test('admin status returns safe provider information', async () => {
  const server = createServer(config);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${address.port}/admin/api/status`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    provider: 'test-provider',
    formats: ['openai-completions'],
    models: { 'claude-sonnet-4-6': 'test-model' },
  });

  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});
```

- [x] **Step 3: Run the focused test and verify the expected failure**

Run:

```bash
pnpm test -- test/server-ui.test.ts
```

Expected: FAIL because `src/server/server` and the admin status route do not exist yet.

### Task 2: Move backend implementation and shared types

**Files:**
- Create: `src/server/config.ts`
- Create: `src/server/proxy.ts`
- Create: `src/server/server.ts`
- Create: `src/server/index.ts`
- Create: `src/types/index.ts`
- Delete: `src/config.ts`
- Delete: `src/proxy.ts`
- Delete: `src/server.ts`
- Delete: `src/index.ts`
- Delete: `src/types.ts`

- [x] **Step 1: Move existing backend modules into `src/server/`**

Preserve the existing implementations and update imports so each server module imports shared types from `../types` and the entry point imports local modules from `./config` and `./server`.

- [x] **Step 2: Move shared declarations to `src/types/index.ts`**

Preserve `ApiFormat`, `ProviderConfig`, and `AppConfig` in the new index file and export them from that file.

- [x] **Step 3: Run the type check**

Run:

```bash
pnpm exec tsc --noEmit -p tsconfig.server.json
```

Expected: the backend compiles with no errors after the move.

### Task 3: Implement the admin status route and static UI serving

**Files:**
- Modify: `src/server/server.ts`
- Create: `src/server/ui.ts`
- Modify: `test/server-ui.test.ts`

- [x] **Step 1: Extend the test with UI serving behavior**

Add a second test that requests `/` with a temporary built UI directory configured through `createServer`, and asserts a `200` HTML response containing `LLM Proxy`. The server factory must accept an optional `uiRoot` parameter so tests do not depend on a generated build artifact.

- [x] **Step 2: Add a safe status payload**

Return only the selected provider name, supported formats, and model mappings from `GET /admin/api/status`. Never include `api_key` in the response.

- [x] **Step 3: Add static file serving**

Serve `index.html` for `/` and safe asset paths below the configured UI root. Keep API routing ahead of static serving, reject path traversal, and return `404` for missing assets. Default the UI root to `dist/ui` relative to the compiled server directory.

- [x] **Step 4: Run the focused tests and verify they pass**

Run:

```bash
pnpm test -- test/server-ui.test.ts
```

Expected: PASS for the status endpoint and static UI response.

### Task 4: Add the Vite frontend management interface

**Files:**
- Create: `src/ui/index.html`
- Create: `src/ui/main.ts`
- Create: `src/ui/styles.css`
- Modify: `src/types/index.ts`

- [x] **Step 1: Add shared UI status types**

Export a `ProxyStatus` interface containing `provider`, `formats`, and `models` so the backend payload and frontend response use the same declaration.

- [x] **Step 2: Create the management page**

Build a vanilla TypeScript page that fetches `/admin/api/status`, displays the active provider, supported API formats, model mappings, and a note that provider selection currently comes from `LLM_PROXY_PROVIDER` at process startup.

- [x] **Step 3: Add responsive styling**

Use a small dashboard layout with cards, readable typography, accessible table markup, loading state, and an error state when the status endpoint cannot be reached.

### Task 5: Add separate backend and frontend Vite build scripts

**Files:**
- Create: `vite.config.ts`
- Create: `tsconfig.server.json`
- Modify: `tsconfig.json`
- Modify: `package.json`
- Modify: `.gitignore`

- [x] **Step 1: Configure the server TypeScript project**

Set `tsconfig.server.json` to compile `src/server/**/*.ts` and `src/types/**/*.ts` to `dist/server`, emit CommonJS JavaScript, declarations, and source maps. Exclude `src/ui`.

- [x] **Step 2: Configure Vite for `dist/ui`**

Set Vite's root to `src/ui`, output directory to `dist/ui`, and clear the output directory on build. Keep asset paths relative so the generated page works when served by the backend.

- [x] **Step 3: Add package scripts and dependencies**

Add `vite` as a development dependency and add:

```json
"build:backend": "tsc -p tsconfig.server.json",
"build:ui": "vite build",
"build": "pnpm run build:backend && pnpm run build:ui",
"start:built": "node dist/server/index.js"
```

Keep `start` and `dev` pointing at the TypeScript backend source for local development.

- [x] **Step 4: Update ignore rules**

Keep generated `dist/` ignored and add Vite's cache directory if it is not already ignored.

### Task 6: Verify both artifacts and runtime behavior

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-09-30-admin-ui-build.md`

- [x] **Step 1: Run the full test suite**

Run:

```bash
pnpm test
```

Expected: all tests pass.

- [x] **Step 2: Build backend and UI separately**

Run:

```bash
pnpm run build:backend
pnpm run build:ui
```

Expected: backend files exist under `dist/server` and Vite files exist under `dist/ui`.

- [x] **Step 3: Run the combined build**

Run:

```bash
pnpm run build
```

Expected: exit code 0 and both output trees remain present below `dist`.

- [x] **Step 4: Verify the compiled server can serve the built UI**

Start the compiled server with the existing `ollama-local` provider and request `/` and `/admin/api/status`. Verify that `/` returns the dashboard HTML and the status response does not expose an API key.

- [x] **Step 5: Update documentation**

Document the new source layout, `pnpm run build`, separate output directories, and the admin URL.

- [x] **Step 6: Mark completed plan steps**

Update the checkboxes in this plan only after the corresponding commands have produced the expected results.
