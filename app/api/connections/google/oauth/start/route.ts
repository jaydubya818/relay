import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { beginGoogleOAuth } from "@/lib/connectors/google-oauth";

export async function GET(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return NextResponse.redirect(new URL("/login", request.url));
    return NextResponse.redirect(await beginGoogleOAuth(user, new URL(request.url).origin));
  } catch (error) { return errorResponse(error); }
}
