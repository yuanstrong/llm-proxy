# macOS Upgrade and Rollback Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the macOS installer perform confirmed, versioned upgrades with a maximum of five retained releases, automatic service restart and health verification, safe rollback, and explicit uninstall choices.

**Architecture:** Treat `package.json.version` as the release identity. Store each release under the persistent `releases/<version>` directory and keep the active release in the `current` symlink. Stage and install dependencies before stopping the active service; after confirmation, stop the LaunchAgent, switch the symlink, start the new release, verify the management endpoint, and restore the previous symlink automatically if startup fails.

**Tech Stack:** zsh installer scripts, Node.js package metadata, npm `package-lock.json`/`npm ci`, macOS `launchctl`, local HTTP health check, Node test runner.

---

### Task 1: Add release inventory and upgrade confirmation contracts

**Files:**
- Modify: `test/macos-installer.test.ts`
- Modify: `installer/macos/common.sh`
- Modify: `installer/macos/install.sh`

- [x] **Step 1: Write failing tests for version detection and confirmation**

Add tests using temporary release roots and fake npm/launchctl commands. Verify that an existing `current` release makes a non-`--yes` install fail in non-interactive mode with the current and target versions in the error, while `--yes` proceeds.

- [x] **Step 2: Run the focused tests and verify they fail**

Run: `node --import tsx --test test/macos-installer.test.ts`

Expected: FAIL because the installer currently replaces an active release without checking or confirming it.

- [x] **Step 3: Implement release helpers**

Add helpers for reading the active version from `current`, listing release directories ordered by modification time, and confirming upgrades. Add `--yes` for scripted upgrades. The installer must derive the target version from `package.json.version` and reject invalid release path values.

- [x] **Step 4: Implement the confirmed install path**

Stage files and run `npm ci --omit=dev` before stopping the active service. If an active or historical release exists, require confirmation unless `--yes` is supplied. A same-version install must also require explicit confirmation.

- [x] **Step 5: Run the focused tests**

Run: `node --import tsx --test test/macos-installer.test.ts`

Expected: PASS.

### Task 2: Add service cutover, health verification, and five-release retention

**Files:**
- Modify: `installer/macos/common.sh`
- Modify: `installer/macos/install.sh`
- Modify: `test/macos-installer.test.ts`

- [x] **Step 1: Write failing tests for cutover and retention**

Add tests that use a fake `launchctl`, fake npm, and fake curl to verify the installer stops before switching `current`, starts after switching, checks the management endpoint, and removes releases beyond the newest five while preserving the active release.

- [x] **Step 2: Run the focused tests and verify they fail**

Run: `node --import tsx --test test/macos-installer.test.ts`

Expected: FAIL because the current installer has no health check or release pruning.

- [x] **Step 3: Implement cutover and rollback-on-failure**

Record the previous `current` target, stop the loaded LaunchAgent, switch the symlink, render the plist, bootstrap the service, and wait for `http://127.0.0.1:3000/` to return success. If the health check fails, stop the new service, restore the old symlink, bootstrap the old release, and report the upgrade failure.

- [x] **Step 4: Implement retention**

After a successful health check, retain the active release plus the four newest other releases. Never delete the active release, configuration, runtime data, or a staging directory until the cutover succeeds.

- [x] **Step 5: Run the focused tests and shell syntax checks**

Run:

```bash
zsh -n installer/macos/*.sh
node --import tsx --test test/macos-installer.test.ts
```

Expected: PASS.

### Task 3: Add explicit rollback command

**Files:**
- Create: `installer/macos/rollback.sh`
- Modify: `installer/macos/README.md`
- Modify: `README.md`
- Modify: `test/macos-installer.test.ts`

- [x] **Step 1: Write a failing rollback test**

Create three temporary releases, set `current` to the newest, run `rollback.sh` with fake service and health commands, and assert that `current` points to the previous version and the service is started again.

- [x] **Step 2: Run the focused test and verify it fails**

Run: `node --import tsx --test test/macos-installer.test.ts`

Expected: FAIL because `rollback.sh` does not exist.

- [x] **Step 3: Implement rollback**

Support `rollback.sh [version]` and default to the newest release other than `current`. Stop the service, switch `current`, start the service, verify health, and restore the original target if health verification fails.

- [x] **Step 4: Document rollback**

Document automatic rollback after failed upgrade and manual rollback with `rollback.sh`.

- [x] **Step 5: Run focused tests**

Run: `node --import tsx --test test/macos-installer.test.ts`

Expected: PASS.

### Task 4: Add uninstall choice handling

**Files:**
- Modify: `installer/macos/uninstall.sh`
- Modify: `installer/macos/README.md`
- Modify: `README.md`
- Modify: `test/macos-installer.test.ts`

- [x] **Step 1: Write failing uninstall choice tests**

Add tests for non-interactive refusal without `--yes`, confirmed full removal, and rollback choice while preserving configuration/runtime data.

- [x] **Step 2: Run the focused tests and verify they fail**

Run: `node --import tsx --test test/macos-installer.test.ts`

Expected: FAIL because uninstall currently removes all versions without confirmation.

- [x] **Step 3: Implement uninstall choices**

When multiple releases exist, display the active and historical versions and prompt for: remove all releases, remove the active release and roll back to the previous release, or cancel. Non-interactive uninstall must require `--yes` for full removal. Preserve `config/` and `runtime/` unless `--purge-data` is supplied.

- [x] **Step 4: Document uninstall behavior**

Document that full removal is the default confirmed action, rollback is available as a separate choice/command, and persistent configuration is preserved by default.

- [x] **Step 5: Run focused tests**

Run: `node --import tsx --test test/macos-installer.test.ts`

Expected: PASS.

### Task 5: Run complete verification

**Files:**
- Modify: `docs/superpowers/plans/2026-10-03-macos-upgrade-lifecycle.md`

- [x] **Step 1: Run all verification commands**

Run:

```bash
zsh -n installer/macos/*.sh
node --import tsx --test test/**/*.test.ts
pnpm lint
pnpm run build
git diff --check
```

Expected: all tests, lint, build, shell syntax, and whitespace checks pass.

- [x] **Step 2: Mark the plan complete and report the release behavior**

Summarize the confirmation, retention, cutover, health check, rollback, and uninstall behavior, and report that no real LaunchAgent was modified during automated tests.
