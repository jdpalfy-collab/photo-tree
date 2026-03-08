import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

export async function GET(req: Request) {
  try {
    const token = await getToken({
      req: req as any,
      secret: process.env.NEXTAUTH_SECRET,
    });

    const accessToken = (token as any)?.accessToken;
    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing accessToken. Sign out/in again to refresh token." },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("sessionId");

    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
    }

    const res = await fetch(
      `https://photospicker.googleapis.com/v1/sessions/${sessionId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const data = await res.json();

    return NextResponse.json(data, { status: res.status });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Server error in /api/photos/session", details: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
