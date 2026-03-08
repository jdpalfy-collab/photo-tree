import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

export async function POST(req: NextRequest) {
  // Pull the NextAuth JWT (stored in cookies) and read the access token we saved in callbacks
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  const accessToken = (token as any)?.accessToken as string | undefined;

  if (!accessToken) {
    return NextResponse.json(
      { error: "Missing access token. Sign out and sign in again." },
      { status: 401 }
    );
  }

  // Create a Google Photos Picker session
  // Endpoint: POST https://photospicker.googleapis.com/v1/sessions
  const res = await fetch("https://photospicker.googleapis.com/v1/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      // Optional: cap how many items user can select (max coerced by API)
      pickingConfig: { maxItemCount: "2000" },
    }),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    return NextResponse.json(
      {
        error: "Failed to create picker session",
        status: res.status,
        details: data,
      },
      { status: res.status }
    );
  }

  // Expected response includes: id, pickerUri, expireTime, etc.
  return NextResponse.json({
    sessionId: data.id,
    pickerUri: data.pickerUri,
    expireTime: data.expireTime,
  });
}
