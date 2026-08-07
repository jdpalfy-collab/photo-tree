import { NextResponse } from "next/server";
import { put } from "@vercel/blob";

function extFromMime(mimeType?: string) {
  if (!mimeType) return "jpg";
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("gif")) return "gif";
  return "jpg";
}

function parseExifDate(bytes: Buffer): Date | null {
  // JPEG only minimal EXIF parser for DateTimeOriginal / DateTime.
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes.readUInt16BE(offset) !== 0xffe1) {
      // skip segment
      const marker = bytes.readUInt16BE(offset);
      if (marker === 0xffda) break; // start of scan
      const size = bytes.readUInt16BE(offset + 2);
      offset += 2 + size;
      continue;
    }
    const size = bytes.readUInt16BE(offset + 2);
    const start = offset + 4;
    if (bytes.toString("ascii", start, start + 6) !== "Exif\0\0") return null;
    const tiff = start + 6;
    const endian = bytes.toString("ascii", tiff, tiff + 2);
    const le = endian === "II";
    const readU16 = (o: number) => (le ? bytes.readUInt16LE(o) : bytes.readUInt16BE(o));
    const readU32 = (o: number) => (le ? bytes.readUInt32LE(o) : bytes.readUInt32BE(o));
    const ifd0 = tiff + readU32(tiff + 4);
    const entries0 = readU16(ifd0);
    let exifIfdOffset = 0;
    for (let i = 0; i < entries0; i += 1) {
      const entry = ifd0 + 2 + i * 12;
      const tag = readU16(entry);
      if (tag === 0x8769) {
        exifIfdOffset = tiff + readU32(entry + 8);
        break;
      }
    }
    const readDateFromIfd = (ifd: number) => {
      const count = readU16(ifd);
      for (let i = 0; i < count; i += 1) {
        const entry = ifd + 2 + i * 12;
        const tag = readU16(entry);
        if (tag !== 0x9003 && tag !== 0x0132) continue;
        const valueOffset = entry + 8;
        let dataOffset = readU32(valueOffset);
        dataOffset = tiff + dataOffset;
        const raw = bytes.toString("ascii", dataOffset, dataOffset + 20).replace(/\0/g, "").trim();
        // Format: "YYYY:MM:DD HH:MM:SS"
        const m = raw.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
        if (!m) return null;
        const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? null : d;
      }
      return null;
    };
    if (exifIfdOffset) {
      const d = readDateFromIfd(exifIfdOffset);
      if (d) return d;
    }
    return readDateFromIfd(ifd0);
  }
  return null;
}

function yearFromFilename(name: string | null): number | null {
  if (!name) return null;
  const match = name.match(/(19|20)\d{2}/);
  if (!match) return null;
  const year = Number(match[0]);
  if (year < 1900 || year > 2100) return null;
  return year;
}

function dateFromLastModified(ms?: number | null): Date | null {
  if (!ms || Number.isNaN(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  const now = new Date();
  if (year < 1900 || year > now.getUTCFullYear() + 1) return null;
  return d;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

const LEGACY_FALLBACK_MAX_BYTES = 4 * 1024 * 1024;

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

    const form = await req.formData();
    const files = [
      ...(form.getAll("files").filter(Boolean) as File[]),
      ...(form.getAll("file").filter(Boolean) as File[]),
    ];
    const metaRaw = form.get("meta");
    let metaList: Array<{ createdTime?: string; name?: string; size?: number; type?: string }> = [];
    if (metaRaw) {
      try {
        metaList = JSON.parse(String(metaRaw));
      } catch {
        metaList = [];
      }
    }

    if (!files || files.length === 0) {
      const keys = Array.from(form.keys());
      return NextResponse.json(
        { ok: false, error: "No files uploaded", keys },
        { status: 400 }
      );
    }

    const created: Array<{
      id: string;
      storageUrl: string;
      mimeType: string;
      createdTime: string;
    }> = [];

    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const fileName = file.name || metaList[i]?.name || `photo-${i + 1}`;
      if (!file.size) {
        return NextResponse.json(
          {
            ok: false,
            error: `Selected file "${fileName}" is empty and cannot be uploaded.`,
            fileName,
            sizeBytes: file.size,
          },
          { status: 400 }
        );
      }
      if (file.size > LEGACY_FALLBACK_MAX_BYTES) {
        return NextResponse.json(
          {
            ok: false,
            error:
              `The fallback upload route cannot safely receive "${fileName}" because it is ${formatBytes(file.size)}. Direct Blob upload should handle this file instead.`,
            hint:
              "If you see this message, the direct browser-to-Blob upload failed before fallback. Check BLOB_READ_WRITE_TOKEN, network connectivity, and the /api/photos/import-device/client-upload route.",
            fileName,
            sizeBytes: file.size,
            sizeLimitBytes: LEGACY_FALLBACK_MAX_BYTES,
          },
          { status: 413 }
        );
      }
      const mimeType = file.type || "image/jpeg";
      const bytes = Buffer.from(await file.arrayBuffer());
      const id = crypto.randomUUID();
      const ext = extFromMime(mimeType);

      const blob = await put(`photos/${id}.${ext}`, bytes, {
        access: "public",
        contentType: mimeType,
      });

      const clientCreated = metaList?.[i]?.createdTime
        ? new Date(metaList[i]?.createdTime as string)
        : null;
      const clientDate =
        clientCreated && !Number.isNaN(clientCreated.getTime()) ? clientCreated : null;
      const exifDate = parseExifDate(bytes);
      const filenameYear = yearFromFilename(file.name || "");
      const lastModifiedDate = dateFromLastModified((file as any).lastModified);
      const createdTime = exifDate
        ? exifDate.toISOString()
        : clientDate
        ? clientDate.toISOString()
        : filenameYear
        ? new Date(`${filenameYear}-01-01`).toISOString()
        : lastModifiedDate
        ? lastModifiedDate.toISOString()
        : null;

      created.push({ id, storageUrl: blob.url, mimeType, createdTime: createdTime || "" });
    }

    return NextResponse.json({ ok: true, items: created });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "Device import fallback failed",
        details: String(e?.message || e),
        hint:
          "The app first tries direct browser-to-Blob upload. This fallback is only for small files and diagnostics.",
      },
      { status: 500 }
    );
  }
}
