import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export async function GET() {
  try {
    const people = await prisma.person.findMany({
      orderBy: [{ name: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        name: true,
        firstName: true,
        lastName: true,
        birthYear: true,
        profilePhotoId: true,
        profileZoom: true,
        profileX: true,
        profileY: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ ok: true, people });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const firstName = typeof body?.firstName === "string" ? body.firstName.trim() : "";
    const lastName = typeof body?.lastName === "string" ? body.lastName.trim() : "";
    const name = `${firstName} ${lastName}`.trim() || (typeof body?.name === "string" ? body.name.trim() : "");
    const birthYearRaw = body?.birthYear;

    if (!firstName || !lastName) {
      return NextResponse.json(
        { ok: false, error: "firstName and lastName are required" },
        { status: 400 }
      );
    }

    let birthYear: number | null = null;
    if (birthYearRaw !== undefined && birthYearRaw !== null && birthYearRaw !== "") {
      const parsed = Number(birthYearRaw);
      if (!Number.isInteger(parsed)) {
        return NextResponse.json(
          { ok: false, error: "birthYear must be an integer" },
          { status: 400 }
        );
      }
      birthYear = parsed;
    }

    const person = await prisma.person.create({
      data: {
        name,
        firstName,
        lastName,
        birthYear,
      },
      select: {
        id: true,
        name: true,
        firstName: true,
        lastName: true,
        birthYear: true,
        profilePhotoId: true,
        profileZoom: true,
        profileX: true,
        profileY: true,
        createdAt: true,
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
