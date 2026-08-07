import { NextRequest, NextResponse } from "next/server";
import {
  FAMILY_ACCESS_COOKIE,
  FAMILY_ACCESS_MAX_AGE_SECONDS,
  createFamilyAccessCookieValue,
  familyAccessCodeMatches,
  familyAccessRequired,
  verifyFamilyAccessCookie,
} from "@/app/lib/family-access";

export async function GET(req: NextRequest) {
  const required = familyAccessRequired();
  const unlocked = await verifyFamilyAccessCookie(req.cookies.get(FAMILY_ACCESS_COOKIE)?.value);

  return NextResponse.json(
    { ok: true, required, unlocked },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: NextRequest) {
  if (!familyAccessRequired()) {
    return NextResponse.json({ ok: true, required: false, unlocked: true });
  }

  const body = await req.json().catch(() => ({}));
  const code = typeof body?.code === "string" ? body.code : "";

  if (!(await familyAccessCodeMatches(code))) {
    return NextResponse.json(
      { ok: false, error: "That invite code was not recognized." },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const response = NextResponse.json(
    { ok: true, required: true, unlocked: true },
    { headers: { "Cache-Control": "no-store" } }
  );
  response.cookies.set(FAMILY_ACCESS_COOKIE, await createFamilyAccessCookieValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: FAMILY_ACCESS_MAX_AGE_SECONDS,
  });
  return response;
}
