import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const src = url.searchParams.get("src");
    const photoId = url.searchParams.get("photoId");
    const w = url.searchParams.get("w") || "800";
    const h = url.searchParams.get("h") || "800";

    if (!src && !photoId) {
      return NextResponse.json({ error: "Missing src" }, { status: 400 });
    }

    // Must be signed in (NextAuth JWT cookie)
    const token = await getToken({
      req: req as any,
      secret: process.env.NEXTAUTH_SECRET,
    });

    const accessToken = (token as any)?.accessToken as string | undefined;
    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing Google access token. Sign out and sign in again." },
        { status: 401 }
      );
    }

    let baseUrl = src || "";
    let metaStatus: number | null = null;
    let metaError: string | null = null;

    if (photoId) {
      const metaRes = await fetch(
        `https://photoslibrary.googleapis.com/v1/mediaItems/${encodeURIComponent(photoId)}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        }
      );
      metaStatus = metaRes.status;
      if (metaRes.ok) {
        const meta = await metaRes.json().catch(() => ({}));
        const freshBase = typeof meta?.baseUrl === "string" ? meta.baseUrl : "";
        if (freshBase) {
          baseUrl = freshBase;
        }
      } else {
        const metaText = await metaRes.text().catch(() => "");
        metaError = metaText.slice(0, 300);
      }
    }

    if (!baseUrl) {
      return NextResponse.json(
        { error: "Missing baseUrl for image", metaStatus, metaError },
        { status: 500 }
      );
    }

    // Only allow Googleusercontent (basic safety)
    if (!baseUrl.includes("googleusercontent.com")) {
      return NextResponse.json({ error: "Invalid src host" }, { status: 400 });
    }

    // Build a sized URL for the image bytes Google returns.
    // Googleusercontent uses path params after "=" (not query params).
    // If src already has params, replace them entirely.
    const sized = baseUrl.includes("=")
      ? baseUrl.replace(/=.*/, `=w${w}-h${h}`)
      : `${baseUrl}=w${w}-h${h}`;

    async function fetchImage(urlToFetch: string) {
      const upstream = await fetch(urlToFetch, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "image/*",
        },
        cache: "no-store",
      });

      let contentType = upstream.headers.get("content-type") || "image/jpeg";
      let bytes = await upstream.arrayBuffer();

      if (!upstream.ok && (upstream.status === 401 || upstream.status === 403)) {
        // Some googleusercontent URLs reject Authorization headers; retry without auth.
        const retry = await fetch(urlToFetch, {
          headers: { Accept: "image/*" },
          cache: "no-store",
        });
        contentType = retry.headers.get("content-type") || contentType;
        bytes = await retry.arrayBuffer();
        return { ok: retry.ok, status: retry.status, contentType, bytes, source: "retry" };
      }

      return { ok: upstream.ok, status: upstream.status, contentType, bytes, source: "primary" };
    }

    const result = await fetchImage(sized);

    if (!result.ok) {
      let tokenInfoStatus: number | null = null;
      let tokenInfoScope: string | null = null;
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
        // ignore tokeninfo errors
      }

      return NextResponse.json(
        {
          error: "Upstream image fetch failed",
          status: result.status,
          contentType: result.contentType,
          source: result.source,
          photoId: photoId || null,
          metaStatus,
          metaError,
          tokenInfoStatus,
          tokenInfoScope,
          sample: new TextDecoder().decode(result.bytes.slice(0, 300)),
        },
        { status: 502 }
      );
    }

    return new NextResponse(result.bytes, {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        // ok to cache locally short time if you want; keeping no-store for debugging
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Image proxy error", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}
