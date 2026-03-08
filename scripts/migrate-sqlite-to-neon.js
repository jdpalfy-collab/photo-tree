#!/usr/bin/env node
/* eslint-disable no-console */
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith("\"") && val.endsWith("\"")) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile(path.resolve(process.cwd(), ".env"));
loadEnvFile(path.resolve(process.cwd(), ".env.local"));

const sqlitePath =
  process.env.SQLITE_PATH ||
  path.resolve(process.cwd(), "prisma", "prisma", "dev.db");

const DATABASE_URL = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Missing DIRECT_URL or DATABASE_URL in env.");
  process.exit(1);
}

let Client;
try {
  ({ Client } = require("pg"));
} catch (e) {
  console.error("Missing dependency: pg. Run `npm install pg` and retry.");
  process.exit(1);
}

function querySqlite(table) {
  const cmd = `sqlite3 "${sqlitePath}" ".mode json" "select * from \\"${table}\\";"`;
  try {
    const out = execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
    if (!out) return [];
    return JSON.parse(out);
  } catch (err) {
    const msg = String(err?.stderr || err?.message || err);
    if (msg.includes("no such table")) {
      return [];
    }
    throw err;
  }
}

async function main() {
  console.log("Reading from SQLite:", sqlitePath);
  const people = querySqlite("Person");
  const photos = querySqlite("Photo");
  const photoTags = querySqlite("PhotoTag");
  const relationships = querySqlite("Relationship");
  const manualLayouts = querySqlite("ManualLayout");

  console.log(
    `Found ${people.length} people, ${photos.length} photos, ${photoTags.length} tags, ${relationships.length} relationships, ${manualLayouts.length} layouts.`
  );

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  await client.query("BEGIN");

  const toDate = (v) => {
    if (v === null || v === undefined || v === "") return null;
    if (v instanceof Date) return v;
    if (typeof v === "number") {
      if (v > 1e12) return new Date(v);
      return new Date(v * 1000);
    }
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (!trimmed) return null;
      if (/^\d+$/.test(trimmed)) {
        const n = Number(trimmed);
        if (n > 1e12) return new Date(n);
        if (n > 1e9) return new Date(n * 1000);
      }
      const d = new Date(trimmed);
      if (!Number.isNaN(d.getTime())) return d;
    }
    return null;
  };

  for (const p of people) {
    await client.query(
      `INSERT INTO "Person" ("id","name","firstName","lastName","birthYear","createdAt","profilePhotoId","profileZoom","profileX","profileY")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT ("id") DO UPDATE SET
         "name"=EXCLUDED."name",
         "firstName"=EXCLUDED."firstName",
         "lastName"=EXCLUDED."lastName",
         "birthYear"=EXCLUDED."birthYear",
         "createdAt"=EXCLUDED."createdAt",
         "profilePhotoId"=EXCLUDED."profilePhotoId",
         "profileZoom"=EXCLUDED."profileZoom",
         "profileX"=EXCLUDED."profileX",
         "profileY"=EXCLUDED."profileY"`,
      [
        p.id,
        p.name,
        p.firstName ?? null,
        p.lastName ?? null,
        p.birthYear ?? null,
        toDate(p.createdAt),
        p.profilePhotoId ?? null,
        p.profileZoom ?? null,
        p.profileX ?? null,
        p.profileY ?? null,
      ]
    );
  }

  for (const ph of photos) {
    await client.query(
      `INSERT INTO "Photo" ("id","baseUrl","mimeType","width","height","createdTime","createdAt","localPath","location","description","rotation")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT ("id") DO UPDATE SET
         "baseUrl"=EXCLUDED."baseUrl",
         "mimeType"=EXCLUDED."mimeType",
         "width"=EXCLUDED."width",
         "height"=EXCLUDED."height",
         "createdTime"=EXCLUDED."createdTime",
         "createdAt"=EXCLUDED."createdAt",
         "localPath"=EXCLUDED."localPath",
         "location"=EXCLUDED."location",
         "description"=EXCLUDED."description",
         "rotation"=EXCLUDED."rotation"`,
      [
        ph.id,
        ph.baseUrl,
        ph.mimeType,
        ph.width ?? null,
        ph.height ?? null,
        toDate(ph.createdTime),
        toDate(ph.createdAt),
        ph.localPath ?? null,
        ph.location ?? null,
        ph.description ?? null,
        ph.rotation ?? null,
      ]
    );
  }

  for (const t of photoTags) {
    await client.query(
      `INSERT INTO "PhotoTag" ("id","photoId","personId","createdAt")
       VALUES ($1,$2,$3,$4)
       ON CONFLICT ("photoId","personId") DO NOTHING`,
      [t.id, t.photoId, t.personId, toDate(t.createdAt)]
    );
  }

  for (const r of relationships) {
    await client.query(
      `INSERT INTO "Relationship" ("id","fromId","toId","type","createdAt")
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT ("fromId","toId","type") DO NOTHING`,
      [r.id, r.fromId, r.toId, r.type, toDate(r.createdAt)]
    );
  }

  for (const m of manualLayouts) {
    await client.query(
      `INSERT INTO "ManualLayout" ("id","data","updatedAt")
       VALUES ($1,$2,$3)
       ON CONFLICT ("id") DO UPDATE SET
         "data"=EXCLUDED."data",
         "updatedAt"=EXCLUDED."updatedAt"`,
      [m.id, m.data, toDate(m.updatedAt)]
    );
  }

  await client.query("COMMIT");
  await client.end();
  console.log("Migration complete.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
