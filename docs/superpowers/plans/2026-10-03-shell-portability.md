# Installer Shell Portability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the installer and test suite's dependency on zsh while preserving macOS-only production safeguards.

**Architecture:** Convert installer scripts to Bash syntax and use `/bin/bash` in every test subprocess and fixture. Keep the macOS platform check in production, but add an explicit `LLM_PROXY_ALLOW_NON_MACOS_TEST=1` test override so the installer logic can run on Ubuntu CI without pretending that Linux is a supported deployment target. Run `/usr/bin/plutil -lint` when the test is running on macOS and the binary exists, while retaining generated XML assertions as the portable fallback.

**Tech Stack:** Bash 3.2-compatible shell scripts, Node.js test runner, GitHub Actions Ubuntu runner, macOS LaunchAgent tooling.

---

### Task 1: Make tests independent of zsh and hard macOS-only tool dependencies

**Files:**
- Modify: `test/macos-installer.test.ts`

- [x] **Step 1: Change test subprocesses and fixtures to Bash**

Replace every installer subprocess invocation of `/bin/zsh` with `/bin/bash`, rename fake shell fixture paths from `.zsh` to `.bash`, and change fixture shebangs to `#!/bin/bash`.

- [x] **Step 2: Use optional `/usr/bin/plutil` validation with a portable fallback**

On macOS, invoke `/usr/bin/plutil -lint` when the binary exists. Always keep the generated plist content and XML-escaping assertions so the test falls back cleanly on non-macOS hosts or macOS environments without `plutil`.

- [x] **Step 3: Run the focused installer tests and verify they fail for the intended reason**

Run `node --import tsx --test test/macos-installer.test.ts`. Expected: failure because the production scripts still contain zsh syntax and zsh shebang assumptions.

### Task 2: Port installer scripts to Bash

**Files:**
- Modify: `installer/macos/common.sh`
- Modify: `installer/macos/install.sh`
- Modify: `installer/macos/prepare-release.sh`
- Modify: `installer/macos/rollback.sh`
- Modify: `installer/macos/service.sh`
- Modify: `installer/macos/uninstall.sh`
- Modify: `installer/macos/update.sh`

- [x] **Step 1: Replace zsh-only output and array constructs**

Use `printf` instead of `print`, Bash arrays and `nullglob` for release directory discovery, and `while IFS= read -r` loops instead of zsh `${(f)}` splitting. Preserve ordering by modification time and the existing five-release retention policy.

- [x] **Step 2: Preserve platform validation with an explicit test override**

Keep production rejection on non-macOS hosts, but accept `LLM_PROXY_ALLOW_NON_MACOS_TEST=1` for test execution. Do not set this variable in release or normal installation workflows.

- [x] **Step 3: Run Bash syntax checks and focused installer tests**

Run `bash -n installer/macos/*.sh` and the installer test file. Expected: all installer tests pass without spawning zsh or using plutil.

### Task 3: Verify CI compatibility and update documentation

**Files:**
- Modify: `README.md`
- Modify: `installer/macos/README.md`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/superpowers/plans/2026-10-03-shell-portability.md`

- [x] **Step 1: Set the test-only platform override in installer tests**

Pass `LLM_PROXY_ALLOW_NON_MACOS_TEST=1` only to test subprocesses. The normal `install.sh`, `prepare-release.sh`, and release job remain macOS-only.

- [x] **Step 2: Document the shell contract**

State that installer scripts use the system `/bin/bash` and do not require zsh. Document the non-macOS override as test-only and not for deployment.

- [x] **Step 3: Verify the complete project**

Run:

```bash
bash -n installer/macos/*.sh
ruby -e "require 'yaml'; YAML.load_file('.github/workflows/ci.yml')"
pnpm lint
pnpm test
pnpm run build
git diff --check
```

Expected: all tests and checks pass on Ubuntu without zsh or plutil.

- [x] **Step 4: Mark this plan complete**

Mark every checkbox complete and report the portability change and verification results.
