import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { expect, it } from 'vitest';
import { canonicalJson } from '@/lib/v2/contracts';

// Protocol design vector: independent construction, not a provider adapter.
const commitment = (material: string, purpose = 'federation-delivery', version = 2) => canonicalJson({
  domain: 'relay.signature', version, purpose, hashAlgorithm: 'SHA-256',
  payloadHash: createHash('sha256').update(material).digest('hex'),
});
it('binds version, purpose and all material bytes using standard primitives', () => {
  const pair = generateKeyPairSync('ed25519');
  const material = 'synthetic.header-and-complete-envelope';
  const preimage = commitment(material);
  const signature = sign(null, Buffer.from(preimage), pair.privateKey);
  expect(verify(null, Buffer.from(preimage), pair.publicKey, signature)).toBe(true);
  for (const changed of [material, commitment(material + 'x'), commitment(material, 'passport'), commitment(material, 'federation-delivery', 1)]) {
    expect(verify(null, Buffer.from(changed), pair.publicKey, signature)).toBe(false);
  }
  expect(Buffer.byteLength(commitment('x'.repeat(262057)))).toBe(Buffer.byteLength(preimage));
  expect(Buffer.byteLength(preimage)).toBeLessThan(256);
});
it('specifies deterministic field ordering without Unicode normalization', () => {
  expect(canonicalJson({ b: 2, a: 'é' })).toBe(canonicalJson({ a: 'é', b: 2 }));
  expect(commitment(canonicalJson({ a: 'é' }))).not.toBe(commitment(canonicalJson({ a: 'e\u0301' })));
  expect(canonicalJson({ zero: -0, control: '\0' })).toBe('{"control":"\\u0000","zero":0}');
  expect(() => canonicalJson({ number: Infinity })).toThrow();
});
