import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const expected = '80f759c3eeca318811113856ae9bc4d62c1aa271';
const directory = mkdtempSync(join(tmpdir(), 'relay-native-compose-'));
const consumer = join(directory, 'consumer');
const pg = process.env.CAPABILITY_TEST_POSTGRES_BIN ?? '/opt/homebrew/opt/postgresql@17/bin';
const run = (command, args, options = {}) => execFileSync(command, args, { stdio: 'inherit', ...options });
let started = false;
try {
  run('git', ['fetch', 'origin', expected]);
  run('git', ['worktree', 'add', '--detach', consumer, expected]);
  run('pnpm', ['install', '--frozen-lockfile'], { cwd: consumer });
  run(join(pg, 'initdb'), ['-D', join(directory, 'data'), '-U', 'native_qualification', '--auth-local=trust', '--auth-host=trust', '--no-locale', '-E', 'UTF8']);
  run(join(pg, 'pg_ctl'), ['-D', join(directory, 'data'), '-l', join(directory, 'postgres.log'), '-o', `-k ${directory} -h 127.0.0.1 -p 55496`, '-w', 'start']); started = true;
  const env = { ...process.env, NODE_ENV: 'test', RELAY_NATIVE_CONSUMER_ROOT: consumer,
    RELAY_TEST_DATABASE_URL: 'postgresql://native_qualification@127.0.0.1:55496/postgres' };
  delete env.RELAY_DATABASE_URL; delete env.DATABASE_URL;
  const result = execFileSync('pnpm', ['exec', 'vitest', 'run', '--config', 'vitest.native-composed.config.mts', '--fileParallelism=false'], { env, encoding: 'utf8' });
  process.stdout.write(result);
  mkdirSync('docs/capability-control/evidence', { recursive: true });
  writeFileSync('docs/capability-control/evidence/native-composed.txt', `Consumer: ${expected}\n${result}`);
} finally {
  if (started) run(join(pg, 'pg_ctl'), ['-D', join(directory, 'data'), '-m', 'fast', '-w', 'stop']);
  // Evidence and exact checkout retained for failure inspection. No shared worktree is deleted.
}
