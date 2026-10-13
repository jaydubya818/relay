import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const consumer = process.env.RELAY_NATIVE_CONSUMER_ROOT;
const expected = '80f759c3eeca318811113856ae9bc4d62c1aa271';
if (!consumer || execFileSync('git', ['-C', consumer, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== expected)
  throw Error('Exact qualified native consumer source required');
execFileSync('git', ['-C', consumer, 'diff', '--exit-code', 'HEAD', '--', 'lib', 'tests/integrations/fixtures.ts'], { stdio: 'pipe' });
export default defineConfig({ test: { environment: 'node', sequence: { concurrent: false },
  include: ['tests/v2/native-composed.qualification.ts'], testTimeout: 20000 },
  resolve: { alias: { '@/lib/integrations': resolve(consumer, 'lib/integrations'), '@consumer': resolve(consumer), '@': fileURLToPath(new URL('.', import.meta.url)) } },
});
