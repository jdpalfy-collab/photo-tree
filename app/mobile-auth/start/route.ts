import { NextRequest, NextResponse } from "next/server";
import {
  getNextAuthCookieSecure,
  MOBILE_AUTH_COOKIE,
  MOBILE_AUTH_COOKIE_MAX_AGE,
  sanitizeMobileTarget,
} from "@/app/lib/mobile-auth";

export async function GET(req: NextRequest) {
  const targetPath = sanitizeMobileTarget(req.nextUrl.searchParams.get("target"));
  const callbackUrl = new URL("/mobile-auth/redirect", req.url);
  callbackUrl.searchParams.set("target", targetPath);
  const retry = req.nextUrl.searchParams.get("retry");
  if (retry) {
    callbackUrl.searchParams.set("retry", retry);
  }

  const response = new NextResponse(
    `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Signing in to PhotoTree</title>
  </head>
  <body style="font-family: system-ui, sans-serif; padding: 32px; text-align: center;">
    <p>Opening Google sign-in...</p>
    <form id="google-signin" method="post" action="/api/auth/signin/google">
      <input type="hidden" name="callbackUrl" value="${escapeHtml(callbackUrl.toString())}" />
      <input id="csrf-token" type="hidden" name="csrfToken" value="" />
      <button type="submit">Continue with Google</button>
    </form>
    <script>
      (async function () {
        const csrf = await fetch("/api/auth/csrf").then(function (res) { return res.json(); });
        document.getElementById("csrf-token").value = csrf.csrfToken || "";
        document.getElementById("google-signin").submit();
      })();
    </script>
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
    value: targetPath,
    sameSite: "lax",
    secure: getNextAuthCookieSecure(),
    path: "/",
    maxAge: MOBILE_AUTH_COOKIE_MAX_AGE,
  });

  return response;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
