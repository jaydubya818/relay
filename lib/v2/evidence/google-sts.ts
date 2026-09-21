/** Google STS verifies the assertion signature; these checks additionally pin its
 * deployment identity before any network request. No ADC or private-key path. */
export interface VercelWorkloadIdentity {
  issuer: string;
  audience: string;
  ownerId: string;
  projectId: string;
  environment: string;
  customEnvironmentId: string;
  subject: string;
  provider: string;
}
export function vercelStsTokenSource(identity: VercelWorkloadIdentity, assertion: () => Promise<string>, request: typeof fetch = fetch, clock = Date.now) {
  if (!/^https:\/\/oidc\.vercel\.com\/[a-z0-9-]+$/.test(identity.issuer) ||
      identity.audience !== identity.issuer.replace('oidc.vercel.com', 'vercel.com') ||
      !identity.ownerId.startsWith('team_') || !identity.projectId.startsWith('prj_') ||
      identity.environment !== 'federation-qualification' || !identity.customEnvironmentId.startsWith('env_') ||
      !identity.subject || !/^\/\/iam.googleapis.com\/projects\/[0-9]+\/locations\/global\/workloadIdentityPools\/[a-z0-9-]+\/providers\/[a-z0-9-]+$/.test(identity.provider)) {
    throw new Error('Qualification workload identity is invalid.');
  }
  // Deliberately no module-global token cache: obtain the assertion in the
  // current request context, including on each KMS invocation after rotation.
  return async (): Promise<string> => {
    try {
      const jwt = await assertion();
      if (jwt.length > 16384 || jwt.split('.').length !== 3) throw new Error();
      const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()) as Record<string, unknown>;
      const now = Math.floor(clock() / 1000);
      if (claims.iss !== identity.issuer || claims.aud !== identity.audience ||
          claims.owner_id !== identity.ownerId || claims.project_id !== identity.projectId ||
          claims.environment !== identity.environment || claims.custom_environment_id !== identity.customEnvironmentId ||
          claims.sub !== identity.subject || !Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.iat) ||
          Number(claims.exp) <= now + 30 || Number(claims.iat) > now + 5 || Number(claims.iat) >= Number(claims.exp) ||
          (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || Number(claims.nbf) > now))) throw new Error();
      const response = await request('https://sts.googleapis.com/v1/token', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({grantType:'urn:ietf:params:oauth:grant-type:token-exchange', audience:identity.provider,
          scope:'https://www.googleapis.com/auth/cloud-platform', requestedTokenType:'urn:ietf:params:oauth:token-type:access_token',
          subjectTokenType:'urn:ietf:params:oauth:token-type:jwt', subjectToken:jwt}),
      });
      if (!response.ok) throw new Error();
      const result = await response.json() as Record<string, unknown>;
      if (result.token_type !== 'Bearer' || result.issued_token_type !== 'urn:ietf:params:oauth:token-type:access_token' ||
          !Number.isSafeInteger(result.expires_in) || Number(result.expires_in) < 30 || Number(result.expires_in) > 3600 ||
          typeof result.access_token !== 'string' || !result.access_token || /\s/.test(result.access_token) ||
          Number(claims.exp) <= Math.floor(clock()/1000)+15) throw new Error();
      return result.access_token;
    } catch { throw new Error('Qualification workload identity exchange is unavailable.'); }
  };
}
