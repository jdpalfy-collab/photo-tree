import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import {
  decodeStoredManualLayout,
  encodeStoredManualLayout,
  isCollapsedManualLayout,
  parseManualLayoutSnapshot,
  serializeManualLayoutSnapshot,
} from "@/app/lib/manual-layout-storage";

const DEFAULT_ID = "default";
const LOCK_ID = "global";

function noStoreJson(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return NextResponse.json(body, { ...init, headers });
}

function conflictResponse(row: { id: string; data: string; updatedAt: Date }) {
  const stored = decodeStoredManualLayout(row.data);
  return noStoreJson(
    {
      ok: false,
      error: "layout_conflict",
      data: stored ? serializeManualLayoutSnapshot(stored.current) : null,
      layout: {
        id: row.id,
        revision: stored?.revision ?? null,
        updatedAt: row.updatedAt.toISOString(),
      },
    },
    { status: 409 }
  );
}

export async function GET() {
  try {
    const row = await prisma.manualLayout.findUnique({ where: { id: DEFAULT_ID } });
    if (!row) return noStoreJson({ ok: true, data: null, layout: null });

    const stored = decodeStoredManualLayout(row.data);
    if (!stored) {
      return noStoreJson({ ok: false, error: "Stored tree layout is invalid." }, { status: 500 });
    }

    return noStoreJson({
      ok: true,
      data: serializeManualLayoutSnapshot(stored.current),
      layout: {
        id: row.id,
        revision: stored.revision,
        updatedAt: row.updatedAt.toISOString(),
        recoverySnapshots: stored.history.length,
      },
    });
  } catch (error: unknown) {
    return noStoreJson(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const editorId = typeof body?.editorId === "string" ? body.editorId.trim() : "";
    const data = typeof body?.data === "string" ? body.data : "";
    const baseUpdatedAt = typeof body?.baseUpdatedAt === "string" ? body.baseUpdatedAt : null;
    const baseRevision = Number.isInteger(body?.baseRevision) ? Number(body.baseRevision) : null;

    if (editorId.length < 8 || editorId.length > 128) {
      return noStoreJson({ ok: false, error: "An active editing lease is required." }, { status: 423 });
    }
    if (!data) return noStoreJson({ ok: false, error: "data is required" }, { status: 400 });

    let rawSnapshot: unknown;
    try {
      rawSnapshot = JSON.parse(data);
    } catch {
      return noStoreJson({ ok: false, error: "Tree layout must be valid JSON." }, { status: 400 });
    }
    const snapshot = parseManualLayoutSnapshot(rawSnapshot);
    if (!snapshot) {
      return noStoreJson({ ok: false, error: "Tree layout is incomplete or malformed." }, { status: 422 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const lock = await tx.editLock.findUnique({ where: { id: LOCK_ID } });
      if (!lock || !lock.expiresAt || lock.expiresAt <= now || lock.holderEmail !== editorId) {
        return { kind: "lock_lost" as const };
      }

      const people = await tx.person.findMany({ select: { id: true } });
      const personIds = people.map((person) => person.id);
      const missingPersonIds = personIds.filter((id) => !snapshot.positions[id]);
      if (missingPersonIds.length > 0) {
        return { kind: "incomplete" as const, missingCount: missingPersonIds.length };
      }
      if (isCollapsedManualLayout(snapshot, personIds)) {
        return { kind: "collapsed" as const };
      }

      const current = await tx.manualLayout.findUnique({ where: { id: DEFAULT_ID } });
      if (!current) {
        const encoded = encodeStoredManualLayout(snapshot, null);
        const created = await tx.manualLayout.create({
          data: { id: DEFAULT_ID, data: encoded.data },
          select: { id: true, updatedAt: true },
        });
        return { kind: "saved" as const, row: created, revision: encoded.revision };
      }

      const stored = decodeStoredManualLayout(current.data);
      if (!stored) return { kind: "invalid_current" as const };
      const currentUpdatedAt = current.updatedAt.toISOString();
      if (
        !baseUpdatedAt ||
        baseUpdatedAt !== currentUpdatedAt ||
        (baseRevision !== null && baseRevision !== stored.revision)
      ) {
        return { kind: "conflict" as const, row: current };
      }

      const encoded = encodeStoredManualLayout(snapshot, stored, currentUpdatedAt);
      const updated = await tx.manualLayout.updateMany({
        where: { id: DEFAULT_ID, updatedAt: current.updatedAt },
        data: { data: encoded.data },
      });
      if (updated.count !== 1) {
        const latest = await tx.manualLayout.findUnique({ where: { id: DEFAULT_ID } });
        return latest
          ? { kind: "conflict" as const, row: latest }
          : { kind: "invalid_current" as const };
      }
      const saved = await tx.manualLayout.findUniqueOrThrow({
        where: { id: DEFAULT_ID },
        select: { id: true, updatedAt: true },
      });
      return { kind: "saved" as const, row: saved, revision: encoded.revision };
    });

    if (result.kind === "lock_lost") {
      return noStoreJson(
        { ok: false, error: "Editing lease expired. The latest tree must be reloaded." },
        { status: 423 }
      );
    }
    if (result.kind === "incomplete") {
      return noStoreJson(
        {
          ok: false,
          error: `Tree layout is missing ${result.missingCount} person card${result.missingCount === 1 ? "" : "s"}.`,
        },
        { status: 422 }
      );
    }
    if (result.kind === "collapsed") {
      return noStoreJson(
        { ok: false, error: "Collapsed tree layout rejected to protect the saved tree." },
        { status: 422 }
      );
    }
    if (result.kind === "invalid_current") {
      return noStoreJson({ ok: false, error: "Stored tree layout is invalid." }, { status: 500 });
    }
    if (result.kind === "conflict") return conflictResponse(result.row);

    return noStoreJson({
      ok: true,
      layout: {
        id: result.row.id,
        revision: result.revision,
        updatedAt: result.row.updatedAt.toISOString(),
      },
    });
  } catch (error: unknown) {
    const code =
      error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
    if (code === "P2002") {
      const current = await prisma.manualLayout.findUnique({ where: { id: DEFAULT_ID } });
      if (current) return conflictResponse(current);
    }
    return noStoreJson(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
