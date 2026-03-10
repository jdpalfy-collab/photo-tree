import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getToken } from "next-auth/jwt";
import { put } from "@vercel/blob";

function extFromMime(mimeType?: string) {
  if (!mimeType) return "jpg";
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("gif")) return "gif";
  return "jpg";
}

async function fetchImageBytes(urlToFetch: string, accessToken?: string) {
  const primary = await fetch(urlToFetch, {
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      Accept: "image/*",
    },
    cache: "no-store",
  });

  if (primary.ok) {
    return Buffer.from(await primary.arrayBuffer());
  }

  if (accessToken) {
    const retry = await fetch(urlToFetch, {
      headers: { Accept: "image/*" },
      cache: "no-store",
    });
    if (retry.ok) {
      return Buffer.from(await retry.arrayBuffer());
    }
  }

  return null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const photoId = typeof body?.photoId === "string" ? body.photoId : "";
    if (!photoId) {
      return NextResponse.json({ ok: false, error: "photoId is required" }, { status: 400 });
    }

    const token = await getToken({
      req: req as any,
      secret: process.env.NEXTAUTH_SECRET,
    });
    const accessToken = (token as any)?.accessToken as string | undefined;

    const photo = await prisma.photo.findUnique({
      where: { id: photoId },
      select: { id: true, baseUrl: true, mimeType: true },
    });

    if (!photo) {
      return NextResponse.json({ ok: false, error: "photo not found" }, { status: 404 });
    }

    const baseUrl = photo.baseUrl || "";
    if (!baseUrl) {
      return NextResponse.json({ ok: false, error: "missing baseUrl" }, { status: 400 });
    }

    const fileExt = extFromMime(photo.mimeType || "");

    const sized = baseUrl.includes("=")
      ? baseUrl.replace(/=.*/, "=w2400-h2400")
      : `${baseUrl}=w2400-h2400`;
    const bytes = await fetchImageBytes(sized, accessToken);
    if (!bytes) {
      return NextResponse.json({ ok: false, error: "download failed" }, { status: 502 });
    }

    const blob = await put(`photos/${photo.id}.${fileExt}`, bytes, {
      access: "public",
      contentType: photo.mimeType || "image/jpeg",
    });

    await prisma.photo.update({
      where: { id: photo.id },
      data: { storageUrl: blob.url },
    });

    return NextResponse.json({ ok: true, storageUrl: blob.url });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
