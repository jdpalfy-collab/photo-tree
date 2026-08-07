// app/picker/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Camera, MediaTypeSelection, type GalleryPhoto, type MediaResult } from "@capacitor/camera";
import { Capacitor } from "@capacitor/core";
import { Filesystem } from "@capacitor/filesystem";
import { upload } from "@vercel/blob/client";
import { startPhotoTreeSignIn } from "../lib/mobile-sign-in";

type PickerSession = {
  sessionId: string;
  pickerUri: string;
  expireTime?: string;
};

type StatusResponse = {
  id: string;
  mediaItemsSet?: boolean;
  expireTime?: string;
  pickingConfig?: any;
};

type MediaItem = {
  id: string;
  createTime?: string;
  type?: string;
  storageUrl?: string;
  mediaFile?: {
    baseUrl?: string;
    mimeType?: string;
    mediaFileMetadata?: {
      width?: number;
      height?: number;
    };
  };
};

type DeviceImportItem = {
  id: string;
  storageUrl: string;
  mimeType: string;
  createdTime: string;
  width?: number;
  height?: number;
};

type DeviceImportResult =
  | { ok: true; item: DeviceImportItem }
  | { ok: false; fileLabel: string; message: string };

type Person = {
  id: string;
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  birthYear?: number | null;
};

const DEVICE_UPLOAD_CONCURRENCY = 2;

function normalizeBaseUrl(baseUrl?: string) {
  if (!baseUrl) return "";
  const idx = baseUrl.indexOf("=");
  return idx === -1 ? baseUrl : baseUrl.slice(0, idx);
}

function proxyImgUrl(baseUrl?: string, photoId?: string, w = 600, h = 600) {
  const b = normalizeBaseUrl(baseUrl);
  if (!b) return "";
  if (!b.includes("googleusercontent.com")) return b;
  // IMPORTANT: We load images through our server proxy route so the browser never hits googleusercontent directly.
  // Your proxy route should be: app/api/photos/image/route.ts
  const idParam = photoId ? `&photoId=${encodeURIComponent(photoId)}` : "";
  return `/api/photos/image?src=${encodeURIComponent(b)}${idParam}&w=${w}&h=${h}&cb=${Date.now()}`;
}

function extFromFile(file: File) {
  const nameExt = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() : "";
  if (nameExt && /^[a-z0-9]{2,5}$/.test(nameExt)) return nameExt;
  const mime = file.type.toLowerCase();
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("heic")) return "heic";
  if (mime.includes("heif")) return "heif";
  if (mime.includes("tiff")) return "tif";
  return "jpg";
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

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        if (currentIndex >= items.length) return;
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      }
    })
  );
  return results;
}

async function getImageDimensions(file: File): Promise<{ width?: number; height?: number }> {
  if (!file.type.startsWith("image/")) return {};
  const objectUrl = URL.createObjectURL(file);
  try {
    if ("createImageBitmap" in window) {
      const bitmap = await createImageBitmap(file);
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close?.();
      return dimensions;
    }
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Could not decode selected image"));
      img.src = objectUrl;
    });
    return { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
  } catch {
    return {};
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function imageFormat(format?: string, uri?: string) {
  const uriExtension = uri?.split(/[?#]/)[0].split(".").pop();
  const raw = (format || uriExtension || "jpg").toLowerCase().replace("jpeg", "jpg");
  return /^[a-z0-9]{2,5}$/.test(raw) ? raw : "jpg";
}

function imageMimeType(format: string) {
  if (format === "jpg") return "image/jpeg";
  if (format === "tif") return "image/tiff";
  return `image/${format}`;
}

function blobFromBase64(data: string, mimeType: string) {
  const encoded = data.includes(",") ? data.slice(data.indexOf(",") + 1) : data;
  const binary = atob(encoded.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

async function fileFromGalleryPhoto(photo: GalleryPhoto, index: number) {
  if (!photo.path) {
    throw new Error(`Apple Photos did not return a readable file for photo ${index + 1}.`);
  }

  const format = imageFormat(photo.format, photo.path);
  const mimeType = imageMimeType(format);
  const nativeFile = await Filesystem.readFile({ path: photo.path });
  const blob =
    typeof nativeFile.data === "string"
      ? blobFromBase64(nativeFile.data, mimeType)
      : new Blob([nativeFile.data], { type: nativeFile.data.type || mimeType });

  if (blob.size === 0) {
    throw new Error(`Apple Photos returned an empty file for photo ${index + 1}.`);
  }

  return new File([blob], `device-photo-${Date.now()}-${index + 1}.${format}`, {
    type: blob.type || mimeType,
    lastModified: Date.now(),
  });
}

async function fileFromMediaResult(result: MediaResult, index: number) {
  const createdTime = result.metadata?.creationDate
    ? new Date(result.metadata.creationDate).getTime()
    : Date.now();
  const lastModified = Number.isFinite(createdTime) ? createdTime : Date.now();
  const nativeFormat = imageFormat(result.metadata?.format, result.uri);

  if (result.uri && Capacitor.isPluginAvailable("Filesystem")) {
    try {
      const nativeFile = await Filesystem.readFile({ path: result.uri });
      const mimeType = imageMimeType(nativeFormat);
      const blob =
        typeof nativeFile.data === "string"
          ? blobFromBase64(nativeFile.data, mimeType)
          : new Blob([nativeFile.data], { type: nativeFile.data.type || mimeType });
      if (blob.size > 0) {
        return {
          file: new File([blob], `device-photo-${Date.now()}-${index + 1}.${nativeFormat}`, {
            type: blob.type || mimeType,
            lastModified,
          }),
          usedEmbeddedFallback: false,
        };
      }
    } catch {
      // The embedded picker image below keeps imports working if an iCloud-backed URI expires.
    }
  }

  if (result.thumbnail) {
    const blob = blobFromBase64(result.thumbnail, "image/jpeg");
    if (blob.size > 0) {
      return {
        file: new File([blob], `device-photo-${Date.now()}-${index + 1}.jpg`, {
          type: "image/jpeg",
          lastModified,
        }),
        usedEmbeddedFallback: true,
      };
    }
  }

  throw new Error(`Could not read selected device photo ${index + 1}. Please select it again.`);
}

function fallbackCreatedTime(file: File, exifCreatedTime: string) {
  if (exifCreatedTime) return exifCreatedTime;
  if (file.lastModified && !Number.isNaN(file.lastModified)) {
    const d = new Date(file.lastModified);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return "";
}

export default function PickerPage() {
  const [sessionId, setSessionId] = useState("");
  const [pickerUri, setPickerUri] = useState<string | null>(null);

  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [rawItemsJson, setRawItemsJson] = useState<any>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [editPhotoId, setEditPhotoId] = useState<string | null>(null);
  const [openTags, setOpenTags] = useState<Record<string, boolean>>({});
  const [dateDrafts, setDateDrafts] = useState<Record<string, string>>({});
  const [locationDrafts, setLocationDrafts] = useState<Record<string, string>>({});
  const [descriptionDrafts, setDescriptionDrafts] = useState<Record<string, string>>({});
  const [metaById, setMetaById] = useState<
    Record<string, { year?: string; location?: string; description?: string; personIds?: string[] }>
  >({});

  const [log, setLog] = useState<string>("(logs will appear here)");
  const [importNotice, setImportNotice] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [savedToDb, setSavedToDb] = useState(false);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [newPersonDraft, setNewPersonDraft] = useState<{ firstName: string; lastName: string; birthYear: string }>({
    firstName: "",
    lastName: "",
    birthYear: "",
  });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const editBodyRef = useRef<HTMLDivElement | null>(null);
  const removedItemIdsRef = useRef<Set<string>>(new Set());

  const selectedCount = useMemo(() => items.length, [items]);

  function appendLog(line: string) {
    setLog((prev) => {
      const next = prev === "(logs will appear here)" ? "" : prev;
      return `${next}${next ? "\n" : ""}${line}`;
    });
  }

  function addImportItems(incoming: MediaItem[]) {
    setItems((existing) =>
      mergeItems(existing, incoming).filter((item) => !removedItemIdsRef.current.has(item.id))
    );
  }

  function mergeItems(existing: MediaItem[], incoming: MediaItem[]) {
    const map = new Map<string, MediaItem>();
    existing.forEach((it) => map.set(it.id, it));
    incoming.forEach((it) => map.set(it.id, it));
    return Array.from(map.values());
  }

  function clearImportSession(nextNotice = "") {
    setSessionId("");
    setPickerUri(null);
    setItems([]);
    setRawItemsJson(null);
    setMetaById({});
    setOpenTags({});
    setDateDrafts({});
    setLocationDrafts({});
    setDescriptionDrafts({});
    setSavedToDb(false);
    setEditPhotoId(null);
    removedItemIdsRef.current.clear();
    setImportNotice(nextNotice);
    window.localStorage.removeItem("photoTreePickerState");
  }

  useEffect(() => {
    const stored = window.localStorage.getItem("photoTreePickerState");
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored);
      if (parsed?.sessionId) setSessionId(parsed.sessionId);
      if (parsed?.pickerUri) setPickerUri(parsed.pickerUri);
      if (Array.isArray(parsed?.items)) setItems(parsed.items);
      if (parsed?.rawItemsJson) setRawItemsJson(parsed.rawItemsJson);
      if (parsed?.metaById) setMetaById(parsed.metaById);
      if (parsed?.savedToDb) setSavedToDb(true);
      if (Array.isArray(parsed?.removedItemIds)) {
        removedItemIdsRef.current = new Set(parsed.removedItemIds.filter((id: unknown) => typeof id === "string"));
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (people.length === 0) {
      loadPeople();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (editPhotoId && people.length === 0) {
      loadPeople();
    }
    if (editPhotoId) {
      window.requestAnimationFrame(() => {
        editBodyRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editPhotoId]);

  useEffect(() => {
    if (!editPhotoId) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || (target as any)?.isContentEditable) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        const idx = items.findIndex((x) => x.id === editPhotoId);
        const next = idx === -1 ? editPhotoId : items[(idx + 1) % items.length]?.id;
        if (next) setEditPhotoId(next);
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        const idx = items.findIndex((x) => x.id === editPhotoId);
        const prev = idx <= 0 ? items[items.length - 1]?.id : items[idx - 1]?.id;
        if (prev) setEditPhotoId(prev);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editPhotoId, items]);

  useEffect(() => {
    const payload = {
      sessionId,
      pickerUri,
      items,
      rawItemsJson,
      metaById,
      savedToDb,
      removedItemIds: Array.from(removedItemIdsRef.current),
    };
    window.localStorage.setItem("photoTreePickerState", JSON.stringify(payload));
  }, [sessionId, pickerUri, items, rawItemsJson, metaById, savedToDb]);

  async function createPickerSession() {
    setBusy(true);
    try {
      setStatus(null);
      setRawItemsJson(null);

      appendLog("Creating picker session...");
      const res = await fetch("/api/photos/picker-session", { method: "POST" });
      const data: any = await res.json();
      if (!res.ok) {
        if (res.status === 401 || data?.status === 401) {
          appendLog("Session expired. Redirecting to sign in…");
          await startPhotoTreeSignIn("/picker");
          return;
        }
        throw new Error(JSON.stringify(data, null, 2));
      }

      const s = data as PickerSession;
      setSessionId(s.sessionId);
      setPickerUri(s.pickerUri);

      appendLog(`Picker session created: ${s.sessionId}`);
      appendLog("Opening Google Photos Picker in a new tab…");
      window.open(s.pickerUri, "_blank", "noopener,noreferrer");
      appendLog("After clicking Done in Google Photos, return here to load selections automatically.");

      const start = Date.now();
      const poll = async () => {
        if (Date.now() - start > 1000 * 60 * 5) {
          appendLog("Timed out waiting for selections. Click Check status.");
          setBusy(false);
          return;
        }
        try {
          const resStatus = await fetch(`/api/photos/session?sessionId=${encodeURIComponent(s.sessionId)}`);
          const statusData: any = await resStatus.json();
          if (!resStatus.ok) throw new Error(JSON.stringify(statusData, null, 2));
          setStatus(statusData as StatusResponse);
          if (statusData?.mediaItemsSet) {
            appendLog("Picker done. Loading selected items…");
            const resItems = await fetch(`/api/photos/media-items?sessionId=${encodeURIComponent(s.sessionId)}`);
            const itemsData: any = await resItems.json();
            if (!resItems.ok) throw new Error(JSON.stringify(itemsData, null, 2));
            const mediaItems: MediaItem[] = Array.isArray(itemsData?.mediaItems) ? itemsData.mediaItems : [];
            addImportItems(mediaItems);
            setRawItemsJson(itemsData);
            appendLog(`Loaded ${mediaItems.length} item(s).`);
            if (people.length === 0) loadPeople();
            setBusy(false);
            return;
          }
        } catch (e: any) {
          appendLog(`ERROR checking status: ${String(e?.message || e)}`);
        }
        setTimeout(poll, 3000);
      };
      setTimeout(poll, 3000);
    } catch (e: any) {
      appendLog(`ERROR creating session: ${String(e?.message || e)}`);
    } finally {
      // busy cleared by poll once selections are loaded
    }
  }

  function openPickerNewTab() {
    if (!pickerUri) {
      appendLog("No pickerUri yet. Click “Import From Google Photos” first.");
      return;
    }
    appendLog("Opening Google Photos Picker in a new tab…");
    window.open(pickerUri, "_blank", "noopener,noreferrer");
  }

  async function checkStatus() {
    if (!sessionId) {
      appendLog("Missing sessionId. Create a session first.");
      return;
    }
    setBusy(true);
    try {
      appendLog("Checking status...");
      const res = await fetch(`/api/photos/session?sessionId=${encodeURIComponent(sessionId)}`);
      const data: any = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data, null, 2));
      setStatus(data as StatusResponse);
      appendLog("Status loaded.");
    } catch (e: any) {
      appendLog(`ERROR checking status: ${String(e?.message || e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function listSelectedItems() {
    if (!sessionId) {
      appendLog("Missing sessionId. Create a session first.");
      return;
    }
    setBusy(true);
    try {
      appendLog("Listing selected items...");
      const res = await fetch(`/api/photos/media-items?sessionId=${encodeURIComponent(sessionId)}`);
      const data: any = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data, null, 2));

      const mediaItems: MediaItem[] = Array.isArray(data?.mediaItems) ? data.mediaItems : [];
      addImportItems(mediaItems);
      setRawItemsJson(data);
      if (people.length === 0) {
        loadPeople();
      }
      appendLog(`Loaded ${mediaItems.length} item(s).`);
      if (mediaItems.length === 0) {
        appendLog("If you selected photos, confirm you clicked Done in Google Photos, then click Check status again.");
      }
    } catch (e: any) {
      appendLog(`ERROR listing items: ${String(e?.message || e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveSelectedToDb(options: { finishSession?: boolean } = {}) {
    if (!sessionId) {
      const hasDeviceItems = items.some((it) => !!it.storageUrl);
      if (!hasDeviceItems) {
        appendLog("Missing sessionId. Create a session first.");
        return;
      }
    }
    setBusy(true);
    try {
      setImportNotice("Saving images to PhotoTree...");
      appendLog("Saving selected items to DB...");
      const res = await fetch("/api/photos/save-selected", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, meta: metaById, items }),
      });
      const data: any = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data, null, 2));
      appendLog(`Saved to DB: ${JSON.stringify(data)}`);
      const failedPhotos = Number(data?.failed || 0);
      const failedTags = Number(data?.tagFailed || 0);
      const successNotice =
        failedPhotos || failedTags
          ? `Saved ${data?.saved ?? 0} photo(s) to PhotoTree. ${failedPhotos} photo(s) and ${failedTags} tag set(s) need retry.`
          : `Saved ${data?.saved ?? items.length} photo(s) to PhotoTree.`;
      setImportNotice(successNotice);
      setSavedToDb(true);
      if (options.finishSession) {
        clearImportSession("Import session finished. Photos were saved to PhotoTree.");
        return;
      }
      const firstPhotoId = items[0]?.id;
      if (firstPhotoId) {
        setOpenTags((m) => ({ ...m, [firstPhotoId]: true }));
        setEditPhotoId(firstPhotoId);
      }
    } catch (e: any) {
      const message = `Save failed: ${String(e?.message || e)}`;
      appendLog(`ERROR saving to DB: ${String(e?.message || e)}`);
      setImportNotice(message);
    } finally {
      setBusy(false);
    }
  }

  function continueImportEdit(photoId: string) {
    const idx = items.findIndex((it) => it.id === photoId);
    if (idx >= 0 && idx < items.length - 1) {
      const nextId = items[idx + 1].id;
      setOpenTags((m) => ({ ...m, [nextId]: true }));
      setEditPhotoId(nextId);
      return;
    }
    setEditPhotoId(null);
  }

  function removeImportItem(photoId: string) {
    const currentIndex = items.findIndex((item) => item.id === photoId);
    const remaining = items.filter((item) => item.id !== photoId);
    const nextPhoto = remaining[Math.min(Math.max(currentIndex, 0), Math.max(remaining.length - 1, 0))];
    removedItemIdsRef.current.add(photoId);
    setItems(remaining);
    setMetaById((current) => {
      const next = { ...current };
      delete next[photoId];
      return next;
    });
    setOpenTags((current) => {
      const next = { ...current };
      delete next[photoId];
      return next;
    });
    setDateDrafts((current) => {
      const next = { ...current };
      delete next[photoId];
      return next;
    });
    setLocationDrafts((current) => {
      const next = { ...current };
      delete next[photoId];
      return next;
    });
    setDescriptionDrafts((current) => {
      const next = { ...current };
      delete next[photoId];
      return next;
    });
    if (editPhotoId === photoId) setEditPhotoId(nextPhoto?.id ?? null);
    setImportNotice(
      remaining.length === 0
        ? "Removed the photo. The import session is now empty."
        : `Removed one photo from this import. ${remaining.length} remaining.`
    );
  }

  async function loadPeople() {
    const r = await fetch("/api/people", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return;
    setPeople(Array.isArray(j?.people) ? j.people : []);
  }

  async function savePhotoMetaToDb(
    photoId: string,
    patch: { createdTime?: string; location?: string | null; description?: string | null }
  ) {
    const res = await fetch(`/api/photos/${encodeURIComponent(photoId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    return res.ok;
  }

  async function addTagToDb(photoId: string, personId: string) {
    const res = await fetch(`/api/photos/${encodeURIComponent(photoId)}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personIds: [personId] }),
    });
    return res.ok;
  }

  async function removeTagFromDb(photoId: string, personId: string) {
    const res = await fetch(`/api/photos/${encodeURIComponent(photoId)}/tags?personId=${encodeURIComponent(personId)}`, {
      method: "DELETE",
    });
    return res.ok;
  }

function displayName(p: Person) {
  const full = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
  return full || p.name;
}

function comparePeopleByLastFirst(a: Person, b: Person) {
  const al = (a.lastName || "").toLowerCase();
  const bl = (b.lastName || "").toLowerCase();
  if (al !== bl) return al.localeCompare(bl);
  const af = (a.firstName || "").toLowerCase();
  const bf = (b.firstName || "").toLowerCase();
  if (af !== bf) return af.localeCompare(bf);
  return displayName(a).localeCompare(displayName(b));
}

async function addNewPersonFromImport(photoId: string) {
    const firstName = newPersonDraft.firstName.trim();
    const lastName = newPersonDraft.lastName.trim();
    if (!firstName || !lastName) return;
    const birthYear = newPersonDraft.birthYear.trim();
    const res = await fetch("/api/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName, lastName, birthYear }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      appendLog(`Failed to add person: ${data?.error || res.statusText}`);
      return;
    }
    const newPerson = data?.person as Person;
    if (newPerson?.id) {
      setPeople((prev) => [...prev, newPerson]);
      setMetaById((m) => ({
        ...m,
        [photoId]: {
          ...m[photoId],
          personIds: Array.from(new Set([...(m[photoId]?.personIds || []), newPerson.id])),
        },
      }));
      if (savedToDb) {
        void addTagToDb(photoId, newPerson.id);
      }
      setNewPersonDraft({ firstName: "", lastName: "", birthYear: "" });
    }
  }

  async function importFromDevice(files: File[] | null) {
    if (!files || files.length === 0) return;
    setDeviceBusy(true);
    try {
      setSavedToDb(false);
      setImportNotice(`Preparing ${files.length} device photo(s)...`);
      appendLog(`Preparing ${files.length} device photo(s)...`);
      const exifr = await import("exifr").catch(() => null);
      const metaList = await Promise.all(
        files.map(async (file) => {
          let createdTime = "";
          if (exifr) {
            try {
              const exif: any = await (exifr as any).parse(file, {
                tiff: true,
                exif: true,
                ifd0: true,
              });
              const d =
                exif?.DateTimeOriginal ||
                exif?.CreateDate ||
                exif?.DateTime ||
                exif?.ModifyDate ||
                null;
              if (d instanceof Date && !Number.isNaN(d.getTime())) {
                createdTime = d.toISOString();
              }
            } catch {
              // ignore EXIF parse errors
            }
          }
          return { createdTime };
        })
      );
      let completedUploads = 0;
      const uploadConcurrency = Math.min(DEVICE_UPLOAD_CONCURRENCY, files.length);
      appendLog(
        `Uploading ${files.length} device photo(s) to durable storage, up to ${uploadConcurrency} at a time.`
      );
      const importResults = await mapWithConcurrency<File, DeviceImportResult>(
        files,
        uploadConcurrency,
        async (uploadFile, i) => {
          const fileLabel = uploadFile.name || `photo-${i + 1}`;
          const createdTime = fallbackCreatedTime(uploadFile, metaList[i]?.createdTime || "");
          const dimensionsPromise = getImageDimensions(uploadFile);
          const id =
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `${Date.now()}-${i}-${Math.random().toString(16).slice(2)}`;
          const ext = extFromFile(uploadFile);
          const pathname = `photos/${id}.${ext}`;

          setImportNotice(
            `Uploading device photos (${completedUploads} of ${files.length} complete): ${fileLabel} (${formatBytes(
              uploadFile.size
            )})...`
          );
          appendLog(
            `Uploading device photo ${i + 1}/${files.length}: ${fileLabel}; type=${
              uploadFile.type || "unknown"
            }; size=${formatBytes(uploadFile.size)}.`
          );

          try {
            const blob = await upload(pathname, uploadFile, {
              access: "public",
              contentType: uploadFile.type || "application/octet-stream",
              handleUploadUrl: "/api/photos/import-device/client-upload",
              multipart: true,
              clientPayload: JSON.stringify({
                id,
                name: fileLabel,
                size: uploadFile.size,
                type: uploadFile.type || "",
                createdTime,
              }),
            });
            const dimensions = await dimensionsPromise;
            completedUploads += 1;
            setImportNotice(`Uploaded ${completedUploads} of ${files.length} device photo(s) to durable storage...`);
            return {
              ok: true,
              item: {
                id,
                storageUrl: blob.url,
                mimeType: uploadFile.type || "image/jpeg",
                createdTime,
                width: dimensions.width,
                height: dimensions.height,
              },
            };
          } catch (directError: any) {
            appendLog(`Direct device upload failed for ${fileLabel}: ${String(directError?.message || directError)}`);
          }

          try {
            appendLog(`Retrying ${fileLabel} through legacy upload route...`);
            const form = new FormData();
            form.append("files", uploadFile);
            form.append("meta", JSON.stringify([{ createdTime }]));
            const [dimensions, res] = await Promise.all([
              dimensionsPromise,
              fetch("/api/photos/import-device", {
                method: "POST",
                body: form,
              }),
            ]);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              const details = data?.error || data?.details || res.statusText || "Upload request failed";
              const directDetails =
                data?.hint || "The direct Blob upload failed first, then the server fallback also failed.";
              const message = `${details}. ${directDetails}`;
              appendLog(`Device import failed on photo ${i + 1}: ${message}`);
              completedUploads += 1;
              setImportNotice(`Finished ${completedUploads} of ${files.length} device upload attempt(s)...`);
              return { ok: false, fileLabel, message };
            }
            const imported = Array.isArray(data?.items) ? data.items : [];
            completedUploads += 1;
            setImportNotice(`Uploaded ${completedUploads} of ${files.length} device photo(s) to durable storage...`);
            const importedItem = imported[0];
            if (!importedItem?.id || !importedItem?.storageUrl) {
              return { ok: false, fileLabel, message: "Fallback upload returned no durable storage URL." };
            }
            return {
              ok: true,
              item: {
                id: importedItem.id,
                storageUrl: importedItem.storageUrl,
                mimeType: importedItem.mimeType || uploadFile.type || "image/jpeg",
                createdTime: importedItem.createdTime || createdTime,
                width: importedItem.width ?? dimensions.width,
                height: importedItem.height ?? dimensions.height,
              },
            };
          } catch (legacyError: any) {
            const message = String(legacyError?.message || legacyError);
            appendLog(`Device import failed on photo ${i + 1}: ${message}`);
            completedUploads += 1;
            setImportNotice(`Finished ${completedUploads} of ${files.length} device upload attempt(s)...`);
            return { ok: false, fileLabel, message };
          }
        }
      );
      const newItems = importResults
        .filter((result): result is { ok: true; item: DeviceImportItem } => result.ok)
        .map((result) => result.item);
      const failedImports = importResults.filter(
        (result): result is { ok: false; fileLabel: string; message: string } => !result.ok
      );
      failedImports.forEach((failure) => {
        appendLog(`Device import did not save ${failure.fileLabel}: ${failure.message}`);
      });
      if (newItems.length === 0) {
        appendLog("Device import returned no photos.");
        setImportNotice(
          failedImports.length
            ? `No photos were imported. ${failedImports.length} upload attempt(s) failed.`
            : "Device import returned no photos."
        );
        return;
      }
      appendLog(`Imported ${newItems.length} device photo(s).`);
      setImportNotice(
        failedImports.length
          ? `Imported ${newItems.length} photo(s). ${failedImports.length} could not be uploaded; please retry those.`
          : `Imported ${newItems.length} device photo(s).`
      );
      const mapped: MediaItem[] = newItems.map((it) => ({
        id: it.id,
        createTime: it.createdTime,
        type: "PHOTO",
        storageUrl: it.storageUrl,
        mediaFile: {
          baseUrl: it.storageUrl,
          mimeType: it.mimeType,
          mediaFileMetadata: {
            width: it.width,
            height: it.height,
          },
        },
      }));
      addImportItems(mapped);
      if (people.length === 0) {
        loadPeople();
      }
    } catch (e: any) {
      const message = `Device import failed: ${String(e?.message || e)}`;
      appendLog(message);
      setImportNotice(message);
    } finally {
      setDeviceBusy(false);
    }
  }

  async function choosePhotosFromLibrary() {
    if (!Capacitor.isNativePlatform()) {
      setImportNotice("");
      fileInputRef.current?.click();
      return;
    }

    if (!Capacitor.isPluginAvailable("Camera")) {
      setImportNotice("Install the latest PhotoTree TestFlight build to import from your iPhone photo library.");
      return;
    }

    setDeviceBusy(true);
    setImportNotice("Opening your photo library...");
    try {
      if (Capacitor.isPluginAvailable("Filesystem")) {
        const selection = await Camera.pickImages({
          limit: 0,
          quality: 100,
          correctOrientation: true,
          presentationStyle: "fullscreen",
        });
        if (selection.photos.length === 0) {
          setImportNotice("");
          return;
        }

        const files: File[] = [];
        for (let index = 0; index < selection.photos.length; index += 1) {
          setImportNotice(`Reading selected photo ${index + 1} of ${selection.photos.length}...`);
          files.push(await fileFromGalleryPhoto(selection.photos[index], index));
        }
        appendLog(`Selected ${files.length} photo(s) with the Apple system photo picker.`);
        await importFromDevice(files);
        return;
      }

      const selection = await Camera.chooseFromGallery({
        mediaType: MediaTypeSelection.Photo,
        allowMultipleSelection: true,
        limit: 0,
        quality: 100,
        includeMetadata: true,
        presentationStyle: "fullscreen",
      });
      if (selection.results.length === 0) {
        setImportNotice("");
        return;
      }
      const files: File[] = [];
      let embeddedFallbackCount = 0;
      for (let index = 0; index < selection.results.length; index += 1) {
        setImportNotice(`Reading selected photo ${index + 1} of ${selection.results.length}...`);
        const converted = await fileFromMediaResult(selection.results[index], index);
        files.push(converted.file);
        if (converted.usedEmbeddedFallback) embeddedFallbackCount += 1;
      }
      if (embeddedFallbackCount > 0) {
        appendLog(
          `Used the Photos picker data for ${embeddedFallbackCount} photo(s) instead of an unreadable temporary iOS URL.`
        );
      }
      await importFromDevice(files);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (/cancel/i.test(message)) {
        setImportNotice("");
      } else if (/not implemented|not available|unavailable/i.test(message)) {
        setImportNotice("Install the latest PhotoTree TestFlight build to import from your iPhone photo library.");
      } else {
        appendLog(`Photo library selection failed: ${message}`);
        setImportNotice(`Photo library selection failed: ${message}`);
      }
    } finally {
      setDeviceBusy(false);
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" }}>
      <h1 className="mobile-route-title" style={{ margin: 0 }}>Import</h1>

      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {!savedToDb ? (
            <>
              <button onClick={createPickerSession} disabled={busy} style={{ padding: "8px 12px" }}>
                Import From Google Photos
              </button>
              <input
                type="file"
                multiple
                accept="image/*"
                ref={fileInputRef}
                style={{ display: "none" }}
                onChange={(e) => {
                  const files = e.target.files;
                  if (files && files.length > 0) {
                    const list = Array.from(files);
                    void importFromDevice(list);
                  }
                  e.currentTarget.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => void choosePhotosFromLibrary()}
                disabled={deviceBusy}
                style={{ padding: "8px 12px" }}
              >
                {deviceBusy ? "Importing…" : "Import From Device"}
              </button>
            </>
          ) : null}
          <span style={{ marginLeft: 12, color: "#555" }}>
            Selected: <b>{selectedCount}</b>
          </span>
        </div>
        {importNotice ? (
          <div style={{ color: importNotice.includes("failed") ? "#991b1b" : "#065f46", fontSize: 14 }}>
            {importNotice}
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {items.length > 0 ? (
            <button
              onClick={() => clearImportSession()}
              disabled={busy}
              style={{
                padding: "8px 12px",
                background: "#dc2626",
                borderColor: "#dc2626",
              }}
            >
              Clear import session
            </button>
          ) : null}
          {items.length > 0 ? (
            <button
              onClick={() => void saveSelectedToDb({ finishSession: savedToDb })}
              disabled={busy}
              style={{
                padding: "8px 12px",
                background: "#16a34a",
                borderColor: "#16a34a",
                color: "#fff",
              }}
            >
              {busy
                ? "Saving..."
                : savedToDb
                ? "Finish Import Session"
                : "Save to PhotoTree"}
            </button>
          ) : null}
        </div>
      </div>


      <h2 style={{ marginTop: 18, marginBottom: 10 }}>Selected photos</h2>

      {items.length === 0 ? (
        <div style={{ color: "#666" }}>No items yet.</div>
      ) : (
        <div className="mobile-card-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 16, maxWidth: 1600 }}>
          {items.map((it) => {
            const baseUrl = it.mediaFile?.baseUrl;
            const thumbSrc = proxyImgUrl(baseUrl, it.id, 700, 700);
            const created = it.createTime ? new Date(it.createTime).toISOString().slice(0, 10) : "";
            const createdYear = created ? created.slice(0, 4) : "";
            const meta = metaById[it.id] || {};
            const year = meta.year ?? createdYear;
            const location = meta.location ?? "";
            const description = meta.description ?? "";
            const personIds = meta.personIds ?? [];
            const tagNames = personIds
              .map((pid) => people.find((p) => p.id === pid))
              .filter((person): person is Person => !!person)
              .sort(comparePeopleByLastFirst)
              .map((p) => displayName(p as Person));

            return (
              <div key={it.id} className="mobile-list-card" style={{ border: "2px solid #cfe4ff", borderRadius: 12, padding: 10, position: "relative", paddingBottom: 36 }}>
                {!savedToDb ? (
                  <button
                    type="button"
                    className="import-photo-remove"
                    aria-label="Remove photo from import"
                    title="Remove from import"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeImportItem(it.id);
                    }}
                  >
                    -
                  </button>
                ) : null}
                <div
                  onClick={() => {
                    setEditPhotoId(it.id);
                  }}
                  style={{
                    width: "100%",
                    aspectRatio: "1 / 1",
                    background: "#fafafa",
                    border: "2px solid #dbeafe",
                    borderRadius: 10,
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                  }}
                >
                  {thumbSrc ? (
                    <img
                      src={thumbSrc}
                      alt={it.id}
                      style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                    />
                  ) : (
                    <div style={{ padding: 12, color: "#999", fontSize: 12 }}>No baseUrl</div>
                  )}
                </div>

                <div
                  style={{
                    marginTop: 6,
                    fontSize: 18,
                    fontWeight: 700,
                    color: "#374151",
                    minHeight: 86,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                  }}
                >
                  <div style={{ textAlign: "center", minHeight: 26 }}>{description ? <i>“{description}”</i> : null}</div>
                  <div style={{ textAlign: "right" }}>
                    {location || year ? (
                      <div>
                        {location ? location : ""}
                        {location && year ? ", " : ""}
                        {year || ""}
                      </div>
                    ) : null}
                    {tagNames.length > 0 ? (
                      <div className="mobile-photo-card-names">
                        {tagNames.map((name, index) => (
                          <span className="mobile-photo-name-token" key={name}>
                            {name}
                            {index < tagNames.length - 1 ? "," : null}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div style={{ position: "absolute", right: 10, top: 8 }}>
                  {savedToDb ? (
                    <button
                      onClick={() => setEditPhotoId(it.id)}
                      style={{ fontSize: 10, padding: "3px 6px", minWidth: 78 }}
                    >
                      Edit
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Logs/UI sections removed by request */}

      {editPhotoId ? (
        <div
          onClick={() => setEditPhotoId(null)}
          style={{
            position: "fixed",
            top: "var(--mobile-header-height, 0px)",
            left: 0,
            right: 0,
            bottom: "var(--mobile-tab-bar-height, 0px)",
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 60,
            padding: 8,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="photo-edit-modal"
            style={{
              background: "#fff",
              borderRadius: 12,
              width: "92vw",
              maxWidth: 760,
              height: "min(68vh, 560px)",
              overflow: "hidden",
              border: "2px solid #cfe4ff",
              display: "grid",
              gridTemplateRows: "auto 1fr auto",
            }}
          >
            {(() => {
              const it = items.find((x) => x.id === editPhotoId);
              if (!it) return null;
              const currentIndex = items.findIndex((x) => x.id === it.id);
              const isLastPhoto = currentIndex === -1 || currentIndex === items.length - 1;
              const baseUrl = it.mediaFile?.baseUrl;
              const imgSrc = proxyImgUrl(baseUrl, it.id, 1200, 1200);
              const created = it.createTime ? new Date(it.createTime).toISOString().slice(0, 10) : "";
              const createdYear = created ? created.slice(0, 4) : "";
              const meta = metaById[it.id] || {};
              const year = meta.year ?? createdYear;
              const location = meta.location ?? "";
              const description = meta.description ?? "";
              const personIds = meta.personIds ?? [];
              const tagNames = personIds
                .map((pid) => people.find((p) => p.id === pid))
                .filter((person): person is Person => !!person)
                .sort(comparePeopleByLastFirst)
                .map((p) => displayName(p as Person));
              const activeDetail =
                openTags[it.id]
                  ? "tags"
                  : dateDrafts[it.id] !== undefined
                  ? "date"
                  : locationDrafts[it.id] !== undefined
                  ? "location"
                  : descriptionDrafts[it.id] !== undefined
                  ? "description"
                  : "";
              const detailButtonStyle = (active: boolean): React.CSSProperties => ({
                fontSize: 10,
                padding: "3px 6px",
                minWidth: 0,
                width: "100%",
                background: active ? "#3b82f6" : "#8abfff",
                borderColor: active ? "#3b82f6" : "#8abfff",
                color: "#fff",
              });

              return (
                <>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                      padding: "7px 10px",
                      borderBottom: "1px solid #e5e7eb",
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      Edit Photo {currentIndex >= 0 ? `${currentIndex + 1}/${items.length}` : ""}
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {!savedToDb ? (
                        <button
                          type="button"
                          className="import-photo-remove import-photo-remove--inline"
                          aria-label="Remove photo from import"
                          title="Remove from import"
                          onClick={() => removeImportItem(it.id)}
                        >
                          -
                        </button>
                      ) : null}
                      {items.length > 1 ? (
                        <>
                          <button
                            onClick={() => {
                              const idx = items.findIndex((x) => x.id === it.id);
                              const prev = idx <= 0 ? items[items.length - 1].id : items[idx - 1].id;
                              setEditPhotoId(prev);
                            }}
                            style={{ fontSize: 10, padding: "3px 6px", minWidth: 64 }}
                          >
                            Prev
                          </button>
                          <button
                            onClick={() => {
                              const idx = items.findIndex((x) => x.id === it.id);
                              const next = idx === -1 ? it.id : items[(idx + 1) % items.length].id;
                              setEditPhotoId(next);
                            }}
                            style={{ fontSize: 10, padding: "3px 6px", minWidth: 64 }}
                          >
                            Next
                          </button>
                        </>
                      ) : null}
                      <button onClick={() => setEditPhotoId(null)} style={{ fontSize: 10, padding: "3px 6px" }}>
                        Close
                      </button>
                    </div>
                  </div>
                  <div ref={editBodyRef} style={{ overflowY: "auto", padding: 10, display: "grid", gap: 6 }}>
                  {imgSrc ? (
                    <div
                      className="photo-edit-image"
                      style={{
                        width: "100%",
                        height: "18vh",
                        minHeight: 115,
                        maxHeight: 165,
                        borderRadius: 10,
                        overflow: "hidden",
                        background: "#f8fafc",
                        border: "2px solid #e2e8f0",
                      }}
                    >
                      <img
                        src={imgSrc}
                        alt={it.id}
                        style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                      />
                    </div>
                  ) : null}
                  <div className="photo-edit-meta" style={{ fontSize: 12, color: "#374151", textAlign: "right" }}>
                    {description ? (
                      <div>
                        <i>“{description}”</i>
                      </div>
                    ) : null}
                    {location || year ? (
                      <div>
                        {location ? location : ""}
                        {location && year ? ", " : ""}
                        {year || ""}
                      </div>
                    ) : null}
                    {tagNames.length > 0 ? (
                      <div className="mobile-photo-card-names">
                        {tagNames.map((name, index) => (
                          <span className="mobile-photo-name-token" key={name}>
                            {name}
                            {index < tagNames.length - 1 ? "," : null}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6 }}>
                      <button
                        onClick={() => {
                          setDateDrafts((m) => {
                            const next = { ...m };
                            delete next[it.id];
                            return next;
                          });
                          setLocationDrafts((m) => {
                            const next = { ...m };
                            delete next[it.id];
                            return next;
                          });
                          setDescriptionDrafts((m) => {
                            const next = { ...m };
                            delete next[it.id];
                            return next;
                          });
                          setOpenTags((m) => ({ ...m, [it.id]: true }));
                        }}
                        style={detailButtonStyle(activeDetail === "tags")}
                      >
                        Tag People
                      </button>
                      <button
                        onClick={() => {
                          setOpenTags((m) => ({ ...m, [it.id]: false }));
                          setLocationDrafts((m) => {
                            const next = { ...m };
                            delete next[it.id];
                            return next;
                          });
                          setDescriptionDrafts((m) => {
                            const next = { ...m };
                            delete next[it.id];
                            return next;
                          });
                          setDateDrafts((m) => ({ ...m, [it.id]: year }));
                        }}
                        style={detailButtonStyle(activeDetail === "date")}
                      >
                        Edit Date
                      </button>
                      <button
                        onClick={() => {
                          setOpenTags((m) => ({ ...m, [it.id]: false }));
                          setDateDrafts((m) => {
                            const next = { ...m };
                            delete next[it.id];
                            return next;
                          });
                          setDescriptionDrafts((m) => {
                            const next = { ...m };
                            delete next[it.id];
                            return next;
                          });
                          setLocationDrafts((m) => ({ ...m, [it.id]: location }));
                        }}
                        style={detailButtonStyle(activeDetail === "location")}
                      >
                        Edit Location
                      </button>
                      <button
                        onClick={() => {
                          setOpenTags((m) => ({ ...m, [it.id]: false }));
                          setDateDrafts((m) => {
                            const next = { ...m };
                            delete next[it.id];
                            return next;
                          });
                          setLocationDrafts((m) => {
                            const next = { ...m };
                            delete next[it.id];
                            return next;
                          });
                          setDescriptionDrafts((m) => ({ ...m, [it.id]: description }));
                        }}
                        style={detailButtonStyle(activeDetail === "description")}
                      >
                        Edit Description
                      </button>
                    </div>
                  </div>
                  {openTags[it.id] ? (
                    <div style={{ marginTop: 8 }}>
                      {people.length === 0 ? (
                        <div style={{ fontSize: 12, color: "#666" }}>No people yet.</div>
                      ) : (
                        <div style={{ display: "grid", gap: 6 }}>
                          {[...people]
                            .sort((a, b) => {
                              const al = (a.lastName || "").toLowerCase();
                              const bl = (b.lastName || "").toLowerCase();
                              if (al !== bl) return al.localeCompare(bl);
                              const af = (a.firstName || "").toLowerCase();
                              const bf = (b.firstName || "").toLowerCase();
                              if (af !== bf) return af.localeCompare(bf);
                              return (a.name || "").localeCompare(b.name || "");
                            })
                            .map((person) => {
                            const checked = personIds.includes(person.id);
                            return (
                              <label key={person.id} style={{ display: "flex", gap: 8, fontSize: 12 }}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const next = e.target.checked
                                      ? [...personIds, person.id]
                                      : personIds.filter((id) => id !== person.id);
                                    setMetaById((m) => ({
                                      ...m,
                                      [it.id]: { ...m[it.id], personIds: next },
                                    }));
                                    if (savedToDb) {
                                      if (e.target.checked) {
                                        void addTagToDb(it.id, person.id);
                                      } else {
                                        void removeTagFromDb(it.id, person.id);
                                      }
                                    }
                                  }}
                                />
                                <span>{displayName(person)}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #e5e7eb" }}>
                        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Add new person</div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <input
                            placeholder="First name"
                            value={newPersonDraft.firstName}
                            onChange={(e) => setNewPersonDraft((d) => ({ ...d, firstName: e.target.value }))}
                            style={{ fontSize: 10, padding: "3px 6px", width: 120 }}
                          />
                          <input
                            placeholder="Last name"
                            value={newPersonDraft.lastName}
                            onChange={(e) => setNewPersonDraft((d) => ({ ...d, lastName: e.target.value }))}
                            style={{ fontSize: 10, padding: "3px 6px", width: 120 }}
                          />
                          <input
                            placeholder="Birth year"
                            value={newPersonDraft.birthYear}
                            onChange={(e) => setNewPersonDraft((d) => ({ ...d, birthYear: e.target.value }))}
                            style={{ fontSize: 10, padding: "3px 6px", width: 90 }}
                          />
                          <button
                            onClick={() => addNewPersonFromImport(it.id)}
                            style={{ fontSize: 10, padding: "3px 6px", minWidth: 90 }}
                          >
                            Add person
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {dateDrafts[it.id] !== undefined ? (
                    <div style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <input
                        type="number"
                        inputMode="numeric"
                        min="1000"
                        max="9999"
                        value={dateDrafts[it.id] ?? year}
                        onChange={(e) => setDateDrafts((m) => ({ ...m, [it.id]: e.target.value }))}
                        placeholder="Year"
                        style={{ fontSize: 10, padding: "3px 6px", width: 90 }}
                      />
                      <button
                        onClick={() => {
                          const val = (dateDrafts[it.id] ?? "").trim();
                          const apply = () => {
                            setMetaById((m) => ({
                              ...m,
                              [it.id]: { ...m[it.id], year: val || undefined },
                            }));
                            setDateDrafts((m) => {
                              const next = { ...m };
                              delete next[it.id];
                              return next;
                            });
                          };
                          if (savedToDb) {
                            const payload = val ? { createdTime: `${val}-01-01` } : { createdTime: "" };
                            void savePhotoMetaToDb(it.id, payload).then((ok) => {
                              if (ok) apply();
                            });
                          } else {
                            apply();
                          }
                        }}
                        style={{ fontSize: 10, padding: "3px 6px", minWidth: 78 }}
                      >
                        Save Date
                      </button>
                    </div>
                  ) : null}
                  {locationDrafts[it.id] !== undefined ? (
                    <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
                      <input
                        type="text"
                        value={locationDrafts[it.id] ?? ""}
                        onChange={(e) => setLocationDrafts((m) => ({ ...m, [it.id]: e.target.value }))}
                        placeholder="Location"
                        style={{ fontSize: 10, padding: "3px 6px" }}
                      />
                      <button
                        onClick={() => {
                          const val = locationDrafts[it.id] ?? "";
                          const apply = () => {
                            setMetaById((m) => ({ ...m, [it.id]: { ...m[it.id], location: val } }));
                            setLocationDrafts((m) => {
                              const next = { ...m };
                              delete next[it.id];
                              return next;
                            });
                          };
                          if (savedToDb) {
                            void savePhotoMetaToDb(it.id, { location: val }).then((ok) => {
                              if (ok) apply();
                            });
                          } else {
                            apply();
                          }
                        }}
                        style={{ fontSize: 10, padding: "3px 6px", minWidth: 78, width: "fit-content" }}
                      >
                        Save Location
                      </button>
                    </div>
                  ) : null}
                  {descriptionDrafts[it.id] !== undefined ? (
                    <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
                      <textarea
                        value={descriptionDrafts[it.id] ?? ""}
                        onChange={(e) => setDescriptionDrafts((m) => ({ ...m, [it.id]: e.target.value }))}
                        placeholder="Event description"
                        rows={2}
                        style={{ fontSize: 10, padding: "3px 6px", resize: "vertical" }}
                      />
                      <button
                        onClick={() => {
                          const val = descriptionDrafts[it.id] ?? "";
                          const apply = () => {
                            setMetaById((m) => ({ ...m, [it.id]: { ...m[it.id], description: val } }));
                            setDescriptionDrafts((m) => {
                              const next = { ...m };
                              delete next[it.id];
                              return next;
                            });
                          };
                          if (savedToDb) {
                            void savePhotoMetaToDb(it.id, { description: val }).then((ok) => {
                              if (ok) apply();
                            });
                          } else {
                            apply();
                          }
                        }}
                        style={{ fontSize: 10, padding: "3px 6px", minWidth: 78, width: "fit-content" }}
                      >
                        Save Description
                      </button>
                    </div>
                  ) : null}
                  </div>
                  <div
                    style={{
                      padding: 10,
                      borderTop: "1px solid #e5e7eb",
                      display: "flex",
                      gap: 8,
                      justifyContent: "space-between",
                      alignItems: "center",
                      background: "#fff",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => void continueImportEdit(it.id)}
                      style={{
                        flex: 1,
                        padding: "9px 12px",
                        background: "#16a34a",
                        borderColor: "#16a34a",
                        color: "#fff",
                      }}
                    >
                      {isLastPhoto ? "Finish details" : "Continue"}
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      ) : null}
    </main>
  );
}
