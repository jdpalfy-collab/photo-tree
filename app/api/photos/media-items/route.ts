import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

export async function GET(req: NextRequest) {
  try {
    const sessionId = req.nextUrl.searchParams.get("sessionId");
    if (!sessionId) {
      return NextResponse.json(
        { error: "Missing sessionId query param" },
        { status: 400 }
      );
    }

    const token = await getToken({
      req,
      secret: process.env.NEXTAUTH_SECRET,
    });

    const accessToken = (token as any)?.accessToken as string | undefined;

    if (!accessToken) {
      return NextResponse.json(
        {
          error: "Missing access token in session/JWT",
          hint: "Sign out and sign in again so NextAuth re-mints a token with scopes.",
        },
        { status: 401 }
      );
    }

    // IMPORTANT: Picker API uses photospicker.googleapis.com (NOT photoslibrary.googleapis.com)
    const url = `https://photospicker.googleapis.com/v1/mediaItems?sessionId=${encodeURIComponent(
      sessionId
    )}`;

    const resp = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    const text = await resp.text();

    // If it's not JSON, return it so you can see the real error quickly
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = { nonJsonResponse: text.slice(0, 5000) };
    }

    if (!resp.ok) {
      return NextResponse.json(
        {
          error: "Google API error",
          status: resp.status,
          statusText: resp.statusText,
          url,
          raw: data,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json(
      { error: "Server error in /api/photos/media-items", details: String(e) },
      { status: 500 }
    );
  }
}
