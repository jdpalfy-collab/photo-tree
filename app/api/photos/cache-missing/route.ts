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
  // Try without auth first (googleusercontent often rejects Authorization)
  const noAuth = await fetch(urlToFetch, {
    headers: { Accept: "image/*" },
    cache: "no-store",
  });
  if (noAuth.ok) {
    return {
      ok: true,
      status: noAuth.status,
      bytes: Buffer.from(await noAuth.arrayBuffer()),
      source: "noauth",
    };
  }

  if (accessToken) {
    const authed = await fetch(urlToFetch, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "image/*",
      },
      cache: "no-store",
    });
    if (authed.ok) {
      return {
        ok: true,
        status: authed.status,
        bytes: Buffer.from(await authed.arrayBuffer()),
        source: "auth",
      };
    }
    return { ok: false, status: authed.status, bytes: null, source: "auth" };
  }

  return { ok: false, status: noAuth.status, bytes: null, source: "noauth" };
}

export async function POST(req: Request) {
  try {
    const token = await getToken({
      req: req as any,
      secret: process.env.NEXTAUTH_SECRET,
    });
    const accessToken = (token as any)?.accessToken as string | undefined;
    let tokenInfoStatus: number | null = null;
    let tokenInfoScope: string | null = null;
    if (accessToken) {
      try {
        const infoResp = await fetch(
          `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(
            accessToken
          )}`,
          { cache: "no-store" }
        );
        tokenInfoStatus = infoResp.status;
        const infoText = await infoResp.text();
        const infoJson = JSON.parse(infoText);
        tokenInfoScope = typeof infoJson?.scope === "string" ? infoJson.scope : null;
      } catch {
        // ignore
      }
    }

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
    let metaFailed = 0;
    const failures: { id: string; reason: string; status?: number }[] = [];

    for (const p of candidates) {
        let baseUrl = p.baseUrl || "";
        let metaStatus: number | undefined;
        let metaError: string | undefined;

        // Refresh baseUrl from Google Photos in case stored baseUrl expired
        if (accessToken) {
          try {
            const metaRes = await fetch(
              `https://photoslibrary.googleapis.com/v1/mediaItems/${encodeURIComponent(p.id)}`,
              {
                headers: { Authorization: `Bearer ${accessToken}` },
                cache: "no-store",
              }
            );
            metaStatus = metaRes.status;
            if (metaRes.ok) {
              const meta = await metaRes.json().catch(() => ({}));
              const fresh = typeof meta?.baseUrl === "string" ? meta.baseUrl : "";
              if (fresh) {
                baseUrl = fresh;
                if (fresh !== p.baseUrl) {
                  await prisma.photo.update({
                    where: { id: p.id },
                    data: { baseUrl: fresh },
                  });
                }
              }
            } else {
              metaFailed += 1;
              const txt = await metaRes.text().catch(() => "");
              metaError = txt.slice(0, 200);
            }
          } catch {
            // ignore meta refresh errors
          }
        }

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
          failures.push({
            id: p.id,
            reason: "fetch_failed",
            status: fetched.status,
            metaStatus,
            metaError,
            source: fetched.source,
          } as any);
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
      metaFailed,
      failures: failures.slice(0, 10),
      tokenInfoStatus,
      tokenInfoScope,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
