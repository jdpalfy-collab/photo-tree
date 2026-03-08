import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export async function PATCH(
  req: NextRequest
) {
  try {
    const url = new URL(req.url);
    const personId =
      url.pathname.split("/").filter(Boolean).slice(-1)[0];

    if (!personId) {
      return NextResponse.json({ ok: false, error: "personId is required" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));

    const updates: {
      profilePhotoId?: string | null;
      firstName?: string;
      lastName?: string;
      name?: string;
      birthYear?: number | null;
      profileZoom?: number | null;
      profileX?: number | null;
      profileY?: number | null;
    } = {};

    if (Object.prototype.hasOwnProperty.call(body, "profilePhotoId")) {
      const profilePhotoId =
        body?.profilePhotoId === null || body?.profilePhotoId === ""
          ? null
          : typeof body?.profilePhotoId === "string"
            ? body.profilePhotoId
            : undefined;
      if (profilePhotoId === undefined) {
        return NextResponse.json(
          { ok: false, error: "profilePhotoId must be a string or null" },
          { status: 400 }
        );
      }
      updates.profilePhotoId = profilePhotoId;
    }

    if (Object.prototype.hasOwnProperty.call(body, "firstName") || Object.prototype.hasOwnProperty.call(body, "lastName")) {
      const firstName = typeof body?.firstName === "string" ? body.firstName.trim() : "";
      const lastName = typeof body?.lastName === "string" ? body.lastName.trim() : "";
      if (!firstName || !lastName) {
        return NextResponse.json(
          { ok: false, error: "firstName and lastName are required" },
          { status: 400 }
        );
      }
      updates.firstName = firstName;
      updates.lastName = lastName;
      updates.name = `${firstName} ${lastName}`.trim();
    }

    if (Object.prototype.hasOwnProperty.call(body, "birthYear")) {
      const raw = body?.birthYear;
      if (raw === null || raw === "") {
        updates.birthYear = null;
      } else {
        const parsed = Number(raw);
        if (!Number.isInteger(parsed)) {
          return NextResponse.json(
            { ok: false, error: "birthYear must be an integer or null" },
            { status: 400 }
          );
        }
        updates.birthYear = parsed;
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, "profileZoom")) {
      const raw = body?.profileZoom;
      if (raw === null || raw === "") {
        updates.profileZoom = null;
      } else {
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) {
          return NextResponse.json(
            { ok: false, error: "profileZoom must be a number or null" },
            { status: 400 }
          );
        }
        updates.profileZoom = parsed;
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, "profileX")) {
      const raw = body?.profileX;
      if (raw === null || raw === "") {
        updates.profileX = null;
      } else {
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) {
          return NextResponse.json(
            { ok: false, error: "profileX must be a number or null" },
            { status: 400 }
          );
        }
        updates.profileX = parsed;
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, "profileY")) {
      const raw = body?.profileY;
      if (raw === null || raw === "") {
        updates.profileY = null;
      } else {
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) {
          return NextResponse.json(
            { ok: false, error: "profileY must be a number or null" },
            { status: 400 }
          );
        }
        updates.profileY = parsed;
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { ok: false, error: "No valid fields to update" },
        { status: 400 }
      );
    }

    const person = await prisma.person.update({
      where: { id: personId },
      data: updates,
      select: {
        id: true,
        name: true,
        birthYear: true,
        firstName: true,
        lastName: true,
        profilePhotoId: true,
        profileZoom: true,
        profileX: true,
        profileY: true,
      },
    });

    return NextResponse.json({ ok: true, person });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
