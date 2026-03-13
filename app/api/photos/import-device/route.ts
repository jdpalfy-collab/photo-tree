import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { put } from "@vercel/blob";

function extFromMime(mimeType?: string) {
  if (!mimeType) return "jpg";
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("gif")) return "gif";
  return "jpg";
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const files = form.getAll("files").filter(Boolean) as File[];

    if (files.length === 0) {
      return NextResponse.json({ ok: false, error: "No files uploaded" }, { status: 400 });
    }

    const created: Array<{
      id: string;
      storageUrl: string;
      mimeType: string;
      createdTime: string;
    }> = [];

    for (const file of files) {
      const mimeType = file.type || "image/jpeg";
      const bytes = Buffer.from(await file.arrayBuffer());
      const id = crypto.randomUUID();
      const ext = extFromMime(mimeType);

      const blob = await put(`photos/${id}.${ext}`, bytes, {
        access: "public",
        contentType: mimeType,
      });

      const createdTime = file.lastModified
        ? new Date(file.lastModified).toISOString()
        : new Date().toISOString();

      await prisma.photo.create({
        data: {
          id,
          baseUrl: "",
          mimeType,
          createdTime: new Date(createdTime),
          storageUrl: blob.url,
        },
      });

      created.push({ id, storageUrl: blob.url, mimeType, createdTime });
    }

    return NextResponse.json({ ok: true, items: created });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
