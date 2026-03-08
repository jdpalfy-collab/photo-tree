import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";

const LOCK_ID = "global";
const TTL_MS = 10 * 60 * 1000;

function isExpired(expiresAt?: Date | null) {
  if (!expiresAt) return true;
  return expiresAt.getTime() <= Date.now();
}

export async function GET() {
  try {
    const lock = await prisma.editLock.findUnique({ where: { id: LOCK_ID } });
    if (!lock || isExpired(lock.expiresAt)) {
      return NextResponse.json({ ok: true, lock: null });
    }
    return NextResponse.json({
      ok: true,
      lock: {
        holderEmail: lock.holderEmail,
        holderName: lock.holderName,
        expiresAt: lock.expiresAt,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const email = (token.email as string | undefined) || "";
    const name = (token.name as string | undefined) || "";

    const existing = await prisma.editLock.findUnique({ where: { id: LOCK_ID } });
    if (existing && !isExpired(existing.expiresAt) && existing.holderEmail && existing.holderEmail !== email) {
      return NextResponse.json(
        {
          ok: false,
          error: "Locked",
          lock: {
            holderEmail: existing.holderEmail,
            holderName: existing.holderName,
            expiresAt: existing.expiresAt,
          },
        },
        { status: 409 }
      );
    }

    const expiresAt = new Date(Date.now() + TTL_MS);
    const lock = await prisma.editLock.upsert({
      where: { id: LOCK_ID },
      create: { id: LOCK_ID, holderEmail: email, holderName: name, expiresAt },
      update: { holderEmail: email, holderName: name, expiresAt },
      select: { holderEmail: true, holderName: true, expiresAt: true },
    });

    return NextResponse.json({ ok: true, lock });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const email = (token.email as string | undefined) || "";
    const existing = await prisma.editLock.findUnique({ where: { id: LOCK_ID } });
    if (existing && existing.holderEmail && existing.holderEmail !== email) {
      return NextResponse.json({ ok: false, error: "Locked by another user" }, { status: 409 });
    }
    await prisma.editLock.delete({ where: { id: LOCK_ID } }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
