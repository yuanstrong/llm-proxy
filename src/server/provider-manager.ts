import { ChildProcess, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Transform, type TransformCallback } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import type { AppConfig, ProviderConfig, ProviderManagerApi, ProviderStatus } from '../types';
import { ensureRuntimeDirectories, getLogDirectory } from './runtime';

type SpawnProvider = (
  providerName: string,
  provider: ProviderConfig,
  config: AppConfig,
) => ChildProcess;

function defaultSpawnProvider(
  providerName: string,
  provider: ProviderConfig,
  config: AppConfig,
): ChildProcess {
  const providerEntry = path.resolve(__dirname, 'provider' + (path.extname(__filename) === '.ts' ? '.ts' : '.js'));
  const args = path.extname(providerEntry) === '.ts'
    ? ['--import', 'tsx', providerEntry, providerName]
    : [providerEntry, providerName];

  return spawn(process.execPath, args, {
    env: {
      ...process.env,
      LLM_PROXY_CONFIG: config.configPath,
      LLM_PROXY_PROVIDER: providerName,
      LLM_PROXY_LOG_LEVEL: provider.log_level ?? 'info',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

class PrefixedLogTransform extends Transform {
  private readonly decoder = new StringDecoder('utf8');
  private pending = '';

  constructor(private readonly prefix: string) {
    super();
  }

  _transform(chunk: Buffer | string, encoding: BufferEncoding, callback: TransformCallback): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    this.pending += this.decoder.write(buffer);
    const lines = this.pending.split('\n');
    this.pending = lines.pop() ?? '';
    for (const line of lines) this.push(`${this.prefix}${line}\n`);
    callback();
  }

  _flush(callback: TransformCallback): void {
    this.pending += this.decoder.end();
    if (this.pending) this.push(`${this.prefix}${this.pending}`);
    callback();
  }
}

class ProviderLogSession {
  private readonly sourceEnds: Promise<void>[] = [];
  private readonly consoleWrites: Promise<void>[] = [];
  private closePromise?: Promise<void>;

  constructor(
    private readonly name: string,
    private readonly stream: fs.WriteStream,
  ) {}

  attach(source: NodeJS.ReadableStream | null, level: 'stdout' | 'stderr'): void {
    if (!source) return;

    const transform = new PrefixedLogTransform(`[${this.name}] `);
    this.sourceEnds.push(new Promise<void>((resolve) => transform.once('end', resolve)));
    transform.on('data', (chunk: Buffer) => {
      const destination = level === 'stderr' ? process.stderr : process.stdout;
      if (!destination.write(chunk)) {
        this.consoleWrites.push(new Promise<void>((resolve) => destination.once('drain', resolve)));
      }
    });
    transform.pipe(this.stream, { end: false });
    source.pipe(transform);
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;

    this.closePromise = Promise.all(this.sourceEnds)
      .then(() => Promise.all(this.consoleWrites))
      .then(() => new Promise<void>((resolve) => this.stream.end(resolve)));
    return this.closePromise;
  }
}

export class ProviderManager implements ProviderManagerApi {
  private readonly pidDirectory: string;
  private readonly logDirectory: string;
  private readonly children = new Map<string, ChildProcess>();
  private readonly logSessions = new Map<string, ProviderLogSession>();

  constructor(
    private readonly config: AppConfig,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly spawnProvider: SpawnProvider = defaultSpawnProvider,
  ) {
    this.pidDirectory = ensureRuntimeDirectories(env);
    this.logDirectory = getLogDirectory(env);
  }

  async start(name: string): Promise<ProviderStatus> {
    const provider = this.getProvider(name);
    const pidPath = this.pidPath(name);
    const existingPid = this.readPid(pidPath);

    if (existingPid !== undefined && this.isAlive(existingPid)) {
      return this.toStatus(provider, existingPid);
    }
    this.removePid(pidPath);

    const child = this.spawnProvider(name, provider, this.config);
    if (!child.pid) {
      throw new Error(`Failed to start provider '${name}': child process has no PID`);
    }

    const pid = child.pid;
    this.children.set(name, child);
    this.attachLogs(name, child);
    fs.writeFileSync(pidPath, `${pid}\n`, 'utf8');
    child.once('exit', () => {
      const currentPid = this.readPid(pidPath);
      if (currentPid === pid) this.removePid(pidPath);
      if (this.children.get(name) === child) this.children.delete(name);
    });
    child.once('error', () => {
      void this.closeLog(name);
      const currentPid = this.readPid(pidPath);
      if (currentPid === pid) this.removePid(pidPath);
      if (this.children.get(name) === child) this.children.delete(name);
    });
    child.once('close', () => void this.closeLog(name));

    return this.toStatus(provider, pid);
  }

  async stop(name: string): Promise<ProviderStatus> {
    const provider = this.getProvider(name);
    const pidPath = this.pidPath(name);
    const pid = this.readPid(pidPath);
    if (pid !== undefined) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    }

    const child = this.children.get(name);
    if (child) await this.waitForChild(child);
    await this.closeLog(name);
    this.removePid(pidPath);
    this.children.delete(name);
    return this.toStatus(provider);
  }

  async status(): Promise<ProviderStatus[]> {
    return Object.values(this.config.providers).map((provider) => {
      const pid = this.readPid(this.pidPath(provider.name));
      if (pid === undefined || !this.isAlive(pid)) {
        if (pid !== undefined) this.removePid(this.pidPath(provider.name));
        return this.toStatus(provider);
      }
      return this.toStatus(provider, pid);
    });
  }

  async shutdown(): Promise<void> {
    await Promise.all(Object.keys(this.config.providers).map((name) => this.stop(name)));
  }

  private getProvider(name: string): ProviderConfig {
    const provider = this.config.providers[name];
    if (!provider) throw new Error(`Unknown provider '${name}'`);
    return provider;
  }

  private pidPath(name: string): string {
    return path.join(this.pidDirectory, `${name}.pid`);
  }

  private attachLogs(name: string, child: ChildProcess): void {
    const logPath = path.join(this.logDirectory, `${name}.log`);
    const stream = fs.createWriteStream(logPath, { flags: 'a', encoding: 'utf8' });
    const session = new ProviderLogSession(name, stream);
    this.logSessions.set(name, session);
    session.attach(child.stdout, 'stdout');
    session.attach(child.stderr, 'stderr');
  }

  private closeLog(name: string): Promise<void> {
    const session = this.logSessions.get(name);
    if (!session) return Promise.resolve();
    const closing = session.close();
    void closing.then(
      () => {
        if (this.logSessions.get(name) === session) this.logSessions.delete(name);
      },
      () => {
        if (this.logSessions.get(name) === session) this.logSessions.delete(name);
      },
    );
    return closing;
  }

  private waitForChild(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise<void>((resolve) => child.once('close', () => resolve()));
  }

  private readPid(pidPath: string): number | undefined {
    try {
      const pid = Number(fs.readFileSync(pidPath, 'utf8').trim());
      return Number.isInteger(pid) && pid > 0 ? pid : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return undefined;
    }
  }

  private removePid(pidPath: string): void {
    try {
      fs.unlinkSync(pidPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private toStatus(provider: ProviderConfig, pid?: number): ProviderStatus {
    return {
      name: provider.name,
      listen: provider.listen,
      running: pid !== undefined,
      ...(pid === undefined ? {} : { pid }),
    };
  }
}
