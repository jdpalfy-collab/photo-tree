import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Photo storage is not configured. Add BLOB_READ_WRITE_TOKEN to your local .env.local and Vercel project environment variables, then restart the app.",
        },
        { status: 500 }
      );
    }

    const body = (await req.json()) as HandleUploadBody;
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (_pathname, clientPayload) => ({
        addRandomSuffix: false,
        cacheControlMaxAge: 60 * 60 * 24 * 365,
        maximumSizeInBytes: 250 * 1024 * 1024,
        tokenPayload: clientPayload,
      }),
      onUploadCompleted: async () => {
        // The picker page records the uploaded blob in the import session.
      },
    });

    return NextResponse.json(json);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
