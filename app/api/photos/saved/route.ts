// app/api/photos/saved/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export async function GET() {
  try {
    const photos = await prisma.photo.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
        select: {
          id: true,
          baseUrl: true,
          mimeType: true,
          width: true,
          height: true,
          createdTime: true,
          createdAt: true,
          localPath: true,
          storageUrl: true,
          location: true,
          description: true,
          rotation: true,
          cropX: true,
          cropY: true,
          cropW: true,
          cropH: true,
        },
    });

    return NextResponse.json({ ok: true, photos });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
