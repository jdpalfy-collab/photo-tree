import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export async function GET(_req: NextRequest) {
  try {
    const url = new URL(_req.url);
    const photoId = url.pathname.split("/").filter(Boolean).slice(-2)[0];
    const tags = await prisma.photoTag.findMany({
      where: { photoId },
      include: {
        person: {
          select: { id: true, name: true, firstName: true, lastName: true, birthYear: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ ok: true, tags });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const photoId = url.pathname.split("/").filter(Boolean).slice(-2)[0];
    const body = await req.json().catch(() => ({}));
    const personIds = Array.isArray(body?.personIds) ? body.personIds : [];

    const cleanIds = personIds
      .filter((id: unknown) => typeof id === "string")
      .map((id: string) => id.trim())
      .filter(Boolean);

    if (cleanIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "personIds must be a non-empty array" },
        { status: 400 }
      );
    }

    for (const personId of cleanIds) {
      try {
        await prisma.photoTag.create({
          data: { photoId, personId },
        });
      } catch (e: any) {
        // Ignore unique constraint violations
        if (e?.code !== "P2002") throw e;
      }
    }

    const tags = await prisma.photoTag.findMany({
      where: { photoId },
      include: {
        person: {
          select: { id: true, name: true, firstName: true, lastName: true, birthYear: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ ok: true, tags });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const photoId = url.pathname.split("/").filter(Boolean).slice(-2)[0];
    const { searchParams } = new URL(req.url);
    const personId = searchParams.get("personId");

    if (!personId) {
      return NextResponse.json(
        { ok: false, error: "personId is required" },
        { status: 400 }
      );
    }

    await prisma.photoTag.deleteMany({
      where: { photoId, personId },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
