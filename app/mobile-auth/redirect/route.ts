import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { prisma } from "@/app/lib/prisma";
import {
  createMobileAuthToken,
  getNextAuthCookieSecure,
  hashMobileAuthToken,
  MOBILE_AUTH_COOKIE,
  MOBILE_AUTH_SCHEME,
  MOBILE_AUTH_TTL_MS,
  sanitizeMobileTarget,
} from "@/app/lib/mobile-auth";

export async function GET(req: NextRequest) {
  const targetPath = sanitizeMobileTarget(req.nextUrl.searchParams.get("target"));
  const rawSessionToken = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
    raw: true,
  });

  if (!rawSessionToken) {
    const retryCount = Number(req.nextUrl.searchParams.get("retry") || "0");
    const retryUrl =
      retryCount < 1
        ? new URL("/mobile-auth/start", req.url)
        : new URL("/", req.url);
    retryUrl.searchParams.set("target", targetPath);
    if (retryCount < 1) {
      retryUrl.searchParams.set("retry", String(retryCount + 1));
    } else {
      retryUrl.searchParams.set("from", "mobile-auth");
    }
    const response = NextResponse.redirect(retryUrl);
    response.cookies.set({
      name: MOBILE_AUTH_COOKIE,
      value: targetPath,
      sameSite: "lax",
      secure: getNextAuthCookieSecure(),
      path: "/",
      maxAge: 10 * 60,
    });
    return response;
  }

  const handoffToken = createMobileAuthToken();
  const expiresAt = new Date(Date.now() + MOBILE_AUTH_TTL_MS);

  await prisma.mobileAuthHandoff.create({
    data: {
      tokenHash: hashMobileAuthToken(handoffToken),
      sessionToken: rawSessionToken,
      targetPath,
      expiresAt,
    },
  });

  await prisma.mobileAuthHandoff.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date() } }, { usedAt: { not: null } }],
    },
  });

  const appUrl = `${MOBILE_AUTH_SCHEME}://auth?token=${encodeURIComponent(
    handoffToken
  )}&target=${encodeURIComponent(targetPath)}`;

  const response = new NextResponse(
    `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Return to PhotoTree</title>
  </head>
  <body style="font-family: system-ui, sans-serif; padding: 32px; text-align: center;">
    <p>Returning to PhotoTree...</p>
    <p><a href="${appUrl}">Open PhotoTree</a></p>
    <script>window.location.replace(${JSON.stringify(appUrl)});</script>
  </body>
</html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    }
  );
  response.cookies.set({
    name: MOBILE_AUTH_COOKIE,
    value: "",
    path: "/",
    maxAge: 0,
  });

  return response;
}
