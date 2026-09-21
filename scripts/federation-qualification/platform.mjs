// Generic disposable Agent platform. No MyEve code, runtime, or storage.
import { createServer } from 'node:https';
import { readFileSync, writeFileSync, renameSync, existsSync, appendFileSync, unlinkSync } from 'node:fs';
import { createHash, sign, verify, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { verifyDelivery, answerPublishedQuery } from './adapter.mjs';
const config = JSON.parse(readFileSync('/config/platform.json', 'utf8'));
const statePath = '/state/ledger.json';
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { claims: {}, received: 0, executions: 0, privateReads: 0, reads: [], syntheses: [], refusals: [], artifacts: {}, boots: 0 };
function persist() { writeFileSync(`${statePath}.new`, JSON.stringify(state)); renameSync(`${statePath}.new`, statePath); }
state.boots++; persist();
if (existsSync('/state/private-monitor-ready')) unlinkSync('/state/private-monitor-ready');
const privateMonitor = spawn('python3', ['-u', '/app/watch-private.py'], { stdio: ['ignore', 'ignore', 'inherit'] });
// Readiness carries a PID so a stale ready file cannot hide a failed restart.
for (let n = 0; n < 100; n++) {
  if (existsSync('/state/private-monitor-ready') && readFileSync('/state/private-monitor-ready', 'utf8') === String(privateMonitor.pid)) break;
  if (privateMonitor.exitCode !== null || n === 99) throw Error('Private-store monitor unavailable');
  await new Promise((done) => setTimeout(done, 20));
}
function readStore(path) {
  state.storeAccesses ??= [];
  state.storeAccesses.push({ path, at: new Date().toISOString() });
  if (path.includes('canonical-private')) state.privateReads++;
  persist();
  return readFileSync(path);
}
async function relay(command, mcp = false, credential = config.credential) {
  const response = await fetch(`${config.relay}/api/v2/federation${mcp ? '/mcp' : ''}`, { method: 'POST', headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' }, body: JSON.stringify(command) });
  return { status: response.status, body: await response.json() };
}
function jwt(payload) { const material = `${Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`; return `${material}.${sign(null, Buffer.from(material), config.artifactPrivate).toString('base64url')}`; }
function checkJwt(token, key) {
  const [header, payload, signature] = token.split('.');
  if (JSON.parse(Buffer.from(header, 'base64url')).alg !== 'EdDSA' || !verify(null, Buffer.from(`${header}.${payload}`), key, Buffer.from(signature, 'base64url'))) throw Error('Bad signature');
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  if (claims.exp <= Date.now() / 1000) throw Error('Expired');
  return claims;
}
async function accept(token, crashAfterPersist = false) {
  state.received++; persist();
  let duplicate;
  const envelope = await verifyDelivery(token, { issuer: config.issuer, audience: config.address,
    trustedPublicKey: async (kid) => kid === 'qualification-relay' ? config.relayPublic : undefined,
    claimRequest: async (requestId, expiresAt) => { duplicate = state.claims[requestId]; if (!duplicate) { state.claims[requestId] = { expiresAt, phase: 'claimed' }; persist(); } return true; },
  });
  // The signature is always checked before using a persisted receipt. A completed
  // claim never executes twice. Incomplete claims fail closed for manual recovery.
  if (duplicate && !duplicate.response) return { replay: true, blockedIncomplete: true };
  const entry = state.claims[envelope.id];
  if (!duplicate) {
    const payload = envelope.payload;
    if (envelope.capability === 'work.request' && (state.denyWork || payload.task !== 'Review this federation architecture and return a short analysis.')) {
      entry.response = { status: 'REJECTED' }; state.refusals.push({ requestId: envelope.id, reason: state.denyWork ? 'LOCAL_WORK_DISABLED' : 'LOCAL_TASK_NOT_ALLOWED' });
    } else {
      state.executions++;
      let result;
      if (envelope.capability === 'knowledge.query') {
        result = await answerPublishedQuery(envelope, { readPublished: async (input) => {
          // Only the separately materialized publication projection is reachable.
          // Canonical private files are not opened by this request path.
          const projection = JSON.parse(readStore('/state/projection.json').toString());
          if (projection.viewId !== input.viewId || projection.version !== input.version) throw Error('Local publication mismatch');
          state.reads.push({ requestId: envelope.id, store: 'published-projection', ...input }); persist();
          return projection.records.find((r) => r.reference === input.reference && r.revision === input.revision);
        } }, async ({ records }) => { state.syntheses.push({ requestId: envelope.id, references: records.map((r) => r.reference) }); return records.map((r) => `${r.content} [${r.reference}]`).join(' '); });
      } else if (envelope.capability === 'artifact.share') {
        const proof = jwt({ iss: config.address, aud: payload.retrieval.url, exp: Math.floor(Date.now() / 1000) + 30 });
        const response = await fetch(payload.retrieval.url, { headers: { authorization: `Bearer ${proof}` } });
        if (!response.ok) throw Error('Source artifact refused');
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length !== payload.size || `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== payload.checksum) throw Error('Artifact integrity');
        writeFileSync(`/state/artifact-${envelope.id}.txt`, bytes);
        state.artifacts[envelope.id] = { reference: payload.reference, checksum: payload.checksum, source: envelope.caller };
        result = { acknowledged: true };
      } else if (envelope.capability === 'work.request') {
        if (!payload.context.length || !payload.context.every((id) => state.artifacts[id])) throw Error('Missing locally authorized work context');
        const startedAt = performance.now();
        const context = payload.context.map((id) => readStore(`/state/artifact-${id}.txt`).toString()).join('\n');
        const checks = ['separate stores', 'signed delivery', 'local authorization'].map((term) => `${term}: ${context.includes(term) ? 'present' : 'missing'}`);
        const runId = `local-run-${randomUUID()}`;
        writeFileSync(`/state/${runId}.json`, JSON.stringify({ requestId: envelope.id, checks }));
        result = { summary: checks.join('; '), artifacts: [runId], evidence: payload.context, cost: '0', runtimeSeconds: (performance.now() - startedAt) / 1000, modelSteps: 0, providerReceipts: [] };
      } else result = { acknowledged: true };
      entry.response = { status: 'COMPLETED', result };
    }
    entry.phase = 'executed'; persist();
  }
  if (crashAfterPersist) { process.exit(42); }
  if (entry.response.status === 'COMPLETED') {
    const accepted = await relay({ operation: 'respond', requestId: envelope.id, input: { status: 'ACCEPTED' } });
    if (accepted.status !== 200) return { replay: Boolean(duplicate), accepted };
  }
  const response = await relay({ operation: 'respond', requestId: envelope.id, input: entry.response });
  entry.phase = response.status === 200 ? 'acknowledged' : 'executed'; persist();
  return { requestId: envelope.id, replay: Boolean(duplicate), response };
}
async function command(input) {
  if (input.operation === 'command') return relay(input.command, input.mcp, input.credential);
  if (input.operation === 'poll') {
    const response = await relay({ operation: 'poll' });
    if (response.status !== 200) return response;
    if (input.capture) return response;
    const results = [];
    for (const delivery of response.body.deliveries) results.push(await accept(delivery.token, input.crashAfterPersist));
    return { ...response, results };
  }
  if (input.operation === 'deliver') return accept(input.token);
  if (input.operation === 'inspect') return { ...state, privateMonitor: { running: privateMonitor.exitCode === null, events: existsSync('/state/private-access.log') ? readFileSync('/state/private-access.log', 'utf8').trim().split('\n').filter(Boolean) : [] } };
  if (input.operation === 'denyWork') { state.denyWork = input.value; persist(); return { saved: true }; }
  if (input.operation === 'projection') {
    // Owner-controlled local publication, not a Relay command.
    writeFileSync('/state/projection.json', JSON.stringify(input.projection)); return { saved: true };
  }
  if (input.operation === 'rotate') { config.credential = input.credential; return { saved: true }; }
  if (input.operation === 'artifact') {
    const bytes = readStore('/state/source-artifact.txt');
    const expiresAt = new Date(Date.now() + (input.seconds ?? 120) * 1000).toISOString();
    const token = jwt({ iss: config.address, aud: config.peerAddress, sub: 'architecture', exp: Math.floor(Date.parse(expiresAt) / 1000) });
    return { reference: 'architecture', name: 'Federation architecture', type: 'text/plain', size: bytes.length, checksum: `sha256:${createHash('sha256').update(bytes).digest('hex')}`, visibility: 'SHARED', expiresAt, retrieval: { url: `${config.external}/artifact?token=${token}`, audience: config.peerAddress, expiresAt } };
  }
  if (input.operation === 'fetchArtifact') {
    const headers = input.authenticate ? { authorization: `Bearer ${jwt({ iss: config.address, aud: input.url, exp: Math.floor(Date.now() / 1000) + 30 })}` } : {};
    const response = await fetch(input.url, { headers }); return { status: response.status };
  }
  throw Error('Unknown control operation');
}
let serial = Promise.resolve();
createServer({ key: readFileSync('/config/tls.key'), cert: readFileSync('/config/tls.crt') }, (request, response) => {
  serial = serial.then(async () => {
    try {
      if (request.url.startsWith('/artifact?')) {
        const url = `${config.external}${request.url}`;
        const claims = checkJwt(new URL(url).searchParams.get('token'), config.artifactPublic);
        const proof = checkJwt((request.headers.authorization ?? '').replace(/^Bearer /, ''), config.peerPublic);
        if (claims.iss !== config.address || claims.aud !== config.peerAddress || claims.sub !== 'architecture' || proof.iss !== claims.aud || proof.aud !== url) throw Error('Wrong artifact audience');
        response.writeHead(200).end(readStore('/state/source-artifact.txt')); return;
      }
      if (request.headers.authorization !== `Bearer ${config.control}`) { response.writeHead(401).end('{}'); return; }
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const result = await command(JSON.parse(Buffer.concat(chunks).toString()));
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(result));
    } catch (error) { appendFileSync('/state/errors.log', `${error.message}\n`); response.writeHead(403).end(JSON.stringify({ error: error.message })); }
  });
}).listen(8443, '0.0.0.0');
