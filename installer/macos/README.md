# macOS LaunchAgent installer

This is the first-phase, terminal-driven installer for macOS. It installs the compiled application and production dependencies into the current user's application support directory, then registers the manager as a per-user `LaunchAgent`.

The installer scripts run with the system-provided `/bin/bash`; the target
machine does not need zsh.

## Build and install

Build the application before running the installer:

```bash
pnpm install
pnpm run build
./installer/macos/prepare-release.sh /tmp/llm-proxy-release
cd /tmp/llm-proxy-release
./installer/macos/install.sh --check
./installer/macos/install.sh
```

To install a newer release using the same persistent configuration:

```bash
./installer/macos/install.sh
```

The release version comes from `package.json.version`. The installer stages
the files and runs `npm ci` before it stops the active service. If an existing
release is present, an interactive terminal asks for confirmation. Use
`--yes` for a scripted upgrade:

```bash
./installer/macos/install.sh --yes
```

After confirmation, the installer stops the LaunchAgent, switches the
`current` symlink, starts the new release, and checks
`http://127.0.0.1:3000/`. If the new service fails the health check, the
installer restores the previous release and starts it again. The installer
keeps the active release plus the four newest historical releases.

`prepare-release.sh` runs at packaging time and generates a fresh `package-lock.json` with npm. The target machine only needs Node.js with npm; it never needs pnpm.

During installation, `${NAME}` references in `config.toml` are checked against the current environment and the persistent `.env` file. If a required value is missing and the installer has a terminal, it prompts for the value without echoing it and saves it to:

```text
~/Library/Application Support/llm-proxy/config/.env
```

For non-interactive installation, the installer fails with the missing variable name and the `.env` path. The LaunchAgent passes `LLM_PROXY_ENV` to both the manager and its provider children.

## Files and persistent data

The installer uses these paths by default:

```text
~/Library/Application Support/llm-proxy/releases/<version>/
~/Library/Application Support/llm-proxy/current
~/Library/Application Support/llm-proxy/config/config.toml
~/Library/Application Support/llm-proxy/runtime/
~/Library/LaunchAgents/com.example.llm-proxy.plist
```

`current` points to the active version. Configuration, secrets, and runtime
data live outside the versioned release, so upgrades do not overwrite them.

The release preparer includes `config.toml` when it exists. The installer copies it into persistent configuration only when that file does not already exist; subsequent installs do not overwrite it. Remove API keys or use a sanitized config before distributing a release archive outside a trusted environment.

## Service control

```bash
./installer/macos/service.sh status
./installer/macos/service.sh stop
./installer/macos/service.sh start
./installer/macos/service.sh restart
```

The management console is served at `http://127.0.0.1:3000/`. Provider processes remain child processes managed by the Node manager; they are not registered as separate LaunchAgents.

To switch to a retained historical release manually:

```bash
./installer/macos/rollback.sh
./installer/macos/rollback.sh 1.2.3 --yes
```

Without a version, `rollback.sh` selects the newest release other than
`current`. It stops and restarts the LaunchAgent and performs the same health
check. A failed check restores the original release.

## Verify the installation

Run the following checks as the same user who installed the service:

```bash
launchctl print "gui/$(id -u)/com.example.llm-proxy"
ls -l "$HOME/Library/LaunchAgents/com.example.llm-proxy.plist"
./installer/macos/service.sh status
curl --fail --silent --show-error http://127.0.0.1:3000/ >/dev/null
```

The installation is healthy when:

- `launchctl print` shows `type = LaunchAgent` and `state = running`;
- the plist exists under `~/Library/LaunchAgents`;
- `service.sh status` returns successfully;
- the management URL returns HTTP success.

If `launchctl print` shows `state = spawn scheduled` or a non-zero `last exit code`, the service is registered but the Node process is failing. Check the manager logs:

```bash
tail -n 80 "$HOME/Library/Application Support/llm-proxy/runtime/manager.stderr.log"
tail -n 80 "$HOME/Library/Application Support/llm-proxy/runtime/manager.stdout.log"
```

Verify the persistent configuration and secrets separately:

```bash
ls -l "$HOME/Library/Application Support/llm-proxy/config/config.toml"
ls -l "$HOME/Library/Application Support/llm-proxy/config/.env"
```

The `.env` file should be readable only by the current user.

## Uninstall

By default, uninstall removes the LaunchAgent, current version link, and installed releases while preserving configuration and runtime data:

```bash
./installer/macos/uninstall.sh
```

When multiple releases exist, the interactive uninstaller offers these
choices:

1. Remove all releases and stop the service.
2. Remove the active release and roll back one version.
3. Cancel.

For non-interactive use, pass `--yes` for full removal or `--rollback` to
remove only the active release after switching to the previous version. The
rollback choice keeps the LaunchAgent, configuration, and runtime data.

To remove configuration and runtime data as well:

```bash
./installer/macos/uninstall.sh --purge-data
```

## Test overrides

The scripts accept these environment variables for packaging tests or alternate locations:

```text
LLM_PROXY_SOURCE_ROOT
LLM_PROXY_INSTALL_ROOT
LLM_PROXY_CONFIG
LLM_PROXY_HOME
LLM_PROXY_ENV
LLM_PROXY_NODE_BIN
LLM_PROXY_NPM_BIN
LLM_PROXY_LAUNCHD_LABEL
LLM_PROXY_LAUNCH_AGENT
LLM_PROXY_LAUNCHD_DOMAIN
LLM_PROXY_LAUNCHCTL_BIN
LLM_PROXY_CURL_BIN
LLM_PROXY_HEALTHCHECK_URL
LLM_PROXY_HEALTHCHECK_ATTEMPTS
LLM_PROXY_HEALTHCHECK_DELAY
LLM_PROXY_SKIP_HEALTHCHECK
LLM_PROXY_ALLOW_NON_MACOS_TEST
```

The health-check overrides are intended for automated tests and controlled
diagnostics. `LLM_PROXY_ALLOW_NON_MACOS_TEST=1` is only for running installer
tests on non-macOS CI hosts; it must not be set for a real deployment. Do not
disable health checks for normal upgrades.
