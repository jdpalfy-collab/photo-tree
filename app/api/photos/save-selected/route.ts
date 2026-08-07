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

type StoredMediaItem = {
  item: MediaItem;
  baseUrl: string;
  mimeType: string;
  storageUrl: string;
};

const STORAGE_COPY_CONCURRENCY = 3;

function extFromMime(mimeType?: string) {
  if (!mimeType) return "jpg";
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("gif")) return "gif";
  return "jpg";
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        if (currentIndex >= items.length) return;
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      }
    })
  );
  return results;
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

async function ensureDurableStorage(it: MediaItem, accessToken?: string) {
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
  } catch (e: any) {
    return {
      ok: false as const,
      id: it.id,
      reason: `blob_cache_failed:${String(e?.message || e)}`,
    };
  }

  if (!storageUrl) {
    return { ok: false as const, id: it.id, reason: "missing_durable_storage_url" };
  }

  return {
    ok: true as const,
    stored: {
      item: it,
      baseUrl,
      mimeType,
      storageUrl,
    },
  };
}

export async function POST(req: Request) {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(
        {
          error:
            "Photo storage is not configured. Add BLOB_READ_WRITE_TOKEN to your local .env.local and Vercel project environment variables, then restart the app.",
        },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const sessionId = body?.sessionId as string | undefined;
    const providedItems = Array.isArray(body?.items) ? (body.items as MediaItem[]) : [];
    const meta = (body?.meta || {}) as Record<
      string,
      {
        year?: string;
        location?: string;
        description?: string;
        personIds?: string[];
      }
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

    const storageResults = await mapWithConcurrency(items, STORAGE_COPY_CONCURRENCY, (it) =>
      ensureDurableStorage(it, accessToken)
    );
    const storedItems = storageResults
      .filter((result): result is { ok: true; stored: StoredMediaItem } => result.ok)
      .map((result) => result.stored);
    const failures: Array<{ id: string; reason: string }> = storageResults
      .filter((result): result is { ok: false; id: string; reason: string } => !result.ok)
      .map((result) => ({ id: result.id, reason: result.reason }));
    const tagFailures: Array<{ id: string; reason: string }> = [];
    let saved = 0;

    for (const stored of storedItems) {
      const it = stored.item;
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
      const parsedCreateTime = it.createTime ? new Date(it.createTime) : null;
      const createdTime = year
        ? new Date(`${year}-01-01`)
        : parsedCreateTime && !Number.isNaN(parsedCreateTime.getTime())
          ? parsedCreateTime
          : null;
      const mimeType = stored.mimeType || "image/jpeg";

      try {
        await prisma.photo.upsert({
          where: { id: it.id },
          create: {
            id: it.id,
            baseUrl: stored.baseUrl,
            mimeType,
            width: it.mediaFile?.mediaFileMetadata?.width ?? null,
            height: it.mediaFile?.mediaFileMetadata?.height ?? null,
            createdTime,
            storageUrl: stored.storageUrl,
            location,
            description,
          },
          update: {
            baseUrl: stored.baseUrl,
            mimeType,
            width: it.mediaFile?.mediaFileMetadata?.width ?? null,
            height: it.mediaFile?.mediaFileMetadata?.height ?? null,
            createdTime,
            storageUrl: stored.storageUrl,
            location,
            description,
          },
        });
        saved += 1;
      } catch (e: any) {
        failures.push({ id: it.id, reason: `db_photo_failed:${String(e?.message || e)}` });
        continue;
      }

      const personIds = Array.from(
        new Set(
          Array.isArray(metaForPhoto.personIds)
            ? metaForPhoto.personIds.filter((personId): personId is string => typeof personId === "string" && !!personId)
            : []
        )
      );
      if (personIds.length > 0) {
        try {
          await prisma.photoTag.createMany({
            data: personIds.map((personId) => ({ photoId: it.id, personId })),
            skipDuplicates: true,
          });
        } catch (e: any) {
          tagFailures.push({ id: it.id, reason: `db_tags_failed:${String(e?.message || e)}` });
        }
      }
    }

    if (failures.length > 0 || tagFailures.length > 0) {
      const status = saved > 0 ? 207 : 502;
      return NextResponse.json(
        {
          ok: saved > 0,
          totalFetched: items.length,
          saved,
          failed: failures.length,
          tagFailed: tagFailures.length,
          failures,
          tagFailures,
          error:
            "Some selected photos could not be fully saved to PhotoTree. Stored photos were only added to the database after durable storage succeeded.",
        },
        { status }
      );
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
