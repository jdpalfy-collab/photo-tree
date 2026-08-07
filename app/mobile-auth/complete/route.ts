import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import {
  getNextAuthCookieName,
  getNextAuthCookieSecure,
  hashMobileAuthToken,
  MOBILE_AUTH_COOKIE,
  sanitizeMobileTarget,
} from "@/app/lib/mobile-auth";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  const tokenHash = hashMobileAuthToken(token);
  const handoff = await prisma.mobileAuthHandoff.findUnique({
    where: { tokenHash },
  });

  if (!handoff || handoff.usedAt || handoff.expiresAt < new Date()) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  await prisma.mobileAuthHandoff.update({
    where: { id: handoff.id },
    data: { usedAt: new Date() },
  });

  const targetPath = sanitizeMobileTarget(handoff.targetPath);
  const response = NextResponse.redirect(new URL(targetPath, req.url));
  response.cookies.set({
    name: getNextAuthCookieName(),
    value: handoff.sessionToken,
    httpOnly: true,
    sameSite: "lax",
    secure: getNextAuthCookieSecure(),
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
  response.cookies.set({
    name: MOBILE_AUTH_COOKIE,
    value: "",
    path: "/",
    maxAge: 0,
  });

  return response;
}
