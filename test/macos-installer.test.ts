import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, readFile, readlink, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const testPlatformEnv = { LLM_PROXY_ALLOW_NON_MACOS_TEST: '1' };

async function validateGeneratedPlist(output: string) {
  if (process.platform === 'darwin') {
    try {
      await access('/usr/bin/plutil');
      await execFileAsync('/usr/bin/plutil', ['-lint', output]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  const plist = await readFile(output, 'utf8');
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(plist, /LLM &amp; Proxy/);
  assert.match(plist, /<string>\/opt\/homebrew\/bin\/node<\/string>/);
  assert.match(plist, /<key>LLM_PROXY_CONFIG<\/key>/);
  assert.match(plist, /<key>LLM_PROXY_HOME<\/key>/);
  assert.match(plist, /<key>LLM_PROXY_ENV<\/key>/);
  assert.match(plist, /config\/\.env/);
}

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
      '/Users/tester/Library/Application Support/LLM & Proxy/config/.env',
    ]);
    await validateGeneratedPlist(output);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('install check validates the release without registering a service', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-install-check-'));
  const installer = path.resolve('installer/macos/install.sh');
  const plist = path.join(tempDir, 'LaunchAgents', 'com.example.llm-proxy.plist');
  const sourceRoot = path.join(tempDir, 'release');

  try {
    await mkdir(path.join(sourceRoot, 'dist', 'server', 'server'), { recursive: true });
    await mkdir(path.join(sourceRoot, 'dist', 'ui'), { recursive: true });
    await writeFile(path.join(sourceRoot, 'package.json'), '{"name":"fixture","version":"1.0.0"}');
    await writeFile(path.join(sourceRoot, 'package-lock.json'), '{}');
    await writeFile(path.join(sourceRoot, 'dist', 'server', 'server', 'index.js'), '');
    await writeFile(path.join(sourceRoot, 'dist', 'server', 'server', 'provider.js'), '');
    await writeFile(path.join(sourceRoot, 'dist', 'ui', 'index.html'), '<!doctype html>');

    const result = await execFileAsync('/bin/bash', [installer, '--check'], {
      env: {
        ...process.env,
        ...testPlatformEnv,
        LLM_PROXY_SOURCE_ROOT: sourceRoot,
        LLM_PROXY_INSTALL_ROOT: path.join(tempDir, 'app'),
        LLM_PROXY_LAUNCH_AGENT: plist,
      },
    });

    assert.match(result.stdout, /preflight check passed/i);
    await assert.rejects(access(plist));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('install check rejects a pnpm-only release because target machines use npm', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-lock-check-'));
  const installer = path.resolve('installer/macos/install.sh');
  const sourceRoot = path.join(tempDir, 'release');

  try {
    await mkdir(path.join(sourceRoot, 'dist', 'server', 'server'), { recursive: true });
    await mkdir(path.join(sourceRoot, 'dist', 'ui'), { recursive: true });
    await writeFile(path.join(sourceRoot, 'package.json'), '{"name":"fixture","version":"1.0.0"}');
    await writeFile(path.join(sourceRoot, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0');
    await writeFile(path.join(sourceRoot, 'dist', 'server', 'server', 'index.js'), '');
    await writeFile(path.join(sourceRoot, 'dist', 'server', 'server', 'provider.js'), '');
    await writeFile(path.join(sourceRoot, 'dist', 'ui', 'index.html'), '<!doctype html>');

    await assert.rejects(
      execFileAsync('/bin/bash', [installer, '--check'], {
        env: {
          ...process.env,
          ...testPlatformEnv,
          LLM_PROXY_SOURCE_ROOT: sourceRoot,
        },
      }),
      (error: NodeJS.ErrnoException & { stderr?: string }) => {
        assert.match(error.stderr ?? '', /package-lock\.json/i);
        return true;
      },
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('prepare-release generates package-lock.json with npm', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-prepare-release-'));
  const sourceRoot = path.join(tempDir, 'source');
  const outputDir = path.join(tempDir, 'release');
  const fakeNpm = path.join(tempDir, 'fake-npm.bash');
  const npmLog = path.join(tempDir, 'npm.log');
  const prepareRelease = path.resolve('installer/macos/prepare-release.sh');

  try {
    await mkdir(path.join(sourceRoot, 'dist', 'server', 'server'), { recursive: true });
    await mkdir(path.join(sourceRoot, 'dist', 'ui'), { recursive: true });
    await mkdir(path.join(sourceRoot, 'installer', 'macos'), { recursive: true });
    await writeFile(path.join(sourceRoot, 'package.json'), '{"name":"fixture","version":"1.0.0"}');
    await writeFile(path.join(sourceRoot, 'dist', 'server', 'server', 'index.js'), '');
    await writeFile(path.join(sourceRoot, 'dist', 'server', 'server', 'provider.js'), '');
    await writeFile(path.join(sourceRoot, 'dist', 'ui', 'index.html'), '<!doctype html>');
    await writeFile(path.join(sourceRoot, 'installer', 'macos', 'install.sh'), '#!/bin/bash');
    await writeFile(
      fakeNpm,
      '#!/bin/bash\nprintf "%s\\n" "$*" > "$FAKE_NPM_LOG"\nprintf \'{"lockfileVersion":3}\\n\' > package-lock.json\n',
    );
    await chmod(fakeNpm, 0o755);

    await execFileAsync('/bin/bash', [prepareRelease, outputDir], {
      env: {
        ...process.env,
        ...testPlatformEnv,
        LLM_PROXY_SOURCE_ROOT: sourceRoot,
        LLM_PROXY_NPM_BIN: fakeNpm,
        FAKE_NPM_LOG: npmLog,
      },
    });

    assert.match(await readFile(npmLog, 'utf8'), /install .*--package-lock-only/);
    assert.deepEqual(JSON.parse(await readFile(path.join(outputDir, 'package-lock.json'), 'utf8')), {
      lockfileVersion: 3,
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('install exits successfully after moving the staging directory', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-install-smoke-'));
  const sourceRoot = path.join(tempDir, 'release');
  const installRoot = path.join(tempDir, 'installed');
  const plist = path.join(tempDir, 'LaunchAgents', 'com.example.llm-proxy.plist');
  const fakeNpm = path.join(tempDir, 'fake-npm.bash');
  const installer = path.resolve('installer/macos/install.sh');

  try {
    await mkdir(path.join(sourceRoot, 'dist', 'server', 'server'), { recursive: true });
    await mkdir(path.join(sourceRoot, 'dist', 'ui'), { recursive: true });
    await writeFile(path.join(sourceRoot, 'package.json'), '{"name":"fixture","version":"1.0.0"}');
    await writeFile(path.join(sourceRoot, 'package-lock.json'), '{}');
    await writeFile(path.join(sourceRoot, 'config.toml'), '[providers.test]\n');
    await writeFile(path.join(sourceRoot, 'dist', 'server', 'server', 'index.js'), '');
    await writeFile(path.join(sourceRoot, 'dist', 'server', 'server', 'provider.js'), '');
    await writeFile(path.join(sourceRoot, 'dist', 'ui', 'index.html'), '<!doctype html>');
    await writeFile(fakeNpm, '#!/bin/bash\nmkdir -p node_modules\n');
    await chmod(fakeNpm, 0o755);

    await execFileAsync('/bin/bash', [installer], {
      env: {
        ...process.env,
        ...testPlatformEnv,
        LLM_PROXY_SOURCE_ROOT: sourceRoot,
        LLM_PROXY_INSTALL_ROOT: installRoot,
        LLM_PROXY_LAUNCH_AGENT: plist,
        LLM_PROXY_LAUNCHCTL_BIN: '/usr/bin/true',
        LLM_PROXY_NPM_BIN: fakeNpm,
        LLM_PROXY_SKIP_HEALTHCHECK: '1',
      },
    });

    await access(path.join(installRoot, 'current', 'dist', 'server', 'server', 'index.js'));
    await access(plist);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('upgrade requires explicit confirmation when an active release exists', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-upgrade-confirm-'));
  const sourceRoot = path.join(tempDir, 'release');
  const installRoot = path.join(tempDir, 'installed');
  const plist = path.join(tempDir, 'LaunchAgents', 'com.example.llm-proxy.plist');
  const installer = path.resolve('installer/macos/install.sh');

  try {
    await mkdir(path.join(sourceRoot, 'dist', 'server', 'server'), { recursive: true });
    await mkdir(path.join(sourceRoot, 'dist', 'ui'), { recursive: true });
    await writeFile(path.join(sourceRoot, 'package.json'), '{"name":"fixture","version":"1.1.0"}');
    await writeFile(path.join(sourceRoot, 'package-lock.json'), '{}');
    await writeFile(path.join(sourceRoot, 'config.toml'), '[providers.test]\n');
    await writeFile(path.join(sourceRoot, 'dist', 'server', 'server', 'index.js'), '');
    await writeFile(path.join(sourceRoot, 'dist', 'server', 'server', 'provider.js'), '');
    await writeFile(path.join(sourceRoot, 'dist', 'ui', 'index.html'), '<!doctype html>');
    await mkdir(path.join(installRoot, 'releases', '1.0.0'), { recursive: true });
    await symlink(path.join(installRoot, 'releases', '1.0.0'), path.join(installRoot, 'current'));

    await assert.rejects(
      execFileAsync('/bin/bash', [installer], {
        env: {
          ...process.env,
          ...testPlatformEnv,
          LLM_PROXY_SOURCE_ROOT: sourceRoot,
          LLM_PROXY_INSTALL_ROOT: installRoot,
          LLM_PROXY_LAUNCH_AGENT: plist,
          LLM_PROXY_LAUNCHCTL_BIN: '/usr/bin/true',
          LLM_PROXY_SKIP_HEALTHCHECK: '1',
        },
      }),
      (error: NodeJS.ErrnoException & { stderr?: string }) => {
        assert.match(error.stderr ?? '', /confirm|upgrade/i);
        assert.match(error.stderr ?? '', /1\.0\.0/);
        assert.match(error.stderr ?? '', /1\.1\.0/);
        return true;
      },
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('confirmed upgrade stops the old service and starts the new release', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-upgrade-apply-'));
  const sourceRoot = path.join(tempDir, 'release');
  const installRoot = path.join(tempDir, 'installed');
  const oldRelease = path.join(installRoot, 'releases', '1.0.0');
  const plist = path.join(tempDir, 'LaunchAgents', 'com.example.llm-proxy.plist');
  const fakeNpm = path.join(tempDir, 'fake-npm.bash');
  const fakeLaunchctl = path.join(tempDir, 'fake-launchctl.bash');
  const launchctlLog = path.join(tempDir, 'launchctl.log');
  const installer = path.resolve('installer/macos/install.sh');

  try {
    await mkdir(path.join(sourceRoot, 'dist', 'server', 'server'), { recursive: true });
    await mkdir(path.join(sourceRoot, 'dist', 'ui'), { recursive: true });
    await writeFile(path.join(sourceRoot, 'package.json'), '{"name":"fixture","version":"1.1.0"}');
    await writeFile(path.join(sourceRoot, 'package-lock.json'), '{}');
    await writeFile(path.join(sourceRoot, 'config.toml'), '[providers.test]\n');
    await writeFile(path.join(sourceRoot, 'dist', 'server', 'server', 'index.js'), '');
    await writeFile(path.join(sourceRoot, 'dist', 'server', 'server', 'provider.js'), '');
    await writeFile(path.join(sourceRoot, 'dist', 'ui', 'index.html'), '<!doctype html>');
    await mkdir(oldRelease, { recursive: true });
    await writeFile(path.join(oldRelease, 'package.json'), '{"version":"1.0.0"}');
    await symlink(oldRelease, path.join(installRoot, 'current'));
    await writeFile(fakeNpm, '#!/bin/bash\nmkdir -p node_modules\n');
    await writeFile(
      fakeLaunchctl,
      '#!/bin/bash\nprintf "%s\\n" "$*" >> "$LLM_PROXY_LAUNCHCTL_LOG"\n',
    );
    await chmod(fakeNpm, 0o755);
    await chmod(fakeLaunchctl, 0o755);

    await execFileAsync('/bin/bash', [installer, '--yes'], {
      env: {
        ...process.env,
        ...testPlatformEnv,
        LLM_PROXY_SOURCE_ROOT: sourceRoot,
        LLM_PROXY_INSTALL_ROOT: installRoot,
        LLM_PROXY_LAUNCH_AGENT: plist,
        LLM_PROXY_LAUNCHCTL_BIN: fakeLaunchctl,
        LLM_PROXY_LAUNCHCTL_LOG: launchctlLog,
        LLM_PROXY_NPM_BIN: fakeNpm,
        LLM_PROXY_SKIP_HEALTHCHECK: '1',
      },
    });

    assert.equal(await readlink(path.join(installRoot, 'current')), path.join(installRoot, 'releases', '1.1.0'));
    assert.match(await readFile(launchctlLog, 'utf8'), /bootout/);
    assert.match(await readFile(launchctlLog, 'utf8'), /bootstrap/);
    await access(oldRelease);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('upgrade retains the current release and only the four newest historical releases', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-upgrade-retention-'));
  const sourceRoot = path.join(tempDir, 'release');
  const installRoot = path.join(tempDir, 'installed');
  const releasesRoot = path.join(installRoot, 'releases');
  const plist = path.join(tempDir, 'LaunchAgents', 'com.example.llm-proxy.plist');
  const fakeNpm = path.join(tempDir, 'fake-npm.bash');
  const installer = path.resolve('installer/macos/install.sh');

  try {
    await mkdir(path.join(sourceRoot, 'dist', 'server', 'server'), { recursive: true });
    await mkdir(path.join(sourceRoot, 'dist', 'ui'), { recursive: true });
    await writeFile(path.join(sourceRoot, 'package.json'), '{"name":"fixture","version":"6.0.0"}');
    await writeFile(path.join(sourceRoot, 'package-lock.json'), '{}');
    await writeFile(path.join(sourceRoot, 'config.toml'), '[providers.test]\n');
    await writeFile(path.join(sourceRoot, 'dist', 'server', 'server', 'index.js'), '');
    await writeFile(path.join(sourceRoot, 'dist', 'server', 'server', 'provider.js'), '');
    await writeFile(path.join(sourceRoot, 'dist', 'ui', 'index.html'), '<!doctype html>');
    const tiedHistoricalMtime = new Date('2030-01-01T00:00:00.000Z');
    for (const version of ['1.0.0', '2.0.0', '3.0.0', '4.0.0', '5.0.0']) {
      const releasePath = path.join(releasesRoot, version);
      await mkdir(releasePath, { recursive: true });
      await utimes(releasePath, tiedHistoricalMtime, tiedHistoricalMtime);
    }
    await symlink(path.join(releasesRoot, '5.0.0'), path.join(installRoot, 'current'));
    await writeFile(fakeNpm, '#!/bin/bash\nmkdir -p node_modules\n');
    await chmod(fakeNpm, 0o755);

    await execFileAsync('/bin/bash', [installer, '--yes'], {
      env: {
        ...process.env,
        ...testPlatformEnv,
        LLM_PROXY_SOURCE_ROOT: sourceRoot,
        LLM_PROXY_INSTALL_ROOT: installRoot,
        LLM_PROXY_LAUNCH_AGENT: plist,
        LLM_PROXY_LAUNCHCTL_BIN: '/usr/bin/true',
        LLM_PROXY_NPM_BIN: fakeNpm,
        LLM_PROXY_SKIP_HEALTHCHECK: '1',
      },
    });

    await assert.rejects(access(path.join(releasesRoot, '1.0.0')));
    for (const version of ['2.0.0', '3.0.0', '4.0.0', '5.0.0', '6.0.0']) {
      await access(path.join(releasesRoot, version));
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('failed health verification restores the previous release and restarts it', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-upgrade-rollback-'));
  const sourceRoot = path.join(tempDir, 'release');
  const installRoot = path.join(tempDir, 'installed');
  const oldRelease = path.join(installRoot, 'releases', '1.0.0');
  const plist = path.join(tempDir, 'LaunchAgents', 'com.example.llm-proxy.plist');
  const fakeNpm = path.join(tempDir, 'fake-npm.bash');
  const fakeCurl = path.join(tempDir, 'fake-curl.bash');
  const installer = path.resolve('installer/macos/install.sh');

  try {
    await mkdir(path.join(sourceRoot, 'dist', 'server', 'server'), { recursive: true });
    await mkdir(path.join(sourceRoot, 'dist', 'ui'), { recursive: true });
    await writeFile(path.join(sourceRoot, 'package.json'), '{"name":"fixture","version":"2.0.0"}');
    await writeFile(path.join(sourceRoot, 'package-lock.json'), '{}');
    await writeFile(path.join(sourceRoot, 'config.toml'), '[providers.test]\n');
    await writeFile(path.join(sourceRoot, 'dist', 'server', 'server', 'index.js'), '');
    await writeFile(path.join(sourceRoot, 'dist', 'server', 'server', 'provider.js'), '');
    await writeFile(path.join(sourceRoot, 'dist', 'ui', 'index.html'), '<!doctype html>');
    await mkdir(oldRelease, { recursive: true });
    await writeFile(path.join(oldRelease, 'package.json'), '{"version":"1.0.0"}');
    await symlink(oldRelease, path.join(installRoot, 'current'));
    await writeFile(fakeNpm, '#!/bin/bash\nmkdir -p node_modules\n');
    await writeFile(fakeCurl, '#!/bin/bash\nexit 1\n');
    await chmod(fakeNpm, 0o755);
    await chmod(fakeCurl, 0o755);

    await assert.rejects(
      execFileAsync('/bin/bash', [installer, '--yes'], {
        env: {
          ...process.env,
          ...testPlatformEnv,
          LLM_PROXY_SOURCE_ROOT: sourceRoot,
          LLM_PROXY_INSTALL_ROOT: installRoot,
          LLM_PROXY_LAUNCH_AGENT: plist,
          LLM_PROXY_LAUNCHCTL_BIN: '/usr/bin/true',
          LLM_PROXY_NPM_BIN: fakeNpm,
          LLM_PROXY_CURL_BIN: fakeCurl,
          LLM_PROXY_HEALTHCHECK_ATTEMPTS: '1',
          LLM_PROXY_HEALTHCHECK_DELAY: '0',
        },
      }),
      (error: NodeJS.ErrnoException & { stderr?: string }) => {
        assert.match(error.stderr ?? '', /previous release was restored/i);
        return true;
      },
    );

    assert.equal(await readlink(path.join(installRoot, 'current')), oldRelease);
    await access(oldRelease);
    await assert.rejects(access(path.join(installRoot, 'releases', '2.0.0')));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('rollback switches current to a selected historical release and starts the service', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-rollback-command-'));
  const installRoot = path.join(tempDir, 'installed');
  const currentRelease = path.join(installRoot, 'releases', '2.0.0');
  const previousRelease = path.join(installRoot, 'releases', '1.0.0');
  const plist = path.join(tempDir, 'LaunchAgents', 'com.example.llm-proxy.plist');
  const rollback = path.resolve('installer/macos/rollback.sh');

  try {
    await mkdir(currentRelease, { recursive: true });
    await mkdir(previousRelease, { recursive: true });
    await writeFile(path.join(currentRelease, 'package.json'), '{"version":"2.0.0"}');
    await writeFile(path.join(previousRelease, 'package.json'), '{"version":"1.0.0"}');
    await symlink(currentRelease, path.join(installRoot, 'current'));
    await mkdir(path.dirname(plist), { recursive: true });
    await writeFile(plist, '<?xml version="1.0"?><plist/>');

    await execFileAsync('/bin/bash', [rollback, '1.0.0', '--yes'], {
      env: {
        ...process.env,
        LLM_PROXY_INSTALL_ROOT: installRoot,
        LLM_PROXY_LAUNCH_AGENT: plist,
        LLM_PROXY_LAUNCHCTL_BIN: '/usr/bin/true',
        LLM_PROXY_SKIP_HEALTHCHECK: '1',
      },
    });

    assert.equal(await readlink(path.join(installRoot, 'current')), previousRelease);
    await access(currentRelease);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('noninteractive install fails with the persistent env file when a config variable is missing', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-missing-env-'));
  const sourceRoot = path.join(tempDir, 'release');
  const installRoot = path.join(tempDir, 'installed');
  const plist = path.join(tempDir, 'LaunchAgents', 'com.example.llm-proxy.plist');
  const fakeNpm = path.join(tempDir, 'fake-npm.bash');
  const installer = path.resolve('installer/macos/install.sh');

  try {
    await mkdir(path.join(sourceRoot, 'dist', 'server', 'server'), { recursive: true });
    await mkdir(path.join(sourceRoot, 'dist', 'ui'), { recursive: true });
    await writeFile(path.join(sourceRoot, 'package.json'), '{"name":"fixture","version":"1.0.0"}');
    await writeFile(path.join(sourceRoot, 'package-lock.json'), '{}');
    await writeFile(
      path.join(sourceRoot, 'config.toml'),
      '[providers.test]\nlisten = "127.0.0.1:9000"\napi_key = "${DEEPSEEK_API_KEY}"\n',
    );
    await writeFile(path.join(sourceRoot, 'dist', 'server', 'server', 'index.js'), '');
    await writeFile(path.join(sourceRoot, 'dist', 'server', 'server', 'provider.js'), '');
    await writeFile(path.join(sourceRoot, 'dist', 'ui', 'index.html'), '<!doctype html>');
    await writeFile(fakeNpm, '#!/bin/bash\nmkdir -p node_modules\n');
    await chmod(fakeNpm, 0o755);

    await assert.rejects(
      execFileAsync('/bin/bash', [installer], {
        env: {
          ...process.env,
          ...testPlatformEnv,
          LLM_PROXY_SOURCE_ROOT: sourceRoot,
          LLM_PROXY_INSTALL_ROOT: installRoot,
          LLM_PROXY_LAUNCH_AGENT: plist,
          LLM_PROXY_LAUNCHCTL_BIN: '/usr/bin/true',
          LLM_PROXY_NPM_BIN: fakeNpm,
        },
      }),
      (error: NodeJS.ErrnoException & { stderr?: string }) => {
        assert.match(error.stderr ?? '', /DEEPSEEK_API_KEY/);
        assert.match(error.stderr ?? '', /\.env/);
        return true;
      },
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('service status explains when the LaunchAgent is not installed', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-service-'));
  const service = path.resolve('installer/macos/service.sh');
  const plist = path.join(tempDir, 'LaunchAgents', 'com.example.llm-proxy.plist');

  try {
    await assert.rejects(
      execFileAsync('/bin/bash', [service, 'status'], {
        env: {
          ...process.env,
          LLM_PROXY_LAUNCH_AGENT: plist,
          LLM_PROXY_LAUNCHD_DOMAIN: 'gui/999999',
        },
      }),
      (error: NodeJS.ErrnoException & { stderr?: string }) => {
        assert.match(error.stderr ?? '', /LaunchAgent is not installed/i);
        return true;
      },
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('uninstall removes service files while preserving config and runtime data', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-uninstall-'));
  const appRoot = path.join(tempDir, 'app');
  const installDir = path.join(appRoot, 'releases', '1.0.0');
  const current = path.join(appRoot, 'current');
  const config = path.join(appRoot, 'config', 'config.toml');
  const runtime = path.join(appRoot, 'runtime');
  const plist = path.join(tempDir, 'LaunchAgents', 'com.example.llm-proxy.plist');
  const uninstaller = path.resolve('installer/macos/uninstall.sh');

  try {
    await mkdir(installDir, { recursive: true });
    await mkdir(path.dirname(config), { recursive: true });
    await mkdir(runtime, { recursive: true });
    await mkdir(path.dirname(plist), { recursive: true });
    await symlink(installDir, current);
    await writeFile(config, '[providers.test]\n');
    await writeFile(plist, '<?xml version="1.0"?><plist/>');

    await execFileAsync('/bin/bash', [uninstaller], {
      env: {
        ...process.env,
        LLM_PROXY_INSTALL_ROOT: appRoot,
        LLM_PROXY_LAUNCH_AGENT: plist,
        LLM_PROXY_LAUNCHD_DOMAIN: 'gui/999999',
      },
    });

    await assert.rejects(access(current));
    await assert.rejects(access(installDir));
    await access(config);
    await access(runtime);
    await assert.rejects(access(plist));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('uninstall requires a choice when multiple releases exist', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-uninstall-choice-'));
  const appRoot = path.join(tempDir, 'app');
  const plist = path.join(tempDir, 'LaunchAgents', 'com.example.llm-proxy.plist');
  const uninstaller = path.resolve('installer/macos/uninstall.sh');

  try {
    await mkdir(path.join(appRoot, 'releases', '1.0.0'), { recursive: true });
    await mkdir(path.join(appRoot, 'releases', '2.0.0'), { recursive: true });
    await symlink(path.join(appRoot, 'releases', '2.0.0'), path.join(appRoot, 'current'));
    await mkdir(path.dirname(plist), { recursive: true });
    await writeFile(plist, '<?xml version="1.0"?><plist/>');

    await assert.rejects(
      execFileAsync('/bin/bash', [uninstaller], {
        env: {
          ...process.env,
          LLM_PROXY_INSTALL_ROOT: appRoot,
          LLM_PROXY_LAUNCH_AGENT: plist,
          LLM_PROXY_LAUNCHD_DOMAIN: 'gui/999999',
        },
      }),
      (error: NodeJS.ErrnoException & { stderr?: string }) => {
        assert.match(error.stderr ?? '', /all|rollback|choice/i);
        assert.match(error.stderr ?? '', /1\.0\.0/);
        assert.match(error.stderr ?? '', /2\.0\.0/);
        return true;
      },
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('uninstall rollback removes only the active release and preserves the service data', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'llm-proxy-uninstall-rollback-'));
  const appRoot = path.join(tempDir, 'app');
  const activeRelease = path.join(appRoot, 'releases', '2.0.0');
  const previousRelease = path.join(appRoot, 'releases', '1.0.0');
  const config = path.join(appRoot, 'config', 'config.toml');
  const runtime = path.join(appRoot, 'runtime');
  const plist = path.join(tempDir, 'LaunchAgents', 'com.example.llm-proxy.plist');
  const uninstaller = path.resolve('installer/macos/uninstall.sh');

  try {
    await mkdir(activeRelease, { recursive: true });
    await mkdir(previousRelease, { recursive: true });
    await mkdir(path.dirname(config), { recursive: true });
    await mkdir(runtime, { recursive: true });
    await mkdir(path.dirname(plist), { recursive: true });
    await symlink(activeRelease, path.join(appRoot, 'current'));
    await writeFile(config, '[providers.test]\n');
    await writeFile(plist, '<?xml version="1.0"?><plist/>');

    await execFileAsync('/bin/bash', [uninstaller, '--rollback'], {
      env: {
        ...process.env,
        LLM_PROXY_INSTALL_ROOT: appRoot,
        LLM_PROXY_LAUNCH_AGENT: plist,
        LLM_PROXY_LAUNCHCTL_BIN: '/usr/bin/true',
        LLM_PROXY_SKIP_HEALTHCHECK: '1',
      },
    });

    assert.equal(await readlink(path.join(appRoot, 'current')), previousRelease);
    await assert.rejects(access(activeRelease));
    await access(previousRelease);
    await access(config);
    await access(runtime);
    await access(plist);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
