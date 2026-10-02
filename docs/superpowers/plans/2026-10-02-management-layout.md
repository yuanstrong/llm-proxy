# Management Layout Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tab-based management console with a four-page SideNav + Main layout containing overview, configuration, logs, and prompts.

**Architecture:** Keep the existing single-page React application and API layer. App owns page selection, status loading, provider actions, and global errors; each page owns only its page-specific data. Reuse the existing provider card for the running-provider summary and add a dedicated configuration list for the complete configuration view.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, lucide-react, existing UI primitives, Node test runner, Vite.

---

### Task 1: Define navigation model and regression test

**Files:**
- Create: `src/ui/lib/navigation.ts`
- Create: `test/ui-navigation.test.ts`

- [x] **Step 1: Write the failing test**

  Test that the navigation model contains exactly `overview`, `configuration`, `logs`, and `prompts`, in that order, with stable labels.

- [x] **Step 2: Run the focused test and confirm it fails**

  Run `node --import tsx --test test/ui-navigation.test.ts`.

- [x] **Step 3: Implement the navigation model**

  Export the `View` union and an ordered `navigationItems` array containing the four views and their labels/icons.

- [x] **Step 4: Run the focused test and confirm it passes**

  Run `node --import tsx --test test/ui-navigation.test.ts`.

### Task 2: Add the SideNav + Main shell

**Files:**
- Create: `src/ui/components/SideNav.tsx`
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/styles.css`

- [x] **Step 1: Add the shell behavior test coverage through the navigation model**

  Use the navigation model from Task 1 in the shell so all four destinations are reachable and the active item is represented by the selected view.

- [x] **Step 2: Implement the shell**

  Replace `Tabs` with a responsive layout: fixed-width desktop sidebar, stacked/mobile top navigation, and a scrollable main content region. Keep connection status, refresh action, and error banner visible in the main shell.

- [x] **Step 3: Build the UI**

  Run `pnpm run build:ui` and fix any TypeScript or Vite errors.

### Task 3: Split Overview and Configuration responsibilities

**Files:**
- Create: `src/ui/components/Configuration.tsx`
- Modify: `src/ui/components/Overview.tsx`
- Modify: `src/ui/App.tsx`

- [x] **Step 1: Implement Overview as KPI plus running configuration only**

  Keep configured count, running count, and captured exchanges as KPIs. Below them show only providers whose `running` value is true, with an empty state when none are running. Preserve provider start/stop controls for running cards and link users to Configuration for the full list.

- [x] **Step 2: Implement Configuration**

  Render every provider returned from `/admin/api/status`, including stopped providers, listen address, PID when available, log level, client base URLs, upstream endpoints, and start/stop controls using the existing `ProviderCard`.

- [x] **Step 3: Build the UI**

  Run `pnpm run build:ui`.

### Task 4: Move filters into the Logs table header

**Files:**
- Modify: `src/ui/components/LogsView.tsx`

- [x] **Step 1: Keep the existing provider and level query behavior**

  Preserve the current API calls and reload behavior when either filter changes.

- [x] **Step 2: Render filters inside header cells**

  Put the provider select under the Provider column label and the level select under the Level column label. Remove the separate filter panel while keeping refresh, loading, empty, and error states.

- [x] **Step 3: Build the UI**

  Run `pnpm run build:ui`.

### Task 5: Rename Prompt History to Prompts and verify the full application

**Files:**
- Modify: `src/ui/components/PromptHistoryView.tsx`
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/index.html` if the page title or description needs to match the new navigation wording.

- [x] **Step 1: Present the existing prompt history under the Prompts page**

  Keep provider filtering and prompt/response detail, but use page copy and navigation labels that match `Prompts`.

- [x] **Step 2: Run all verification commands**

  Run `pnpm test`, `pnpm run lint`, `pnpm run build:backend`, and `pnpm run build:ui`.

- [x] **Step 3: Review the final diff**

  Confirm the change is limited to the management UI, navigation model, tests, and this plan.
