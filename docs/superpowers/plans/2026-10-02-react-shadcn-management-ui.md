# React shadcn Management UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the existing management console to React with Tailwind CSS, lucide-react icons, and reusable shadcn/ui-style components while preserving the overview, logs, and prompt history behavior.

**Architecture:** Keep the current management API and shared server types unchanged. Replace the DOM-manipulation entrypoint with a React root, move API state/rendering into focused React components and hooks, and add local shadcn/ui primitives under `src/ui/components/ui`. Tailwind v4 will be wired through Vite so the generated UI remains served from the existing management server.

**Tech Stack:** React, React DOM, TypeScript/TSX, Tailwind CSS v4, `@tailwindcss/vite`, `lucide-react`, `clsx`, `tailwind-merge`, `class-variance-authority`, Vite.

---

### Task 1: Add React/Tailwind dependencies and build configuration

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `vite.config.ts`
- Modify: `tsconfig.ui.json`
- Create: `src/ui/lib/utils.ts`
- Create: `components.json`

- [x] Add runtime dependencies `react`, `react-dom`, `lucide-react`, `clsx`, `tailwind-merge`, and `class-variance-authority`; add `@types/react` and `@types/react-dom` plus `tailwindcss` and `@tailwindcss/vite` as dev dependencies.
- [x] Add the Tailwind Vite plugin and configure its source scan for `src/ui/**/*.{ts,tsx}`.
- [x] Include TSX files and React DOM types in the UI TypeScript project.
- [x] Add the standard shadcn `cn()` utility and a `components.json` alias configuration rooted at `src/ui`.
- [x] Run `pnpm run build:ui` before migrating the entrypoint and confirm the dependency/build setup is valid.

### Task 2: Add local shadcn/ui primitives and React application shell

**Files:**
- Create: `src/ui/components/ui/button.tsx`
- Create: `src/ui/components/ui/badge.tsx`
- Create: `src/ui/components/ui/card.tsx`
- Create: `src/ui/components/ui/input.tsx`
- Create: `src/ui/components/ui/select.tsx`
- Create: `src/ui/components/ui/table.tsx`
- Create: `src/ui/components/ui/tabs.tsx`
- Create: `src/ui/components/ui/textarea.tsx`
- Create: `src/ui/App.tsx`
- Modify: `src/ui/index.html`
- Create: `src/ui/main.tsx`

- [x] Implement typed, dependency-light shadcn/ui primitives using `React.forwardRef`, `cva`, and Tailwind classes; keep browser behavior native for select/details-like interactions.
- [x] Mount `<App />` with `createRoot` from `main.tsx`, import the Tailwind stylesheet, and set the page language/title metadata.
- [x] Add the responsive application shell with sidebar/header navigation and Overview, Logs, and Prompt History tabs.
- [x] Use lucide-react icons for navigation, provider state, refresh, copy, play/stop, and empty/loading states.
- [x] Run the UI type check to catch JSX/component contract errors before wiring API state.

### Task 3: Port overview, logs, and prompt history behavior to React

**Files:**
- Create: `src/ui/components/Overview.tsx`
- Create: `src/ui/components/LogsView.tsx`
- Create: `src/ui/components/PromptHistoryView.tsx`
- Create: `src/ui/components/ProviderCard.tsx`
- Create: `src/ui/lib/api.ts`
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/styles.css`

- [x] Move status/log/history fetches into typed API helpers with loading and error states, preserving the current endpoint paths and query filters.
- [x] Render expandable provider cards with listener/status, configured upstream endpoints, copyable OpenAI and Anthropic base URLs, log level, and start/stop controls.
- [x] Render log filters and table rows with provider, exact level, timestamp, and message columns.
- [x] Render newest-first history cards with prompt/response blocks, provider/model/format, status, duration, and provider filtering.
- [x] Keep API-key-safe display behavior and use `textContent`-equivalent React text rendering for server-provided strings.
- [x] Run the UI build and verify the generated assets are emitted under `dist/ui`.

### Task 4: Verify integration and document the frontend stack

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-10-02-react-shadcn-management-ui.md`

- [x] Document that the management console is React-based, styled with Tailwind CSS, and uses local shadcn/ui primitives plus lucide-react icons.
- [x] Run `pnpm test`, `pnpm run build`, and `git diff --check`.
- [x] Confirm the backend still serves `/`, `/admin/api/status`, `/admin/api/logs`, and `/admin/api/prompt-history` after the frontend migration.
- [x] Inspect the final diff for accidental changes to API behavior and mark completed plan steps only after verification passes.
