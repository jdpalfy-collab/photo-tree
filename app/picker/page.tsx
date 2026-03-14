// app/picker/page.tsx
"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { signIn } from "next-auth/react";

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

type Person = {
  id: string;
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  birthYear?: number | null;
};

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
  const [busy, setBusy] = useState(false);
  const [savedToDb, setSavedToDb] = useState(false);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [newPersonDraft, setNewPersonDraft] = useState<{ firstName: string; lastName: string; birthYear: string }>({
    firstName: "",
    lastName: "",
    birthYear: "",
  });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedCount = useMemo(() => items.length, [items]);

  function appendLog(line: string) {
    setLog((prev) => {
      const next = prev === "(logs will appear here)" ? "" : prev;
      return `${next}${next ? "\n" : ""}${line}`;
    });
  }

  function mergeItems(existing: MediaItem[], incoming: MediaItem[]) {
    const map = new Map<string, MediaItem>();
    existing.forEach((it) => map.set(it.id, it));
    incoming.forEach((it) => map.set(it.id, it));
    return Array.from(map.values());
  }

  function clearImportSession() {
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
          await signIn("google");
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
            setItems((prev) => mergeItems(prev, mediaItems));
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
      setItems((prev) => mergeItems(prev, mediaItems));
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

  async function saveSelectedToDb() {
    if (!sessionId) {
      const hasDeviceItems = items.some((it) => !!it.storageUrl);
      if (!hasDeviceItems) {
        appendLog("Missing sessionId. Create a session first.");
        return;
      }
    }
    setBusy(true);
    try {
      appendLog("Saving selected items to DB...");
      const res = await fetch("/api/photos/save-selected", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, meta: metaById, items }),
      });
      const data: any = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data, null, 2));
      appendLog(`Saved to DB: ${JSON.stringify(data)}`);
      setSavedToDb(true);
      if (items.length > 0) setEditPhotoId(items[0].id);
    } catch (e: any) {
      appendLog(`ERROR saving to DB: ${String(e?.message || e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function loadPeople() {
    const r = await fetch("/api/people", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return;
    setPeople(Array.isArray(j?.people) ? j.people : []);
  }

  async function savePhotoMetaToDb(photoId: string, patch: { createdTime?: string; location?: string | null; description?: string | null }) {
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

  async function importFromDevice(files: FileList | null) {
    if (!files || files.length === 0) return;
    setDeviceBusy(true);
    try {
      setSavedToDb(false);
      const exifr = await import("exifr").catch(() => null);
      const metaList = await Promise.all(
        Array.from(files).map(async (file) => {
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
      const form = new FormData();
      Array.from(files).forEach((f) => form.append("files", f));
      form.append("meta", JSON.stringify(metaList));
      const res = await fetch("/api/photos/import-device", {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        appendLog(`Device import failed: ${data?.error || res.statusText}`);
        return;
      }
      const newItems = Array.isArray(data?.items) ? data.items : [];
      const mapped: MediaItem[] = newItems.map((it: any) => ({
        id: it.id,
        createTime: it.createdTime,
        type: "PHOTO",
        storageUrl: it.storageUrl,
        mediaFile: {
          baseUrl: it.storageUrl,
          mimeType: it.mimeType,
          mediaFileMetadata: {},
        },
      }));
      setItems((prev) => mergeItems(prev, mapped));
    } finally {
      setDeviceBusy(false);
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" }}>
      <h1 style={{ margin: 0 }}>Import</h1>

      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {!savedToDb ? (
            <>
              <button onClick={createPickerSession} disabled={busy} style={{ padding: "8px 12px" }}>
                Import From Google Photos
              </button>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  ref={fileInputRef}
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files && files.length > 0) {
                      void importFromDevice(files);
                    }
                    e.currentTarget.value = "";
                  }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={deviceBusy}
                  style={{ padding: "8px 12px" }}
                >
                  {deviceBusy ? "Importing…" : "Import From Device"}
                </button>
              </label>
            </>
          ) : null}
          <span style={{ marginLeft: 12, color: "#555" }}>
            Selected: <b>{selectedCount}</b>
          </span>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {!savedToDb && items.length > 0 ? (
            <button onClick={saveSelectedToDb} disabled={busy} style={{ padding: "8px 12px" }}>
              Save Images to PhotoTree
            </button>
          ) : null}
          {items.length > 0 ? (
            <button onClick={clearImportSession} disabled={busy} style={{ padding: "8px 12px" }}>
              {savedToDb ? (sessionId ? "Done adding details" : "Clear import session") : "Clear import session"}
            </button>
          ) : null}
        </div>
      </div>


      <h2 style={{ marginTop: 18, marginBottom: 10 }}>Selected photos</h2>

      {items.length === 0 ? (
        <div style={{ color: "#666" }}>No items yet.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 16, maxWidth: 1600 }}>
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
              .filter(Boolean)
              .map((p) => displayName(p as Person))
              .join(", ");

            return (
              <div key={it.id} style={{ border: "2px solid #cfe4ff", borderRadius: 12, padding: 10, position: "relative", paddingBottom: 36 }}>
                <div
                  onClick={() => {
                    if (savedToDb) setEditPhotoId(it.id);
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
                    cursor: savedToDb ? "pointer" : "default",
                  }}
                >
                  {thumbSrc ? (
                    <img
                      src={thumbSrc}
                      alt={it.id}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
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
                    color: "#444",
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
                    {tagNames ? <div>{tagNames}</div> : null}
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
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 60,
            padding: 24,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: 16,
              width: "92vw",
              maxWidth: 1100,
              height: "90vh",
              overflow: "auto",
              border: "2px solid #cfe4ff",
            }}
          >
            {(() => {
              const it = items.find((x) => x.id === editPhotoId);
              if (!it) return null;
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
                .filter(Boolean)
                .map((p) => displayName(p as Person))
                .join(", ");

              return (
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontWeight: 600 }}>Edit Photo</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {items.length > 1 ? (
                        <>
                          <button
                            onClick={() => {
                              const idx = items.findIndex((x) => x.id === it.id);
                              const prev = idx <= 0 ? items[items.length - 1].id : items[idx - 1].id;
                              setEditPhotoId(prev);
                            }}
                            style={{ fontSize: 10, padding: "3px 6px", minWidth: 86 }}
                          >
                            Prev photo
                          </button>
                          <button
                            onClick={() => {
                              const idx = items.findIndex((x) => x.id === it.id);
                              const next = idx === -1 ? it.id : items[(idx + 1) % items.length].id;
                              setEditPhotoId(next);
                            }}
                            style={{ fontSize: 10, padding: "3px 6px", minWidth: 86 }}
                          >
                            Next photo
                          </button>
                        </>
                      ) : null}
                      <button onClick={() => setEditPhotoId(null)} style={{ fontSize: 10, padding: "3px 6px" }}>
                        Close
                      </button>
                    </div>
                  </div>
                  {imgSrc ? (
                    <div
                      style={{
                        width: "100%",
                        height: "60vh",
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
                  <div style={{ fontSize: 12, color: "#444", textAlign: "right" }}>
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
                    {tagNames ? <div>{tagNames}</div> : null}
                  </div>
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "nowrap" }}>
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
                          setOpenTags((m) => ({ ...m, [it.id]: !m[it.id] }));
                        }}
                        style={{ fontSize: 10, padding: "3px 6px", minWidth: 78 }}
                      >
                        {openTags[it.id] ? "Hide Tags" : "Tag People"}
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
                          setDateDrafts((m) => {
                            if (m[it.id] !== undefined) {
                              const next = { ...m };
                              delete next[it.id];
                              return next;
                            }
                            return { ...m, [it.id]: year };
                          });
                        }}
                        style={{ fontSize: 10, padding: "3px 6px", minWidth: 78 }}
                      >
                        {dateDrafts[it.id] !== undefined ? "Cancel" : "Edit Date"}
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "nowrap" }}>
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
                          setLocationDrafts((m) => {
                            if (m[it.id] !== undefined) {
                              const next = { ...m };
                              delete next[it.id];
                              return next;
                            }
                            return { ...m, [it.id]: location };
                          });
                        }}
                        style={{ fontSize: 10, padding: "3px 6px", minWidth: 78 }}
                      >
                        {locationDrafts[it.id] !== undefined ? "Cancel" : "Edit Location"}
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
                          setDescriptionDrafts((m) => {
                            if (m[it.id] !== undefined) {
                              const next = { ...m };
                              delete next[it.id];
                              return next;
                            }
                            return { ...m, [it.id]: description };
                          });
                        }}
                        style={{ fontSize: 10, padding: "3px 6px", minWidth: 78 }}
                      >
                        {descriptionDrafts[it.id] !== undefined ? "Cancel" : "Edit Description"}
                      </button>
                    </div>
                  </div>
                  {openTags[it.id] ? (
                    <div style={{ marginTop: 8 }}>
                      {people.length === 0 ? (
                        <div style={{ fontSize: 12, color: "#666" }}>No people yet.</div>
                      ) : (
                        <div style={{ display: "grid", gap: 6 }}>
                          {people.map((person) => {
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
              );
            })()}
          </div>
        </div>
      ) : null}
    </main>
  );
}
