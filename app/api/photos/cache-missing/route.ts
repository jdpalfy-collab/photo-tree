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
    return { ok: true, status: primary.status, bytes: Buffer.from(await primary.arrayBuffer()) };
  }

  if (accessToken) {
    const retry = await fetch(urlToFetch, {
      headers: { Accept: "image/*" },
      cache: "no-store",
    });
    if (retry.ok) {
      return { ok: true, status: retry.status, bytes: Buffer.from(await retry.arrayBuffer()) };
    }
    return { ok: false, status: retry.status, bytes: null };
  }

  return { ok: false, status: primary.status, bytes: null };
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
    let missingBaseUrl = 0;
    let alreadyStored = 0;
    let fetchFailed = 0;
    let uploadFailed = 0;
    const failures: { id: string; reason: string; status?: number }[] = [];

    for (const p of candidates) {
      const baseUrl = p.baseUrl || "";

      try {
        if (!baseUrl) {
          missingBaseUrl += 1;
          failures.push({ id: p.id, reason: "missing_baseUrl" });
          continue;
        }
        if (p.storageUrl) {
          alreadyStored += 1;
          continue;
        }
        const sized = baseUrl.includes("=")
          ? baseUrl.replace(/=.*/, "=w2400-h2400")
          : `${baseUrl}=w2400-h2400`;
        const fetched = await fetchImageBytes(sized, accessToken);
        if (!fetched.ok || !fetched.bytes) {
          fetchFailed += 1;
          failures.push({ id: p.id, reason: "fetch_failed", status: fetched.status });
          continue;
        }
        const fileExt = extFromMime(p.mimeType || "");
        try {
          const blob = await put(`photos/${p.id}.${fileExt}`, fetched.bytes, {
            access: "public",
            contentType: p.mimeType || "image/jpeg",
          });
          await prisma.photo.update({
            where: { id: p.id },
            data: { storageUrl: blob.url },
          });
          cached += 1;
        } catch {
          uploadFailed += 1;
          failures.push({ id: p.id, reason: "upload_failed" });
        }
      } catch {
        // continue
      }
    }

    return NextResponse.json({
      ok: true,
      scanned: candidates.length,
      cached,
      alreadyStored,
      missingBaseUrl,
      fetchFailed,
      uploadFailed,
      failures: failures.slice(0, 10),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
