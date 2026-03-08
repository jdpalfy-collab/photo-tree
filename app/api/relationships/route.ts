import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export async function GET() {
  try {
    const relationships = await prisma.relationship.findMany({
      select: {
        id: true,
        fromId: true,
        toId: true,
        type: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ ok: true, relationships });
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
    const fromId = typeof body?.fromId === "string" ? body.fromId : "";
    const toId = typeof body?.toId === "string" ? body.toId : "";
    const typeRaw = typeof body?.type === "string" ? body.type : "";

    if (!fromId || !toId) {
      return NextResponse.json({ ok: false, error: "fromId and toId required" }, { status: 400 });
    }
    if (fromId === toId) {
      return NextResponse.json({ ok: false, error: "fromId and toId must differ" }, { status: 400 });
    }

    let type = typeRaw;
    let f = fromId;
    let t = toId;
    if (type === "child") {
      // Normalize child to parent direction by swapping
      type = "parent";
      f = toId;
      t = fromId;
    }

    if (!["parent", "sibling", "spouse"].includes(type)) {
      return NextResponse.json(
        { ok: false, error: "type must be parent | sibling | spouse" },
        { status: 400 }
      );
    }

    const created: any[] = [];

    async function ensureParent(parentId: string, childId: string) {
      const existing = await prisma.relationship.findFirst({
        where: { fromId: parentId, toId: childId, type: "parent" },
        select: { id: true },
      });
      if (existing) return null;
      return prisma.relationship.create({
        data: { fromId: parentId, toId: childId, type: "parent" },
        select: { id: true, fromId: true, toId: true, type: true },
      });
    }

    async function ensureSiblingLinks(a: string, b: string) {
      const existing = await prisma.relationship.findFirst({
        where: { fromId: a, toId: b, type: "sibling" },
        select: { id: true },
      });
      if (existing) return null;
      const rel1 = await prisma.relationship.create({
        data: { fromId: a, toId: b, type: "sibling" },
        select: { id: true, fromId: true, toId: true, type: true },
      });
      const rel2 = await prisma.relationship.create({
        data: { fromId: b, toId: a, type: "sibling" },
        select: { id: true, fromId: true, toId: true, type: true },
      });
      return [rel1, rel2];
    }

    if (type === "parent") {
      const rel = await prisma.relationship.create({
        data: { fromId: f, toId: t, type: "parent" },
        select: { id: true, fromId: true, toId: true, type: true },
      });
      created.push(rel);

      // If parent has spouse(s), assume spouse is also a parent of the child
      const spouses = await prisma.relationship.findMany({
        where: { fromId: f, type: "spouse" },
        select: { toId: true },
      });
      for (const s of spouses) {
        const added = await ensureParent(s.toId, t);
        if (added) created.push(added);
      }

      // If child has siblings, assume parent is also parent of each sibling
      const siblings = await prisma.relationship.findMany({
        where: { fromId: t, type: "sibling" },
        select: { toId: true },
      });
      for (const sib of siblings) {
        const added = await ensureParent(f, sib.toId);
        if (added) created.push(added);
        // Also extend to spouse(s) of parent
        for (const s of spouses) {
          const added2 = await ensureParent(s.toId, sib.toId);
          if (added2) created.push(added2);
        }
      }
    } else {
      // sibling/spouse: store both directions
      if (type === "sibling") {
        const createdSibs = await ensureSiblingLinks(fromId, toId);
        if (createdSibs) created.push(...createdSibs);

        // If one sibling has parents, add those parents for the other sibling
        const parentsOfFrom = await prisma.relationship.findMany({
          where: { toId: fromId, type: "parent" },
          select: { fromId: true },
        });
        const parentsOfTo = await prisma.relationship.findMany({
          where: { toId: toId, type: "parent" },
          select: { fromId: true },
        });
        for (const p of parentsOfFrom) {
          const added = await ensureParent(p.fromId, toId);
          if (added) created.push(added);
        }
        for (const p of parentsOfTo) {
          const added = await ensureParent(p.fromId, fromId);
          if (added) created.push(added);
        }
      } else {
        const rel1 = await prisma.relationship.create({
          data: { fromId, toId, type },
          select: { id: true, fromId: true, toId: true, type: true },
        });
        const rel2 = await prisma.relationship.create({
          data: { fromId: toId, toId: fromId, type },
          select: { id: true, fromId: true, toId: true, type: true },
        });
        created.push(rel1, rel2);
      }

      if (type === "spouse") {
        // If one spouse has children, assume the other spouse is also a parent
        const childrenFrom = await prisma.relationship.findMany({
          where: { fromId, type: "parent" },
          select: { toId: true },
        });
        const childrenTo = await prisma.relationship.findMany({
          where: { fromId: toId, type: "parent" },
          select: { toId: true },
        });
        for (const c of childrenFrom) {
          const added = await ensureParent(toId, c.toId);
          if (added) created.push(added);
        }
        for (const c of childrenTo) {
          const added = await ensureParent(fromId, c.toId);
          if (added) created.push(added);
        }
      }
    }

    return NextResponse.json({ ok: true, relationships: created });
  } catch (e: any) {
    if (e?.code === "P2002") {
      return NextResponse.json({ ok: false, error: "relationship already exists" }, { status: 409 });
    }
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
    }

    await prisma.relationship.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
