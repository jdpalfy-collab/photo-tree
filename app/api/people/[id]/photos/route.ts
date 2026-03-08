import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const personId = url.pathname.split("/").filter(Boolean).slice(-2)[0];

    if (!personId) {
      return NextResponse.json({ ok: false, error: "personId is required" }, { status: 400 });
    }

    const tags = await prisma.photoTag.findMany({
      where: { personId },
      include: {
        photo: {
          select: {
            id: true,
            baseUrl: true,
            localPath: true,
            mimeType: true,
            createdTime: true,
            location: true,
            description: true,
            rotation: true,
            tags: {
              include: {
                person: {
                  select: { id: true, name: true, firstName: true, lastName: true },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    const photos = tags.map((t) => t.photo);

    return NextResponse.json({ ok: true, photos });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
