import { z } from "zod";
import { NextResponse } from "next/server";
import { createAccountOwner, createSession, sessionCookieName, sessionMaxAge } from "@/lib/auth";
import { errorResponse, verifySameOrigin } from "@/lib/api";

const schema = z.object({
  accountName: z.string().trim().min(2).max(100),
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(200),
  inviteToken: z.string().max(600).optional(),
});

export async function POST(request: Request) {
  try {
    if (!verifySameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Enter a valid account name, name, email, password, and invitation." }, { status: 400 });
    const user = await createAccountOwner(parsed.data);
    const response = NextResponse.json({ user }, { status: 201 });
    response.cookies.set(sessionCookieName(), await createSession(user), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: sessionMaxAge(),
      path: "/",
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
