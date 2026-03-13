// app/api/photos/save-selected/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getToken } from "next-auth/jwt";
import { put } from "@vercel/blob";

type MediaItem = {
  id: string;
  createTime?: string;
  type?: string;
  storageUrl?: string;
  mediaFile?: {
    baseUrl?: string;
    mimeType?: string;
    mediaFileMetadata?: { width?: number; height?: number };
  };
};

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

  // Retry without auth if first attempt failed
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
    const sessionId = body?.sessionId as string | undefined;
    const providedItems = Array.isArray(body?.items) ? (body.items as MediaItem[]) : [];
    const meta = (body?.meta || {}) as Record<
      string,
      { year?: string; location?: string; description?: string; personIds?: string[] }
    >;

    let items: MediaItem[] = providedItems;
    if (items.length === 0) {
      if (!sessionId) {
        return NextResponse.json({ error: "Missing sessionId or items" }, { status: 400 });
      }
      // ✅ Use your already-working internal endpoint that returns JSON mediaItems
      const base =
        process.env.NEXTAUTH_URL ||
        process.env.NEXT_PUBLIC_BASE_URL ||
        "http://localhost:3000";

      const internal = await fetch(
        `${base}/api/photos/media-items?sessionId=${encodeURIComponent(sessionId)}`,
        {
          headers: {
            // forward cookies for auth (so internal endpoint can call Google)
            cookie: req.headers.get("cookie") ?? "",
          },
          cache: "no-store",
        }
      );

      const internalText = await internal.text();
      let internalJson: any;
      try {
        internalJson = JSON.parse(internalText);
      } catch {
        return NextResponse.json(
          {
            error: "Internal /api/photos/media-items returned non-JSON",
            status: internal.status,
            raw: internalText.slice(0, 800),
          },
          { status: 502 }
        );
      }

      if (!internal.ok) {
        return NextResponse.json(
          {
            error: "Internal /api/photos/media-items failed",
            status: internal.status,
            details: internalJson,
          },
          { status: 502 }
        );
      }

      items = Array.isArray(internalJson?.mediaItems) ? internalJson.mediaItems : [];
    }

    if (items.length === 0) {
      return NextResponse.json({
        ok: true,
        saved: 0,
        totalFetched: 0,
        message:
          "No mediaItems returned. Make sure you clicked Done in Google Photos, then Check status, then List selected items.",
      });
    }

    // Get access token for direct image fetch (if needed)
    const token = await getToken({
      req: req as any,
      secret: process.env.NEXTAUTH_SECRET,
    });
    const accessToken = (token as any)?.accessToken as string | undefined;

    // ✅ Upsert each item (works reliably)
    let saved = 0;
    for (const it of items) {
      const baseUrl = it.mediaFile?.baseUrl || "";
      const mimeType = it.mediaFile?.mimeType || "";
      const fileExt = extFromMime(mimeType);
      let storageUrl: string | null = null;
      try {
        if (it.storageUrl) {
          storageUrl = it.storageUrl;
        } else if (baseUrl) {
          const sized = baseUrl.includes("=")
            ? baseUrl.replace(/=.*/, "=w2400-h2400")
            : `${baseUrl}=w2400-h2400`;
          const bytes = await fetchImageBytes(sized, accessToken);
          if (bytes) {
            const blob = await put(`photos/${it.id}.${fileExt}`, bytes, {
              access: "public",
              contentType: mimeType || "image/jpeg",
            });
            storageUrl = blob.url;
          }
        }
      } catch {
        // continue without storage url
      }

      const metaForPhoto = meta[it.id] || {};
      const year =
        typeof metaForPhoto.year === "string" && /^\d{4}$/.test(metaForPhoto.year)
          ? metaForPhoto.year
          : null;
      const location =
        typeof metaForPhoto.location === "string" && metaForPhoto.location.trim()
          ? metaForPhoto.location.trim()
          : null;
      const description =
        typeof metaForPhoto.description === "string" && metaForPhoto.description.trim()
          ? metaForPhoto.description.trim()
          : null;

      const createdTime = year
        ? new Date(`${year}-01-01`)
        : it.createTime
          ? new Date(it.createTime)
          : null;

      await prisma.photo.upsert({
        where: { id: it.id },
        create: {
          id: it.id,
          baseUrl,
          mimeType,
          width: it.mediaFile?.mediaFileMetadata?.width ?? null,
          height: it.mediaFile?.mediaFileMetadata?.height ?? null,
          createdTime,
          storageUrl,
          location,
          description,
        },
        update: {
          baseUrl,
          mimeType,
          width: it.mediaFile?.mediaFileMetadata?.width ?? null,
          height: it.mediaFile?.mediaFileMetadata?.height ?? null,
          createdTime,
          storageUrl: storageUrl ?? undefined,
          location,
          description,
        },
      });

      const personIds = Array.isArray(metaForPhoto.personIds) ? metaForPhoto.personIds : [];
      for (const personId of personIds) {
        try {
          await prisma.photoTag.create({
            data: { photoId: it.id, personId },
          });
        } catch (e: any) {
          if (e?.code !== "P2002") throw e;
        }
      }
      saved += 1;
    }

    return NextResponse.json({
      ok: true,
      totalFetched: items.length,
      saved,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Server error saving selected", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}
