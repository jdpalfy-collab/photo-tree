export const FAMILY_ACCESS_COOKIE = "photoTreeFamilyAccess";
export const FAMILY_ACCESS_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const encoder = new TextEncoder();

export function familyAccessRequired() {
  return Boolean(familyAccessCode());
}

export async function familyAccessCodeMatches(code: string) {
  const expected = familyAccessCode();
  if (!expected) return true;
  return normalizeCode(code) === normalizeCode(expected);
}

export async function createFamilyAccessCookieValue() {
  const payload = `v1.${Math.floor(Date.now() / 1000)}`;
  return `${payload}.${await sign(payload)}`;
}

export async function verifyFamilyAccessCookie(value?: string | null) {
  if (!familyAccessRequired()) return true;
  if (!value) return false;

  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;

  const payload = `${parts[0]}.${parts[1]}`;
  try {
    const expected = await sign(payload);
    return parts[2] === expected;
  } catch {
    return false;
  }
}

function familyAccessCode() {
  return process.env.PHOTOTREE_FAMILY_CODE?.trim() || "";
}

function normalizeCode(code: string) {
  return code.trim().replace(/\s+/g, "").toLowerCase();
}

async function sign(payload: string) {
  const secret =
    process.env.PHOTOTREE_ACCESS_COOKIE_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    "";
  if (!secret) {
    throw new Error("Missing NEXTAUTH_SECRET for family access cookie signing.");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return base64Url(signature);
}

function base64Url(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
