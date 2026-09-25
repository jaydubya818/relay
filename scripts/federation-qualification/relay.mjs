// Qualification-only HTTPS host for the unmodified production REST and MCP routes.
// This proves their protocol behavior, not a Next.js production deployment.
import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';
import { createHash, privateDecrypt, publicEncrypt, sign, verify } from 'node:crypto';
import imported331 from '../../lib/v2/platform-bindings.ts';
const { configureV2PlatformBindings } = imported331;
import imported412 from '../../app/api/v2/federation/route.ts';
const { POST: rest } = imported412;
import imported481 from '../../app/api/v2/federation/mcp/route.ts';
const { POST: mcp } = imported481;
const config = JSON.parse(readFileSync(process.env.QUALIFICATION_CONFIG, 'utf8'));
Object.assign(process.env, config.environment);
const signer = {
  keyId: 'qualification-relay',
  async sign(value) { return sign(null, Buffer.from(value), config.signPrivate).toString('base64url'); },
  async verify(value, signature) { return verify(null, Buffer.from(value), config.signPublic, Buffer.from(signature, 'base64url')); },
  async publicKeyPem() { return config.signPublic; },
};
configureV2PlatformBindings({ signer, keyResolver: { publicKeyForKeyId: async () => config.signPublic }, federation: {
  issuer: config.issuer,
  keyWrapper: { keyId: 'qualification-wrap',
    async wrap(owner, key) { return publicEncrypt({ key: config.wrapPublic, oaepHash: 'sha256', oaepLabel: createHash('sha256').update(owner).digest() }, key).toString('base64url'); },
    async unwrap(owner, key) { return privateDecrypt({ key: config.wrapPrivate, oaepHash: 'sha256', oaepLabel: createHash('sha256').update(owner).digest() }, Buffer.from(key, 'base64url')); },
  },
} });
createServer({ key: readFileSync(config.tlsKey), cert: readFileSync(config.tlsCert) }, async (incoming, outgoing) => {
  if (incoming.url === '/health') { outgoing.end('ready'); return; }
  if (!['/api/v2/federation', '/api/v2/federation/mcp'].includes(incoming.url)) { outgoing.writeHead(404).end(); return; }
  try {
    const request = new Request(`${config.issuer}${incoming.url}`, { method: incoming.method, headers: incoming.headers, body: incoming, duplex: 'half' });
    const response = await (incoming.url.endsWith('/mcp') ? mcp : rest)(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(500).end('{"error":"host failure"}'); }
}).listen(config.port, '0.0.0.0', () => console.log('qualification Relay HTTPS ready'));
