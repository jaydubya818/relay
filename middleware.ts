import { NextRequest, NextResponse } from 'next/server';
import { qualificationEnabled, qualifyIngress } from './lib/qualification';
export async function middleware(request: NextRequest) {
  // Forward the request pathname so server components can build a returnTo redirect.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-relay-pathname", request.nextUrl.pathname + request.nextUrl.search);
  if (!qualificationEnabled()) return NextResponse.next({ request: { headers: requestHeaders } });
  try {
    await qualifyIngress(request, /^\/api\/(?:v2\/(?:operator\/)?federation|auth\/login|agents(?:\/[^/]+\/credentials)?)$/);
    return NextResponse.next({ request: { headers: requestHeaders } });
  } catch { return new NextResponse(null,{status:403}); }
}
export const config = {matcher:['/:path*'],runtime:'nodejs'};
