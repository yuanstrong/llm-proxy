# Management Observability UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the management console with provider overview/base URLs, filtered provider logs, and chronologically sorted prompt/response history.

**Architecture:** Keep provider lifecycle state in `ProviderManager`, expose a safe overview payload from the management server, and read provider log/history files from the existing runtime home. Provider children append structured prompt-history records after a proxied response completes; the management server aggregates and sorts those records without exposing API keys.

**Tech Stack:** TypeScript, Node.js built-in `http`/`fs`, native `node:test`, Vite, vanilla TypeScript/CSS/HTML.

---

### Task 1: Define management payloads and add failing API tests

**Files:**
- Modify: `src/types/index.ts`
- Modify: `test/server-ui.test.ts`

- [x] Add `ProviderOverview`, `LogEntry`, and `PromptHistoryEntry` types, including provider name, configured endpoint map, log level, listen address, running state, PID, and computed OpenAI/Anthropic base URLs.
- [x] Extend the fixture config with both protocol endpoint types and a configured log level.
- [x] Add a failing status assertion for endpoint metadata, log level, base URLs, and API-key omission.
- [x] Add failing integration tests for `GET /admin/api/logs?provider=...&level=...` and `GET /admin/api/prompt-history`, using a temporary runtime home containing representative log/history files.
- [x] Run `pnpm test -- test/server-ui.test.ts` and confirm the new expectations fail because the routes/types are not implemented.

### Task 2: Implement runtime log and prompt-history readers

**Files:**
- Create: `src/server/observability.ts`
- Modify: `src/server/runtime.ts`

- [x] Add `getHistoryDirectory` and `ensureRuntimeDirectories` support for `var/history`.
- [x] Implement log parsing for manager-captured lines in the form `[provider] [level] message`, accepting optional ISO timestamps and ignoring malformed lines instead of failing the API.
- [x] Implement provider/level filtering and a bounded newest-first result list.
- [x] Implement JSONL history reading, validation of required fields, provider filtering, and newest-first timestamp sorting.
- [x] Run the focused API tests; keep them failing only at the not-yet-wired management routes.

### Task 3: Capture prompt and provider response in the child proxy

**Files:**
- Create: `src/server/history.ts`
- Modify: `src/server/proxy.ts`
- Modify: `src/server/provider.ts`
- Modify: `src/server/provider-manager.ts`

- [x] Add JSONL append support with a size-safe record containing timestamp, provider, format, model, prompt, response, status, and duration.
- [x] Extract the latest user prompt from Anthropic/OpenAI message-style request bodies, with readable JSON fallback for unknown bodies.
- [x] Collect response bytes while preserving streaming passthrough, then extract normal JSON and SSE text for OpenAI and Anthropic responses.
- [x] Append a history record when the response finishes, and keep proxying successful/streaming/error responses unchanged.
- [x] Pass the manager's `LLM_PROXY_HOME` into child processes so tests and deployments use the same history directory.
- [x] Add proxy tests proving a request creates a history record without changing the upstream request or client response.
- [x] Run proxy and provider tests and confirm they pass.

### Task 4: Wire management API routes and safe overview data

**Files:**
- Modify: `src/server/management-server.ts`
- Modify: `src/server/index.ts`
- Modify: `src/server/provider-manager.ts`

- [x] Extend the management server factory with an optional runtime environment/directory dependency while preserving existing callers.
- [x] Return a safe overview with all configured providers, current running state, listen address, configured endpoint map, configured log level, and protocol base URLs derived from the provider listener.
- [x] Add filtered logs and prompt-history routes with query validation, newest-first ordering, and bounded limits.
- [x] Ensure status/log/history responses never serialize provider API keys.
- [x] Run `pnpm test -- test/server-ui.test.ts` and the full backend tests.

### Task 5: Replace the single-page UI with overview, logs, and prompt history views

**Files:**
- Modify: `src/ui/index.html`
- Modify: `src/ui/main.ts`
- Modify: `src/ui/styles.css`

- [x] Add accessible navigation for Overview, Logs, and Prompt History without introducing a frontend dependency.
- [x] Render overview summary cards and expandable provider panels showing running/stopped state, listener, supported endpoints, and copyable OpenAI/Anthropic base URL controls.
- [x] Render log filters for provider and level, fetch filtered data, and show timestamp/level/provider/message columns with empty/loading/error states.
- [x] Render prompt history sorted newest-first with time, provider, model/format, prompt, response, status, and duration.
- [x] Keep control buttons for starting/stopping providers and refresh overview after actions.
- [x] Run `pnpm run build:ui` to catch DOM/type/style integration issues.

### Task 6: Verify, document, and review the complete change

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-10-02-management-observability.md`

- [x] Document the new management views, API routes, runtime history location, and the fact that prompt history contains request/response content.
- [x] Run `pnpm test`, `pnpm run build`, and `git diff --check`.
- [x] Inspect the final diff for API-key leakage, unbounded response/history reads, and accidental protocol behavior changes.
- [x] Mark completed plan steps only after the verification commands pass.
