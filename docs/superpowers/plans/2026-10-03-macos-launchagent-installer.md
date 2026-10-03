# macOS LaunchAgent Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-phase macOS installer that installs production dependencies on the target machine, registers the current Node server as a per-user LaunchAgent, and supports service control and safe removal.

**Architecture:** Keep versioned application files under `~/Library/Application Support/llm-proxy/releases`, expose the selected version through a `current` symlink, and keep configuration/runtime data outside release directories. Generate a concrete plist from a checked-in template using the target machine's absolute Node path, then use `launchctl bootstrap`/`bootout` in user GUI domain `gui/<uid>`.

**Tech Stack:** POSIX/zsh shell scripts, Node.js ESM helper for XML-safe plist rendering, macOS `launchctl`, Node test runner, npm-generated lockfile and `npm ci --omit=dev` on the target machine.

---

### Task 1: Define the plist renderer contract with a failing test

**Files:**
- Create: `test/macos-installer.test.ts`
- Create: `installer/macos/render-plist.mjs`
- Create: `installer/macos/launch-agent.plist.in`

- [ ] **Step 1: Write the failing test**

Add a test that invokes the renderer with paths containing spaces and XML-sensitive characters, then asserts that the output is valid XML and contains escaped values for the label, Node executable, application root, config path, and runtime path.

```ts
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';

const execFileAsync = promisify(execFile);

test('renders a LaunchAgent plist with absolute paths and XML escaping', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-plist-'));
  const output = path.join(tempDir, 'com.example.llm-proxy.plist');
  const renderer = path.resolve('installer/macos/render-plist.mjs');

  try {
    await execFileAsync(process.execPath, [
      renderer,
      output,
      'com.example.llm-proxy',
      '/opt/homebrew/bin/node',
      '/Users/tester/Library/Application Support/LLM & Proxy/current',
      '/Users/tester/Library/Application Support/LLM & Proxy/config/config.toml',
      '/Users/tester/Library/Application Support/LLM & Proxy/runtime',
    ]);

    const plist = await readFile(output, 'utf8');
    assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
    assert.match(plist, /LLM &amp; Proxy/);
    assert.match(plist, /<string>\/opt\/homebrew\/bin\/node<\/string>/);
    assert.match(plist, /<key>LLM_PROXY_CONFIG<\/key>/);
    assert.match(plist, /<key>LLM_PROXY_HOME<\/key>/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test test/macos-installer.test.ts`

Expected: FAIL because `installer/macos/render-plist.mjs` does not exist yet.

- [ ] **Step 3: Add the minimal template and renderer**

The template must include `Label`, `ProgramArguments`, `WorkingDirectory`, `EnvironmentVariables`, `RunAtLoad`, `KeepAlive`, `ThrottleInterval`, `StandardOutPath`, and `StandardErrorPath`. The renderer must XML-escape substituted values and write the output file.

- [ ] **Step 4: Run the focused test**

Run: `node --import tsx --test test/macos-installer.test.ts`

Expected: PASS.

### Task 2: Generate the release lockfile during packaging

**Files:**
- Create: `installer/macos/prepare-release.sh`
- Modify: `test/macos-installer.test.ts`
- Modify: `installer/macos/README.md`
- Modify: `README.md`

- [ ] **Step 1: Write the failing packaging test**

Add a test that supplies a temporary release fixture and a fake npm executable, then expects `prepare-release.sh` to invoke `npm install --package-lock-only` and leave `package-lock.json` in the output directory.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test test/macos-installer.test.ts`

Expected: FAIL because `installer/macos/prepare-release.sh` does not exist.

- [ ] **Step 3: Implement the release preparer**

Copy `dist`, `package.json`, and `installer` into a new output directory, then run `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` inside that directory. Refuse to overwrite an existing output directory.

- [ ] **Step 4: Run the focused test**

Run: `node --import tsx --test test/macos-installer.test.ts`

Expected: PASS.

### Task 3: Add shared installer paths and npm production dependency installation

**Files:**
- Create: `installer/macos/common.sh`
- Create: `installer/macos/install.sh`
- Modify: `package.json` only if an installer test script is needed

- [ ] **Step 1: Write a failing shell contract test**

Extend `test/macos-installer.test.ts` with a test that runs `installer/macos/install.sh --check` and expects a clear failure on non-macOS or a success response when the platform and required files are available. The check mode must not call `launchctl` or mutate the user home.

- [ ] **Step 2: Run the focused test and verify the expected failure**

Run: `node --import tsx --test test/macos-installer.test.ts`

Expected: FAIL because `install.sh` and its `--check` mode do not exist.

- [ ] **Step 3: Implement shared paths and check mode**

`common.sh` must define the label, application root, releases directory, current symlink, config directory, runtime directory, plist path, launchctl domain, source root, and helpers for finding absolute `node` and npm. `install.sh --check` must validate the platform, Node, compiled backend, compiled UI, and `package-lock.json` without changing files.

- [ ] **Step 4: Implement staged installation**

The normal install must copy `dist`, `package.json`, and `package-lock.json` into `releases/<version>`, install production dependencies only with `npm ci --omit=dev`, then atomically replace the `current` symlink. It must create persistent config/runtime directories and never overwrite an existing config file.

- [ ] **Step 5: Run shell syntax and focused tests**

Run:

```bash
bash -n installer/macos/common.sh installer/macos/install.sh
node --import tsx --test test/macos-installer.test.ts
```

Expected: PASS.

### Task 4: Register and control the LaunchAgent

**Files:**
- Create: `installer/macos/service.sh`
- Modify: `installer/macos/install.sh`

- [ ] **Step 1: Write failing service command tests**

Add tests that verify `service.sh` exposes `start`, `stop`, `restart`, and `status` commands and returns a clear error when the plist has not been installed. Tests must avoid changing the real user LaunchAgent directory by allowing `LLM_PROXY_PLIST` and `LLM_PROXY_DOMAIN` overrides.

- [ ] **Step 2: Run tests and verify the expected failure**

Run: `node --import tsx --test test/macos-installer.test.ts`

Expected: FAIL because `service.sh` does not exist.

- [ ] **Step 3: Implement service control**

Use `launchctl bootstrap` for start, `launchctl bootout` for stop, `launchctl kickstart -k` for restart, and `launchctl print` for status. `install.sh` must render the plist using the staged `current` path and bootstrap it only after the version switch succeeds.

- [ ] **Step 4: Run tests and shell checks**

Run:

```bash
bash -n installer/macos/*.sh
node --import tsx --test test/macos-installer.test.ts
```

Expected: PASS.

### Task 5: Add uninstall behavior and operator documentation

**Files:**
- Create: `installer/macos/uninstall.sh`
- Create: `installer/macos/README.md`
- Modify: `README.md`

- [ ] **Step 1: Write a failing uninstall contract test**

Add a test that runs uninstall in a temporary override root and verifies that it removes the service plist/current link while preserving config and runtime directories by default.

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --import tsx --test test/macos-installer.test.ts`

Expected: FAIL because `uninstall.sh` does not exist.

- [ ] **Step 3: Implement conservative uninstall**

Stop and remove the LaunchAgent, remove the `current` symlink and release directories, and preserve `config/` and `runtime/` unless an explicit `--purge-data` flag is supplied.

- [ ] **Step 4: Document installation and update commands**

Document the expected release layout, packaging-time lockfile generation, Node/npm requirements, `install.sh --check`, install/update/service commands, `launchctl` diagnostics, configuration persistence, and the fact that providers remain managed child processes rather than separate LaunchAgents.

- [ ] **Step 5: Run the full verification suite**

Run:

```bash
node --import tsx --test test/**/*.test.ts
pnpm lint
pnpm run build
bash -n installer/macos/*.sh
```

Expected: all tests, lint, build, and shell syntax checks pass.
