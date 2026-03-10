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
    const token = await getToken({
      req: req as any,
      secret: process.env.NEXTAUTH_SECRET,
    });
    const accessToken = (token as any)?.accessToken as string | undefined;

    const candidates = await prisma.photo.findMany({
      select: { id: true, baseUrl: true, mimeType: true, storageUrl: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });

    let cached = 0;

    for (const p of candidates) {
      const baseUrl = p.baseUrl || "";

      try {
        if (!baseUrl) continue;
        if (p.storageUrl) {
          cached += 1;
          continue;
        }
        const sized = baseUrl.includes("=")
          ? baseUrl.replace(/=.*/, "=w2400-h2400")
          : `${baseUrl}=w2400-h2400`;
        const bytes = await fetchImageBytes(sized, accessToken);
        if (!bytes) continue;
        const fileExt = extFromMime(p.mimeType || "");
        const blob = await put(`photos/${p.id}.${fileExt}`, bytes, {
          access: "public",
          contentType: p.mimeType || "image/jpeg",
        });
        await prisma.photo.update({
          where: { id: p.id },
          data: { storageUrl: blob.url },
        });
        cached += 1;
      } catch {
        // continue
      }
    }

    return NextResponse.json({ ok: true, scanned: candidates.length, cached });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
