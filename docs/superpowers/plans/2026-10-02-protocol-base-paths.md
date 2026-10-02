# Protocol Base Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Expose consistent protocol-specific local base paths for every provider: `/anthropic` for Claude Code and `/openai` for Codex, while preserving provider-specific upstream endpoints from configuration.

**Architecture:** The local ingress path identifies the client protocol and includes a protocol namespace. The selected provider's configured endpoint remains the egress target; the local namespace is never copied to the upstream URL. Anthropic keeps its existing `/anthropic` namespace, and OpenAI Chat Completions and Responses gain `/openai`.

**Tech Stack:** TypeScript, Node.js `http`, native `node:test`, Markdown documentation.

---

### Task 1: Add failing routing coverage for the OpenAI namespace

**Files:**
- Modify: `test/proxy-routing.test.ts`

- [x] **Step 1: Write the failing test**

Add a test with configured `openai-completions` and `openai-responses` endpoints. Send requests to `/openai/v1/chat/completions` and `/openai/v1/responses`, assert both are forwarded to their configured upstream paths, and assert the legacy unnamespaced `/v1/chat/completions` path returns `400`.

- [x] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm test -- test/proxy-routing.test.ts
```

Expected: the new `/openai/...` request test fails with HTTP `400`, because the current route map only recognizes `/v1/chat/completions` and `/v1/responses`.

### Task 2: Implement protocol-specific local paths

**Files:**
- Modify: `src/server/server.ts:6-10, 78`

- [x] **Step 1: Update the route map**

Change only the local OpenAI ingress paths:

```ts
const PATH_FORMAT_MAP: Array<{ prefix: string; format: ApiFormat }> = [
  { prefix: '/anthropic/v1/messages', format: 'anthropic' },
  { prefix: '/openai/v1/chat/completions', format: 'openai-completions' },
  { prefix: '/openai/v1/responses', format: 'openai-responses' },
];
```

Keep endpoint lookup unchanged so `provider.endpoints[match.format]` still selects the configured upstream target.

- [x] **Step 2: Update the unsupported-path error text**

Report the three namespaced local paths in the `400` response:

```text
Unsupported API format. Supported paths: /anthropic/v1/messages, /openai/v1/chat/completions, /openai/v1/responses
```

- [x] **Step 3: Run the focused routing tests**

Run:

```bash
pnpm test -- test/proxy-routing.test.ts
```

Expected: all routing tests pass, including the new OpenAI namespace test and the existing Anthropic tests.

### Task 3: Document the unified provider Base URL contract

**Files:**
- Modify: `README.md:120-155`

- [x] **Step 1: Document the local client paths**

Document that a provider listener exposes:

```text
http://127.0.0.1:<port>/anthropic  # Claude Code Base URL
http://127.0.0.1:<port>/openai     # Codex Base URL
```

and that the resulting request paths are `/anthropic/v1/messages`, `/openai/v1/chat/completions`, and `/openai/v1/responses`.

- [x] **Step 2: Clarify upstream endpoint separation**

State that `providers.<name>.endpoints` controls the upstream target independently of the local `/anthropic` and `/openai` prefixes, and that the proxy does not translate Anthropic and OpenAI request formats.

### Task 4: Verify the complete change

**Files:**
- Verify: `test/proxy-routing.test.ts`
- Verify: `src/server/server.ts`
- Verify: `README.md`

- [x] **Step 1: Run the complete test suite**

Run:

```bash
pnpm test
```

Expected: all tests pass with zero failures.

- [x] **Step 2: Build the project**

Run:

```bash
pnpm run build
```

Expected: backend and UI builds exit successfully.

- [x] **Step 3: Inspect the final diff**

Run:

```bash
git diff --check
git diff -- src/server/server.ts test/proxy-routing.test.ts README.md
```

Confirm that only the local OpenAI ingress paths, their tests, and documentation changed; provider endpoint forwarding remains configuration-driven.
