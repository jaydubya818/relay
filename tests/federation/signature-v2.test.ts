import { generateKeyPairSync, sign } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { canonicalJson } from '@/lib/v2/contracts';
import { signDelivery, verifyDelivery } from '@/lib/v2/federation/transport';
import { deliverySignatureInput, deliverySignatureHeader } from '@/lib/v2/federation/signature';
import { SigningKeyring, type SigningKey } from '@/lib/v2/evidence/signing-provider';
import { GoogleKmsEd25519Provider, crc32c } from '@/lib/v2/evidence/google-kms';

const encode = (value: unknown) => Buffer.from(canonicalJson(value)).toString('base64url');
function fixture() {
  const pair = generateKeyPairSync('ed25519');
  const audience = 'relay://owner-b/agent-b', issuer = 'https://relay.synthetic.invalid';
  const envelope = { id: 'request-0001', protocol: 'relay.federation', version: '1.0', caller: { ownerId: 'owner-a', agentId: 'agent-a' }, target: { ownerId: 'owner-b', agentId: 'agent-b', address: audience }, capability: 'message.send', resource: 'messages', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString(), idempotencyKey: 'request-0001', payload: { body: 'café e\u0301 🙂 \0' }, publication: null, authorizationContext: { grantId: 'grant', policyDecisionId: 'decision', localAuthorizationRequired: true } };
  const claims = { iss: issuer, aud: audience, jti: envelope.id, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60, envelope };
  const key: SigningKey = { keyId: 'delivery-1', keyVersion: 'projects/synthetic/locations/us-east4/keyRings/fq/cryptoKeys/delivery/cryptoKeyVersions/1', purpose: 'federation-delivery', algorithm: 'Ed25519', publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(), state: 'ACTIVE', activatedAt: '2020-01-01T00:00:00Z' };
  const ring = new SigningKeyring([key], { async sign(_key, bytes) { return sign(null, bytes, pair.privateKey); } });
  const options = { issuer, audience, trustedPublicKey: async (id: string) => ring.verificationKey(id, 'federation-delivery')?.publicKeyPem, claimRequest: vi.fn(async () => true) };
  const raw = (header: unknown, payload = encode(claims), digest = true) => {
    const material = `${encode(header)}.${payload}`;
    return `${material}.${sign(null, Buffer.from(digest ? deliverySignatureInput(material) : material), pair.privateKey).toString('base64url')}`;
  };
  return { pair, key, ring, claims, envelope, options, raw, header: deliverySignatureHeader(key.keyId) };
}
it('new producer emits only v2 and durable replay admission is last', async () => {
  const f = fixture();
  const token = await signDelivery(f.envelope, f.options.audience, f.envelope.id, f.envelope.expiresAt, { signer: f.ring.signer('federation-delivery'), issuer: f.options.issuer, keyWrapper: { keyId: 'unused', wrap: vi.fn(), unwrap: vi.fn() } });
  expect(JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString())).toEqual(f.header);
  f.options.claimRequest.mockResolvedValueOnce(true).mockResolvedValue(false);
  await expect(verifyDelivery(token, f.options)).resolves.toEqual(f.envelope);
  await expect(verifyDelivery(token, f.options)).rejects.toThrow('already claimed');
});
it.each(['payload', 'purpose', 'version', 'key', 'commitment', 'signature-bit', 'payload-bit', 'preimage-purpose', 'preimage-version'] as const)('rejects %s substitution before replay claim', async (kind) => {
  const f = fixture(), parts = f.raw(f.header).split('.');
  if (kind === 'payload') { f.claims.envelope.payload.body += 'x'; parts[1] = encode(f.claims); }
  if (kind === 'purpose') parts[0] = encode({ ...f.header, purpose: 'passport' });
  if (kind === 'version') parts[0] = encode({ ...f.header, v: 3 });
  if (kind === 'key') { parts[0] = encode({ ...f.header, kid: 'delivery-2' }); f.options.trustedPublicKey = async () => f.key.publicKeyPem; }
  if (kind === 'commitment') { const preimage = JSON.parse(deliverySignatureInput(parts.slice(0, 2).join('.'))); preimage.payloadHash = '0'.repeat(64); parts[2] = sign(null, Buffer.from(canonicalJson(preimage)), f.pair.privateKey).toString('base64url'); }
  if (kind === 'payload-bit') { const bytes = Buffer.from(parts[1], 'base64url'); const pos = bytes.indexOf(Buffer.from('café')); bytes[pos] ^= 1; parts[1] = bytes.toString('base64url'); }
  if (kind === 'preimage-purpose' || kind === 'preimage-version') { const preimage = JSON.parse(deliverySignatureInput(parts.slice(0, 2).join('.'))); if (kind === 'preimage-purpose') preimage.purpose = 'passport'; else preimage.version = 1; parts[2] = sign(null, Buffer.from(canonicalJson(preimage)), f.pair.privateKey).toString('base64url'); }
  if (kind === 'signature-bit') { const signature = Buffer.from(parts[2], 'base64url'); signature[0] ^= 1; parts[2] = signature.toString('base64url'); }
  await expect(verifyDelivery(parts.join('.'), f.options)).rejects.toThrow();
  expect(f.options.claimRequest).not.toHaveBeenCalled();
});
it('preserves legacy raw verification and rejects either format signed under the other contract', async () => {
  const f = fixture(), legacy = { alg: 'EdDSA', typ: 'relay-federation+jwt', kid: f.key.keyId };
  await expect(verifyDelivery(f.raw(legacy, undefined, false), f.options)).resolves.toEqual(f.envelope);
  await expect(verifyDelivery(f.raw(f.header), f.options)).resolves.toEqual(f.envelope);
  await expect(verifyDelivery(f.raw(legacy), f.options)).rejects.toThrow('signature');
  await expect(verifyDelivery(f.raw(f.header, undefined, false), f.options)).rejects.toThrow('signature');
  await expect(verifyDelivery(f.raw({ ...f.header, alg: 'unknown' }), f.options)).rejects.toThrow();
});
it.each(['duplicate-key', 'field-order', 'escape', 'whitespace', 'utf8', 'base64-padding'] as const)('rejects signed noncanonical %s representations', async (kind) => {
  const f = fixture(); let text = canonicalJson(f.claims);
  if (kind === 'duplicate-key') text = text.replace('{', '{"aud":"wrong",');
  if (kind === 'field-order') text = JSON.stringify(f.claims);
  if (kind === 'escape') text = text.replace('é', '\\u00e9');
  if (kind === 'whitespace') text = ' ' + text;
  let encoded = Buffer.from(text).toString('base64url');
  if (kind === 'utf8') encoded = Buffer.concat([Buffer.from([0xff]), Buffer.from(text)]).toString('base64url');
  if (kind === 'base64-padding') encoded += '=';
  await expect(verifyDelivery(f.raw(f.header, encoded), f.options)).rejects.toThrow();
  expect(f.options.claimRequest).not.toHaveBeenCalled();
});
it('canonical object reordering produces identical bytes; Unicode normalization changes invalidate signatures', async () => {
  const f = fixture(), token = f.raw(f.header);
  expect(encode({ ...f.claims, envelope: Object.fromEntries(Object.entries(f.envelope).reverse()) })).toBe(encode(f.claims));
  await expect(verifyDelivery(token, f.options)).resolves.toEqual(f.envelope);
  f.claims.envelope.payload.body = f.claims.envelope.payload.body.normalize('NFC');
  const parts = token.split('.'); parts[1] = encode(f.claims);
  await expect(verifyDelivery(parts.join('.'), f.options)).rejects.toThrow('signature');
});
it('retired historical keys verify both formats while revoked or unknown keys deny', async () => {
  const f = fixture(), tokens = [f.raw(f.header), f.raw({ alg: 'EdDSA', typ: 'relay-federation+jwt', kid: f.key.keyId }, undefined, false)];
  for (const state of ['RETIRED', 'DISABLED', 'REVOKED'] as const) {
    const ring = new SigningKeyring([{ ...f.key, state, ...(state === 'REVOKED' ? { revokedAt: new Date().toISOString() } : {}) }], { sign: vi.fn() });
    const options = { ...f.options, trustedPublicKey: async (id: string) => ring.verificationKey(id, 'federation-delivery')?.publicKeyPem };
    for (const token of tokens) {
      if (state === 'REVOKED') await expect(verifyDelivery(token, options)).rejects.toThrow('signature');
      else await expect(verifyDelivery(token, options)).resolves.toEqual(f.envelope);
    }
  }
});
it.each(['metadata-version', 'response-version', 'crc', 'algorithm', 'wrong-public-key'])('fails closed on KMS %s substitution', async (kind) => {
  const f = fixture();
  const request = vi.fn(async (_url, init) => {
    if (init?.method !== 'POST') return Response.json({ name: kind === 'metadata-version' ? f.key.keyVersion + '2' : f.key.keyVersion, algorithm: kind === 'algorithm' ? 'EC_SIGN_P256_SHA256' : 'EC_SIGN_ED25519', state: 'ENABLED', protectionLevel: 'SOFTWARE' });
    const data = Buffer.from(JSON.parse(String(init.body)).data, 'base64');
    const signature = sign(null, data, kind === 'wrong-public-key' ? generateKeyPairSync('ed25519').privateKey : f.pair.privateKey);
    return Response.json({ name: kind === 'response-version' ? f.key.keyVersion + '2' : f.key.keyVersion, signature: signature.toString('base64'), signatureCrc32c: String(crc32c(signature)), verifiedDataCrc32c: kind !== 'crc', protectionLevel: 'SOFTWARE' });
  }) as unknown as typeof fetch;
  const ring = new SigningKeyring([f.key], new GoogleKmsEd25519Provider(new Set([f.key.keyVersion]), async () => 'synthetic-token', request));
  await expect(ring.signer('federation-delivery').sign(deliverySignatureInput('synthetic'))).rejects.toThrow('unavailable');
});
