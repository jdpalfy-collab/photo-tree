import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import {
  FAMILY_ACCESS_COOKIE,
  familyAccessRequired,
  verifyFamilyAccessCookie,
} from "@/app/lib/family-access";

const PUBLIC_FILE = /\.(.*)$/;
const NATIVE_USER_AGENT = "PhotoTreeNative/";
const IOS_ONLY_ACCESS_ENABLED = process.env.IOS_ONLY_ACCESS_ENABLED === "true";

function iosOnlyResponse(pathname: string) {
  if (pathname.startsWith("/api")) {
    return NextResponse.json(
      { ok: false, error: "PhotoTree is available only in the iOS app." },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }

  return new NextResponse(
    `<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>PhotoTree for iOS</title>
          <style>
            body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f8fbff; color: #0b1f3a; font: 600 18px system-ui, sans-serif; text-align: center; }
            main { max-width: 420px; padding: 32px; }
            h1 { margin: 0 0 12px; font-size: 30px; }
            p { margin: 0; color: #475569; line-height: 1.5; }
          </style>
        </head>
        <body><main><h1>PhotoTree</h1><p>PhotoTree is available only in the iOS app.</p></main></body>
      </html>`,
    {
      status: 403,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    }
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isNativeApp = req.headers.get("user-agent")?.includes(NATIVE_USER_AGENT) ?? false;
  const hasNativeGuestAccess =
    req.cookies.get("photoTreeGuestAccess")?.value === "1" &&
    (isNativeApp || process.env.NODE_ENV !== "production");
  const isMobileAuth = pathname.startsWith("/mobile-auth") || pathname.startsWith("/api/auth");
  const isFamilyAccess = pathname.startsWith("/api/family-access");
  const isPublicInfoPage = pathname === "/privacy" || pathname === "/support";
  const isFrameworkAsset =
    pathname.startsWith("/_next") || pathname.startsWith("/favicon.ico") || PUBLIC_FILE.test(pathname);

  if (
    process.env.NODE_ENV === "production" &&
    IOS_ONLY_ACCESS_ENABLED &&
    !isNativeApp &&
    !isMobileAuth &&
    !isFamilyAccess &&
    !isPublicInfoPage &&
    !isFrameworkAsset
  ) {
    return iosOnlyResponse(pathname);
  }

  if (
    pathname === "/" ||
    isMobileAuth ||
    isFamilyAccess ||
    isPublicInfoPage ||
    isFrameworkAsset
  ) {
    return NextResponse.next();
  }

  if (familyAccessRequired()) {
    const hasFamilyAccess = await verifyFamilyAccessCookie(req.cookies.get(FAMILY_ACCESS_COOKIE)?.value);
    if (!hasFamilyAccess) {
      if (pathname.startsWith("/api")) {
        return NextResponse.json(
          { ok: false, error: "Family invite code required." },
          { status: 401, headers: { "Cache-Control": "no-store" } }
        );
      }
      const url = req.nextUrl.clone();
      url.pathname = "/";
      url.searchParams.set("from", "invite");
      return NextResponse.redirect(url);
    }
  }

  if (hasNativeGuestAccess) {
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("from", "unauth");
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
