import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

const DEFAULT_ID = "default";

export async function GET() {
  try {
    const row = await prisma.manualLayout.findUnique({ where: { id: DEFAULT_ID } });
    return NextResponse.json({ ok: true, data: row?.data ?? null });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const data = typeof body?.data === "string" ? body.data : "";
    if (!data) {
      return NextResponse.json({ ok: false, error: "data is required" }, { status: 400 });
    }
    const row = await prisma.manualLayout.upsert({
      where: { id: DEFAULT_ID },
      create: { id: DEFAULT_ID, data },
      update: { data },
      select: { id: true, updatedAt: true },
    });
    return NextResponse.json({ ok: true, layout: row });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
