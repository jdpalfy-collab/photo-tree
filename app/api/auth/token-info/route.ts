import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

export async function GET(req: Request) {
  try {
    const token = await getToken({
      req: req as any,
      secret: process.env.NEXTAUTH_SECRET,
    });

    const accessToken = (token as any)?.accessToken as string | undefined;
    if (!accessToken) {
      return NextResponse.json(
        { ok: false, error: "Missing access token" },
        { status: 401 }
      );
    }

    const resp = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(
        accessToken
      )}`,
      { cache: "no-store" }
    );
    const text = await resp.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    return NextResponse.json({ ok: resp.ok, status: resp.status, tokenInfo: data });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
