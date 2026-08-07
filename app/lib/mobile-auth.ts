import { createHash, randomBytes } from "node:crypto";

export const MOBILE_AUTH_SCHEME = "phototree";
export const MOBILE_AUTH_TTL_MS = 2 * 60 * 1000;
export const MOBILE_AUTH_COOKIE = "photoTreeMobileAuth";
export const MOBILE_AUTH_COOKIE_MAX_AGE = 10 * 60;

export function createMobileAuthToken() {
  return randomBytes(32).toString("base64url");
}

export function hashMobileAuthToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function sanitizeMobileTarget(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/family-tree-manual";
  }
  return value;
}

export function getNextAuthCookieName() {
  const url = process.env.NEXTAUTH_URL;
  const secure = url ? url.startsWith("https://") : process.env.NODE_ENV === "production";
  return secure ? "__Secure-next-auth.session-token" : "next-auth.session-token";
}

export function getNextAuthCookieSecure() {
  const url = process.env.NEXTAUTH_URL;
  return url ? url.startsWith("https://") : process.env.NODE_ENV === "production";
}
