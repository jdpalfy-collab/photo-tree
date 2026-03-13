import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const photoId = url.pathname.split("/").filter(Boolean).slice(-1)[0];

    if (!photoId) {
      return NextResponse.json({ ok: false, error: "photoId is required" }, { status: 400 });
    }

    const photo = await prisma.photo.findUnique({
      where: { id: photoId },
      select: {
        id: true,
        baseUrl: true,
        localPath: true,
        storageUrl: true,
        mimeType: true,
        createdTime: true,
        location: true,
        description: true,
        rotation: true,
        cropX: true,
        cropY: true,
        cropW: true,
        cropH: true,
      },
    });

    if (!photo) {
      return NextResponse.json({ ok: false, error: "photo not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, photo });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const photoId = url.pathname.split("/").filter(Boolean).slice(-1)[0];

    if (!photoId) {
      return NextResponse.json({ ok: false, error: "photoId is required" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const data: { createdTime?: Date | null; location?: string | null; description?: string | null; rotation?: number | null; cropX?: number | null; cropY?: number | null; cropW?: number | null; cropH?: number | null } = {};
    const createdTimeRaw = body?.createdTime;
    if (createdTimeRaw !== undefined) {
      if (typeof createdTimeRaw !== "string") {
        return NextResponse.json(
          { ok: false, error: "createdTime must be an ISO date string (YYYY-MM-DD) or empty" },
          { status: 400 }
        );
      }
      if (createdTimeRaw.trim() === "") {
        data.createdTime = null;
      } else {
        const date = new Date(createdTimeRaw);
        if (Number.isNaN(date.getTime())) {
          return NextResponse.json(
            { ok: false, error: "createdTime is not a valid date" },
            { status: 400 }
          );
        }
        data.createdTime = date;
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, "location")) {
      const raw = body?.location;
      if (raw === null) {
        data.location = null;
      } else if (typeof raw === "string") {
        const trimmed = raw.trim();
        data.location = trimmed === "" ? null : trimmed;
      } else {
        return NextResponse.json(
          { ok: false, error: "location must be a string" },
          { status: 400 }
        );
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, "description")) {
      const raw = body?.description;
      if (raw === null) {
        data.description = null;
      } else if (typeof raw === "string") {
        const trimmed = raw.trim();
        data.description = trimmed === "" ? null : trimmed;
      } else {
        return NextResponse.json(
          { ok: false, error: "description must be a string" },
          { status: 400 }
        );
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, "rotation")) {
      const raw = body?.rotation;
      if (raw === null || raw === "") {
        data.rotation = null;
      } else {
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) {
          return NextResponse.json(
            { ok: false, error: "rotation must be a number" },
            { status: 400 }
          );
        }
        const norm = ((Math.round(parsed) % 360) + 360) % 360;
        data.rotation = norm;
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, "crop")) {
      const crop = body?.crop;
      if (crop === null) {
        data.cropX = null;
        data.cropY = null;
        data.cropW = null;
        data.cropH = null;
      } else if (
        typeof crop?.x === "number" &&
        typeof crop?.y === "number" &&
        typeof crop?.w === "number" &&
        typeof crop?.h === "number"
      ) {
        data.cropX = Math.max(0, Math.min(1, crop.x));
        data.cropY = Math.max(0, Math.min(1, crop.y));
        data.cropW = Math.max(0.05, Math.min(1, crop.w));
        data.cropH = Math.max(0.05, Math.min(1, crop.h));
      } else {
        return NextResponse.json(
          { ok: false, error: "crop must be {x,y,w,h} or null" },
          { status: 400 }
        );
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { ok: false, error: "No fields provided to update" },
        { status: 400 }
      );
    }

    const photo = await prisma.photo.update({
      where: { id: photoId },
      data,
      select: {
        id: true,
        baseUrl: true,
        localPath: true,
        mimeType: true,
        createdTime: true,
        location: true,
        description: true,
        rotation: true,
        cropX: true,
        cropY: true,
        cropW: true,
        cropH: true,
      },
    });

    return NextResponse.json({ ok: true, photo });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const photoId = url.pathname.split("/").filter(Boolean).slice(-1)[0];

    if (!photoId) {
      return NextResponse.json({ ok: false, error: "photoId is required" }, { status: 400 });
    }

    await prisma.photo.delete({ where: { id: photoId } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
