import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { CAPABILITY_FAILURE_CODES } from '@/lib/v2/policy/capability-failures';

it('enumerates every thrown CAPABILITY_* reason in the HTTP mapping', () => {
  const thrown = new Set<string>();
  for (const file of [
    'lib/v2/policy/ordering.ts',
    'lib/v2/policy/ordering-wire.ts',
    'lib/v2/policy/lifecycle-wire.ts',
  ]) {
    for (const match of readFileSync(file, 'utf8').matchAll(/Error\('(CAPABILITY_[A-Z0-9_]+)'\)/g)) thrown.add(match[1]!);
  }
  expect([...thrown].sort()).toEqual([...CAPABILITY_FAILURE_CODES].sort());
});
