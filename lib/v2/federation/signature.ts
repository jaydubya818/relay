import { createHash } from 'node:crypto';
import { z } from 'zod';
import { canonicalJson } from '@/lib/v2/contracts';

export const DELIVERY_SIGNATURE_ALGORITHM = 'Relay-Ed25519-SHA256-v2';
export function deliverySignatureHeader(keyId: string) {
  return { alg: DELIVERY_SIGNATURE_ALGORITHM, typ: 'relay-federation+digest', kid: keyId, v: 2, purpose: 'federation-delivery' } as const;
}
const legacyHeader = z.object({ alg: z.literal('EdDSA'), typ: z.literal('relay-federation+jwt'), kid: z.string().min(1).max(255) }).strict();
const digestHeader = z.object({ alg: z.literal(DELIVERY_SIGNATURE_ALGORITHM), typ: z.literal('relay-federation+digest'), kid: z.string().min(1).max(255), v: z.literal(2), purpose: z.literal('federation-delivery') }).strict();
export const deliveryHeaderSchema = z.union([legacyHeader, digestHeader]);

/** Ordinary Ed25519 over a versioned commitment, NOT Ed25519ph or EdDSA JWS. */
export function deliverySignatureInput(material: string): string {
  return canonicalJson({ domain: 'relay.signature', version: 2, purpose: 'federation-delivery', hashAlgorithm: 'SHA-256', payloadHash: createHash('sha256').update(material, 'utf8').digest('hex') });
}

/** Require exact Relay encoding: no duplicate keys, invalid UTF-8, padding,
 * noncanonical numbers, whitespace or alternate escaping. Legacy is separate. */
export function parseCanonicalSegment(segment: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error('Invalid canonical signature encoding.');
  const bytes = Buffer.from(segment, 'base64url');
  if (bytes.toString('base64url') !== segment) throw new Error('Invalid canonical signature encoding.');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value: unknown = JSON.parse(text);
  if (canonicalJson(value) !== text) throw new Error('Noncanonical signature payload.');
  return value;
}
