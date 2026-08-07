import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";

const LOCK_ID = "global";
const TTL_MS = 90 * 1000;

type EditLockRow = {
  holderEmail: string | null;
  holderName: string | null;
  expiresAt: Date | null;
};

function noStoreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return NextResponse.json(body, { ...init, headers });
}

function publicLock(lock: EditLockRow) {
  return {
    holderName: lock.holderName || "Another device",
    expiresAt: lock.expiresAt,
  };
}

function validEditorId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 8 && value.trim().length <= 128;
}

export async function GET() {
  try {
    const lock = await prisma.editLock.findUnique({ where: { id: LOCK_ID } });
    if (!lock || !lock.expiresAt || lock.expiresAt.getTime() <= Date.now()) {
      return noStoreJson({ ok: true, lock: null });
    }
    return noStoreJson({ ok: true, lock: publicLock(lock) });
  } catch (error: unknown) {
    return noStoreJson(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    if (!validEditorId(body?.editorId)) {
      return noStoreJson({ ok: false, error: "editorId is required" }, { status: 400 });
    }
    const editorId = body.editorId.trim();
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    const requestedName = typeof body?.holderName === "string" ? body.holderName.trim() : "";
    const holderName = String(token?.email || token?.name || requestedName || "Another iOS device").slice(0, 120);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TTL_MS);

    // The conditional upsert makes acquisition a single database operation. Two
    // devices cannot both observe an expired lock and then overwrite each other.
    const claimed = await prisma.$queryRaw<EditLockRow[]>`
      INSERT INTO "EditLock" ("id", "holderEmail", "holderName", "expiresAt", "updatedAt")
      VALUES (${LOCK_ID}, ${editorId}, ${holderName}, ${expiresAt}, ${now})
      ON CONFLICT ("id") DO UPDATE
      SET "holderEmail" = ${editorId},
          "holderName" = ${holderName},
          "expiresAt" = ${expiresAt},
          "updatedAt" = ${now}
      WHERE "EditLock"."expiresAt" IS NULL
         OR "EditLock"."expiresAt" <= ${now}
         OR "EditLock"."holderEmail" = ${editorId}
      RETURNING "holderEmail", "holderName", "expiresAt"
    `;

    if (claimed.length === 0) {
      const existing = await prisma.editLock.findUnique({ where: { id: LOCK_ID } });
      return noStoreJson(
        {
          ok: false,
          error: "Locked",
          lock: existing ? publicLock(existing) : null,
        },
        { status: 409 }
      );
    }

    return noStoreJson({ ok: true, lock: publicLock(claimed[0]) });
  } catch (error: unknown) {
    return noStoreJson(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    if (!validEditorId(body?.editorId)) {
      return noStoreJson({ ok: false, error: "editorId is required" }, { status: 400 });
    }
    await prisma.editLock.deleteMany({
      where: { id: LOCK_ID, holderEmail: body.editorId.trim() },
    });
    return noStoreJson({ ok: true });
  } catch (error: unknown) {
    return noStoreJson(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
