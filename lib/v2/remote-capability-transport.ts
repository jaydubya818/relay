import { RelayError } from '@/lib/errors';
import type { AuditSigner } from './evidence/crypto';
import type { LeaseKeyResolver } from './leases';

export const REMOTE_CAPABILITY_DEADLINE_MS = 5000;
/** Ports have no database handle: a late crypto result cannot commit a timed-out transaction. */
export async function boundedRemotePort<T>(operation: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation(), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new RelayError('CONNECTION_REQUIRED', 'Remote capability dependency timed out.', undefined, 503)), REMOTE_CAPABILITY_DEADLINE_MS);
    })]);
  } finally { clearTimeout(timer); }
}
export function boundedRemoteSigner(signer: AuditSigner): AuditSigner {
  return { ...signer,
    sign: value => boundedRemotePort(() => signer.sign(value)),
    verify: (value, signature) => boundedRemotePort(() => signer.verify(value, signature)),
    publicKeyPem: () => boundedRemotePort(() => signer.publicKeyPem()),
    ...(signer.forPurpose ? { forPurpose: (purpose: Parameters<NonNullable<AuditSigner['forPurpose']>>[0]) => boundedRemoteSigner(signer.forPurpose!(purpose)) } : {}),
  };
}
export function boundedRemoteResolver(resolver: LeaseKeyResolver): LeaseKeyResolver {
  return { publicKeyForKeyId: key => boundedRemotePort(() => resolver.publicKeyForKeyId(key)),
    ...(resolver.publicKeyForPurpose ? { publicKeyForPurpose: (key: string, purpose: 'lease' | 'session') => boundedRemotePort(() => resolver.publicKeyForPurpose!(key, purpose)) } : {}),
  };
}
export async function readRemoteCapabilityRequest(request: Request) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ') || authorization.length > 20000)
    throw new RelayError('INVALID_CREDENTIAL', 'Runtime Bearer credential required.', undefined, 401);
  if (!request.body) throw new RelayError('INVALID_INPUT', 'Request body required.');
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    await boundedRemotePort(async () => {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.length;
        if (bytes > 65536) throw new RelayError('INVALID_INPUT', 'Remote lease request exceeds size limit.', undefined, 413);
        chunks.push(value);
      }
    });
  } finally { void reader.cancel().catch(() => {}); }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new RelayError('INVALID_INPUT', 'A JSON request body is required.', undefined, 400); }
  return { accountId: request.headers.get('x-relay-account-id') ?? '', credential: authorization.slice(7),
    expectedResource: new URL('/api/v2', request.url).toString(), request: body };
}
