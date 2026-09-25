import { NextRequest, NextResponse } from 'next/server';
import { qualificationEnabled, qualifyIngress } from './lib/qualification';
export async function middleware(request: NextRequest) {
  if (!qualificationEnabled()) return NextResponse.next();
  try {
    await qualifyIngress(request, /^\/api\/(?:v2\/(?:operator\/)?federation|auth\/login|agents(?:\/[^/]+\/credentials)?)$/);
    return NextResponse.next();
  } catch { return new NextResponse(null,{status:403}); }
}
export const config = {matcher:['/:path*'],runtime:'nodejs'};
