import { RelayError } from '@/lib/errors';

/** Every `CAPABILITY_*` reason thrown on remote, in-process, native, fence, and lifecycle paths. */
export const CAPABILITY_FAILURE_CODES = [
  'CAPABILITY_ACK_MISMATCH',
  'CAPABILITY_ACK_SUPERSEDED',
  'CAPABILITY_ACK_TOO_LARGE',
  'CAPABILITY_ADMISSION_SCOPE',
  'CAPABILITY_DELIVERY_UNAVAILABLE',
  'CAPABILITY_DESTINATION_LIMIT',
  'CAPABILITY_ENROLLMENT_CHANGED',
  'CAPABILITY_ENROLLMENT_UNAVAILABLE',
  'CAPABILITY_ENDPOINT_UNQUALIFIED',
  'CAPABILITY_FENCE_CONFLICT',
  'CAPABILITY_FENCE_REQUIRED',
  'CAPABILITY_INSTALLATION_UNQUALIFIED',
  'CAPABILITY_LIFECYCLE_FUTURE',
  'CAPABILITY_LIFECYCLE_INVALID',
  'CAPABILITY_LIFECYCLE_SIGNATURE',
  'CAPABILITY_OWNER_POLICY_STALE',
  'CAPABILITY_POLICY_IDENTITY_MISMATCH',
  'CAPABILITY_PROPAGATION_PENDING',
  'CAPABILITY_PROTOCOL_INVALID',
  'CAPABILITY_REFERENCE_EXPIRED',
  'CAPABILITY_SIGNATURE_INVALID',
] as const;

export type CapabilityFailureCode = typeof CAPABILITY_FAILURE_CODES[number];

const known = new Set<string>(CAPABILITY_FAILURE_CODES);

function closed(): RelayError {
  return new RelayError('INTERNAL_ERROR', 'Relay could not complete the request.', undefined, 500);
}

function deny(reason: CapabilityFailureCode): RelayError {
  return new RelayError('CAPABILITY_DENIED', reason, undefined, 403, undefined, reason);
}

function pending(reason: CapabilityFailureCode, retryAfterSeconds: number): RelayError {
  return new RelayError('CAPABILITY_PENDING', reason, undefined, 409, retryAfterSeconds, reason);
}

function unavailable(reason: CapabilityFailureCode, retryAfterSeconds?: number): RelayError {
  return new RelayError('CAPABILITY_UNAVAILABLE', reason, undefined, 503, retryAfterSeconds, reason);
}

export function mapCapabilityFailure(reason: string): RelayError {
  if (!known.has(reason)) {
    if (reason.startsWith('CAPABILITY_')) {
      console.error(JSON.stringify({ level: 'error', event: 'capability_failure_unknown', message: reason }));
    }
    return closed();
  }
  const code = reason as CapabilityFailureCode;
  switch (code) {
    case 'CAPABILITY_ACK_MISMATCH':
    case 'CAPABILITY_ACK_SUPERSEDED':
    case 'CAPABILITY_ACK_TOO_LARGE':
    case 'CAPABILITY_ADMISSION_SCOPE':
    case 'CAPABILITY_ENROLLMENT_CHANGED':
    case 'CAPABILITY_FENCE_CONFLICT':
    case 'CAPABILITY_FENCE_REQUIRED':
    case 'CAPABILITY_LIFECYCLE_FUTURE':
    case 'CAPABILITY_LIFECYCLE_INVALID':
    case 'CAPABILITY_LIFECYCLE_SIGNATURE':
    case 'CAPABILITY_OWNER_POLICY_STALE':
    case 'CAPABILITY_POLICY_IDENTITY_MISMATCH':
    case 'CAPABILITY_PROTOCOL_INVALID':
    case 'CAPABILITY_REFERENCE_EXPIRED':
    case 'CAPABILITY_SIGNATURE_INVALID':
      return deny(code);
    case 'CAPABILITY_PROPAGATION_PENDING':
      return pending(code, 1);
    case 'CAPABILITY_DELIVERY_UNAVAILABLE':
      return unavailable(code, 1);
    case 'CAPABILITY_DESTINATION_LIMIT':
    case 'CAPABILITY_ENROLLMENT_UNAVAILABLE':
    case 'CAPABILITY_ENDPOINT_UNQUALIFIED':
    case 'CAPABILITY_INSTALLATION_UNQUALIFIED':
      return unavailable(code);
    default: {
      const _exhaustive: never = code;
      void _exhaustive;
      return closed();
    }
  }
}

export function asCapabilityRelayError(error: unknown): RelayError | undefined {
  if (error instanceof RelayError) return error;
  if (error instanceof Error && error.message.startsWith('CAPABILITY_')) return mapCapabilityFailure(error.message);
  return undefined;
}
