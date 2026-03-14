// app/saved/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useEditingMode } from "../providers";
import React from "react";

type Photo = {
  id: string;
  baseUrl: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  createdTime: string | null;
  createdAt: string;
  localPath?: string | null;
  storageUrl?: string | null;
  location?: string | null;
  description?: string | null;
  rotation?: number | null;
  cropX?: number | null;
  cropY?: number | null;
  cropW?: number | null;
  cropH?: number | null;
};

type Person = {
  id: string;
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  birthYear: number | null;
};

type Tag = {
  id: string;
  personId: string;
  person: Person;
};

function proxyImgUrl(baseUrl: string, photoId: string, w = 700, h = 700) {
  // your proxy route expects google baseUrl as src
  return `/api/photos/image?src=${encodeURIComponent(baseUrl)}&photoId=${encodeURIComponent(
    photoId
  )}&w=${w}&h=${h}&cb=${Date.now()}`;
}

function displayName(p: Person) {
  const full = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
  return full || p.name;
}

function imageTransform(p: Photo) {
  const rotate = p.rotation ?? 0;
  return rotate
    ? ({ transformOrigin: "center", transform: `rotate(${rotate}deg)` } as React.CSSProperties)
    : ({} as React.CSSProperties);
}

export default function SavedPage() {
  const { mode } = useEditingMode();
  const isEditing = mode === "editing";
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [err, setErr] = useState<string>("");
  const [cacheBusy, setCacheBusy] = useState(false);
  const [cacheMsg, setCacheMsg] = useState<string>("");
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const [people, setPeople] = useState<Person[]>([]);
  const [openTags, setOpenTags] = useState<Record<string, boolean>>({});
  const [editPhotoId, setEditPhotoId] = useState<string | null>(null);
  const [tagsByPhoto, setTagsByPhoto] = useState<Record<string, Tag[]>>({});
  const [tagLoading, setTagLoading] = useState<Record<string, boolean>>({});
  const [tagError, setTagError] = useState<Record<string, string>>({});
  const [sortMode, setSortMode] = useState<"chronological" | "recent">("recent");
  const [dateDrafts, setDateDrafts] = useState<Record<string, string>>({});
  const [dateSaving, setDateSaving] = useState<Record<string, boolean>>({});
  const [dateError, setDateError] = useState<Record<string, string>>({});
  const [selectedWith, setSelectedWith] = useState<Record<string, boolean>>({});
  const [locationDrafts, setLocationDrafts] = useState<Record<string, string>>({});
  const [locationSaving, setLocationSaving] = useState<Record<string, boolean>>({});
  const [locationError, setLocationError] = useState<Record<string, string>>({});
  const [descriptionDrafts, setDescriptionDrafts] = useState<Record<string, string>>({});
  const [descriptionSaving, setDescriptionSaving] = useState<Record<string, boolean>>({});
  const [descriptionError, setDescriptionError] = useState<Record<string, string>>({});
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [newPersonDraft, setNewPersonDraft] = useState<{ firstName: string; lastName: string; birthYear: string }>({
    firstName: "",
    lastName: "",
    birthYear: "",
  });
  const [cropMode, setCropMode] = useState<Record<string, boolean>>({});
  const [cropDrafts, setCropDrafts] = useState<Record<string, { x: number; y: number; w: number; h: number }>>({});
  const cropDragRef = React.useRef<{
    photoId: string | null;
    mode: "move" | "nw" | "ne" | "sw" | "se" | null;
    startX: number;
    startY: number;
    rect: DOMRect | null;
    start: { x: number; y: number; w: number; h: number };
  }>({ photoId: null, mode: null, startX: 0, startY: 0, rect: null, start: { x: 0, y: 0, w: 1, h: 1 } });

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const drag = cropDragRef.current;
      if (!drag.photoId || !drag.rect || !drag.mode) return;
      const rect = drag.rect;
      const dx = (e.clientX - drag.startX) / rect.width;
      const dy = (e.clientY - drag.startY) / rect.height;
      const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
      let { x, y, w, h } = drag.start;
      if (drag.mode === "move") {
        x = clamp(x + dx, 0, 1 - w);
        y = clamp(y + dy, 0, 1 - h);
      } else {
        if (drag.mode.includes("n")) {
          const ny = clamp(y + dy, 0, y + h - 0.05);
          h = h + (y - ny);
          y = ny;
        }
        if (drag.mode.includes("s")) {
          h = clamp(h + dy, 0.05, 1 - y);
        }
        if (drag.mode.includes("w")) {
          const nx = clamp(x + dx, 0, x + w - 0.05);
          w = w + (x - nx);
          x = nx;
        }
        if (drag.mode.includes("e")) {
          w = clamp(w + dx, 0.05, 1 - x);
        }
      }
      setCropDrafts((m) => ({ ...m, [drag.photoId as string]: { x, y, w, h } }));
    }
    function onUp() {
      if (cropDragRef.current.photoId) {
        cropDragRef.current = { photoId: null, mode: null, startX: 0, startY: 0, rect: null, start: { x: 0, y: 0, w: 1, h: 1 } };
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  async function load() {
    setErr("");
    const r = await fetch("/api/photos/saved", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErr(JSON.stringify(j, null, 2));
      setPhotos([]);
      return;
    }
    setPhotos(Array.isArray(j?.photos) ? j.photos : []);
  }

  async function loadPeople() {
    const r = await fetch("/api/people", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return;
    setPeople(Array.isArray(j?.people) ? j.people : []);
  }

  async function cacheMissing() {
    setCacheMsg("");
    setCacheBusy(true);
    try {
      const r = await fetch("/api/photos/cache-missing", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(JSON.stringify(j, null, 2));
        return;
      }
      setCacheMsg(`Cached ${j?.cached ?? 0} of ${j?.scanned ?? 0} missing photos.`);
      await load();
    } finally {
      setCacheBusy(false);
    }
  }

  async function loadTags(photoId: string) {
    setTagError((m) => ({ ...m, [photoId]: "" }));
    setTagLoading((m) => ({ ...m, [photoId]: true }));
    try {
      const r = await fetch(`/api/photos/${photoId}/tags`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setTagError((m) => ({ ...m, [photoId]: JSON.stringify(j) }));
        return;
      }
      setTagsByPhoto((m) => ({ ...m, [photoId]: Array.isArray(j?.tags) ? j.tags : [] }));
    } finally {
      setTagLoading((m) => ({ ...m, [photoId]: false }));
    }
  }

  async function toggleTag(photoId: string, personId: string, checked: boolean) {
    setTagError((m) => ({ ...m, [photoId]: "" }));
    if (checked) {
      const r = await fetch(`/api/photos/${photoId}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personIds: [personId] }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setTagError((m) => ({ ...m, [photoId]: JSON.stringify(j) }));
        return;
      }
    } else {
      const r = await fetch(`/api/photos/${photoId}/tags?personId=${encodeURIComponent(personId)}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setTagError((m) => ({ ...m, [photoId]: JSON.stringify(j) }));
        return;
      }
    }
    await loadTags(photoId);
  }

  async function addNewPersonFromEdit(photoId: string) {
    const firstName = newPersonDraft.firstName.trim();
    const lastName = newPersonDraft.lastName.trim();
    if (!firstName || !lastName) return;
    const birthYear = newPersonDraft.birthYear.trim();
    const r = await fetch("/api/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName, lastName, birthYear }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return;
    const newPerson = j?.person as Person;
    if (!newPerson?.id) return;
    setPeople((prev) => [...prev, newPerson]);
    await toggleTag(photoId, newPerson.id, true);
    setNewPersonDraft({ firstName: "", lastName: "", birthYear: "" });
  }

  async function saveDate(photoId: string) {
    const draft = dateDrafts[photoId];
    if (draft === undefined) return;
    setDateSaving((m) => ({ ...m, [photoId]: true }));
    setDateError((m) => ({ ...m, [photoId]: "" }));
    try {
      const year = String(draft).trim();
      if (year === "") {
        const r = await fetch(`/api/photos/${photoId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ createdTime: "" }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          setDateError((m) => ({ ...m, [photoId]: JSON.stringify(j) }));
          return;
        }
        setDateDrafts((m) => {
          const next = { ...m };
          delete next[photoId];
          return next;
        });
        await load();
        return;
      }
      if (!/^\d{4}$/.test(year)) {
        setDateError((m) => ({ ...m, [photoId]: "Year must be 4 digits." }));
        return;
      }
      const createdTime = `${year}-01-01`;
      const r = await fetch(`/api/photos/${photoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ createdTime }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setDateError((m) => ({ ...m, [photoId]: JSON.stringify(j) }));
        return;
      }
      setDateDrafts((m) => {
        const next = { ...m };
        delete next[photoId];
        return next;
      });
      await load();
    } finally {
      setDateSaving((m) => ({ ...m, [photoId]: false }));
    }
  }

  async function saveLocation(photoId: string) {
    const draft = locationDrafts[photoId];
    if (draft === undefined) return;
    setLocationSaving((m) => ({ ...m, [photoId]: true }));
    setLocationError((m) => ({ ...m, [photoId]: "" }));
    try {
      const r = await fetch(`/api/photos/${photoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location: draft }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setLocationError((m) => ({ ...m, [photoId]: JSON.stringify(j) }));
        return;
      }
      setLocationDrafts((m) => {
        const next = { ...m };
        delete next[photoId];
        return next;
      });
      await load();
    } finally {
      setLocationSaving((m) => ({ ...m, [photoId]: false }));
    }
  }

  async function saveDescription(photoId: string) {
    const draft = descriptionDrafts[photoId];
    if (draft === undefined) return;
    setDescriptionSaving((m) => ({ ...m, [photoId]: true }));
    setDescriptionError((m) => ({ ...m, [photoId]: "" }));
    try {
      const r = await fetch(`/api/photos/${photoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: draft }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setDescriptionError((m) => ({ ...m, [photoId]: JSON.stringify(j) }));
        return;
      }
      setDescriptionDrafts((m) => {
        const next = { ...m };
        delete next[photoId];
        return next;
      });
      await load();
    } finally {
      setDescriptionSaving((m) => ({ ...m, [photoId]: false }));
    }
  }

  async function saveAllEdits(photoId: string) {
    if (dateDrafts[photoId] !== undefined) {
      await saveDate(photoId);
    }
    if (locationDrafts[photoId] !== undefined) {
      await saveLocation(photoId);
    }
    if (descriptionDrafts[photoId] !== undefined) {
      await saveDescription(photoId);
    }
  }

  function cancelEdits(photoId: string) {
    setDateDrafts((m) => {
      const next = { ...m };
      delete next[photoId];
      return next;
    });
    setLocationDrafts((m) => {
      const next = { ...m };
      delete next[photoId];
      return next;
    });
    setDescriptionDrafts((m) => {
      const next = { ...m };
      delete next[photoId];
      return next;
    });
  }

  async function rotatePhoto(photoId: string, current: number | null | undefined) {
    const next = ((current ?? 0) + 90) % 360;
    const r = await fetch(`/api/photos/${photoId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rotation: next }),
    });
    if (r.ok) {
      await load();
    } else {
      const j = await r.json().catch(() => ({}));
      setErr(JSON.stringify(j, null, 2));
    }
  }

  async function deletePhoto(photoId: string) {
    const ok = confirm("Delete this photo? This cannot be undone.");
    if (!ok) return;
    const r = await fetch(`/api/photos/${photoId}`, { method: "DELETE" });
    if (r.ok) {
      setEditPhotoId(null);
      await load();
      return;
    }
    const j = await r.json().catch(() => ({}));
    setErr(JSON.stringify(j, null, 2));
  }

  useEffect(() => {
    load();
    loadPeople();
  }, []);

  useEffect(() => {
    if (photos.length === 0) return;
    photos.forEach((p) => {
      if (!tagsByPhoto[p.id]) {
        loadTags(p.id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos.length]);

  const displayPhotos = [...photos]
    .sort((a, b) => {
      const ta = a.createdTime ? new Date(a.createdTime).getTime() : Infinity;
      const tb = b.createdTime ? new Date(b.createdTime).getTime() : Infinity;
      if (sortMode === "recent") {
        const ra = a.createdTime ? new Date(a.createdTime).getTime() : -Infinity;
        const rb = b.createdTime ? new Date(b.createdTime).getTime() : -Infinity;
        return rb - ra;
      }
      return ta - tb;
    })
    .filter((p) => {
      const required = Object.keys(selectedWith).filter((k) => selectedWith[k]);
      if (required.length === 0) return true;
      const tags = tagsByPhoto[p.id];
      if (!tags) return false;
      const present = new Set(tags.map((t) => t.personId));
      return required.every((id) => present.has(id));
    });

  function viewerSrc(p: Photo) {
    return p.storageUrl
      ? p.storageUrl
      : p.localPath
      ? p.localPath
      : proxyImgUrl(p.baseUrl, p.id, 2000, 2000);
  }

  useEffect(() => {
    if (!viewerOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setViewerOpen(false);
      } else if (e.key === "ArrowLeft") {
        setViewerIndex((i) => (i > 0 ? i - 1 : i));
      } else if (e.key === "ArrowRight") {
        setViewerIndex((i) => (i < displayPhotos.length - 1 ? i + 1 : i));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewerOpen, displayPhotos.length]);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ marginTop: 0 }}>Photos</h1>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }} />

      {err ? (
        <pre style={{ background: "#fee2e2", padding: 12, borderRadius: 10, color: "#991b1b" }}>
          {err}
        </pre>
      ) : null}

      {cacheMsg ? (
        <div style={{ marginBottom: 10, color: "#065f46" }}>{cacheMsg}</div>
      ) : null}

      <div style={{ marginBottom: 10, color: "#555" }} />

      <div style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <label style={{ fontSize: 16, color: "#444" }} htmlFor="sortModeSaved">Sort</label>
        <select
          id="sortModeSaved"
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as "chronological" | "recent")}
          style={{ fontSize: 16, padding: "6px 10px" }}
        >
          <option value="chronological">Chronological (oldest → newest)</option>
          <option value="recent">Most recent (newest → oldest)</option>
        </select>
      </div>
      {(() => {
        const coTags = new Map<string, string>();
        Object.values(tagsByPhoto).forEach((tags) => {
          (tags || []).forEach((t) => {
            const fn = t.person?.firstName || "";
            const ln = t.person?.lastName || "";
            const full = `${fn} ${ln}`.trim();
            const name = full || t.person?.name || "";
            if (t.personId && name) coTags.set(t.personId, name);
          });
        });
        const entries = Array.from(coTags.entries()).sort((a, b) => a[1].localeCompare(b[1]));
        if (entries.length === 0) return null;
        return (
            <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 16, color: "#444", marginBottom: 8 }}>Filter: Only show photos with…</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              {entries.map(([id, name]) => (
                <label key={id} style={{ fontSize: 16, color: "#444" }}>
                  <input
                    type="checkbox"
                    checked={!!selectedWith[id]}
                    onChange={(e) => setSelectedWith((m) => ({ ...m, [id]: e.target.checked }))}
                    style={{ marginRight: 8 }}
                  />
                  {name}
                </label>
              ))}
            </div>
          </div>
        );
      })()}

      {photos.length === 0 ? (
        <div style={{ color: "#666" }}>
          No photos saved yet. Go to the Import page and click “Save selected to DB”.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: 16,
            maxWidth: 1600,
          }}
        >
          {displayPhotos.map((p, idx) => {
            const imgSrc = p.storageUrl
              ? p.storageUrl
              : p.localPath
              ? p.localPath
              : proxyImgUrl(p.baseUrl, p.id, 800, 800);
            const created = p.createdTime ? new Date(p.createdTime).toISOString().slice(0, 10) : "";
            const createdYear = created ? created.slice(0, 4) : "";
            const tags = tagsByPhoto[p.id] || [];
            const isOpen = !!openTags[p.id];
            const tagIds = new Set(tags.map((t) => t.personId));
            const tagNames = tags
              .map((t) => {
                const fn = t.person?.firstName || "";
                const ln = t.person?.lastName || "";
                const full = `${fn} ${ln}`.trim();
                return full || t.person?.name || "";
              })
              .filter(Boolean)
              .sort((a, b) => a.localeCompare(b))
              .join(", ");

            return (
              <div
                key={p.id}
                style={{
                  border: "2px solid #cfe4ff",
                  borderRadius: 12,
                  padding: 10,
                  position: "relative",
                  paddingBottom: 36,
                }}
              >
                <div
                  style={{
                    width: "100%",
                    aspectRatio: "1 / 1",
                    borderRadius: 10,
                    overflow: "hidden",
                    background: "#fafafa",
                    border: "2px solid #dbeafe",
                  }}
                >
                  {broken[p.id] ? (
                    <div style={{ padding: 12, color: "#999", fontSize: 13 }}>Image unavailable</div>
                  ) : (
                    <img
                      src={imgSrc}
                      alt={p.id}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        display: "block",
                        ...imageTransform(p),
                      }}
                      onClick={() => {
                        setViewerIndex(idx);
                        setViewerOpen(true);
                      }}
                      onError={() => setBroken((m) => ({ ...m, [p.id]: true }))}
                    />
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
                  <div style={{ textAlign: "center", minHeight: 26 }}>
                    {p.description ? <i>{p.description}</i> : null}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    {p.location || createdYear ? (
                      <div>
                        {p.location ? p.location : ""}
                        {p.location && createdYear ? ", " : ""}
                        {createdYear || ""}
                      </div>
                    ) : null}
                    {tagsByPhoto[p.id] && tagNames ? <div>{tagNames}</div> : null}
                  </div>
                </div>

                {isEditing ? (
                  <div style={{ position: "absolute", right: 10, top: 8 }}>
                    <button
                      onClick={() => setEditPhotoId(p.id)}
                      style={{ fontSize: 10, padding: "3px 6px", minWidth: 78 }}
                    >
                      Edit
                    </button>
                  </div>
                ) : null}

              </div>
            );
          })}
        </div>
      )}

  {viewerOpen && displayPhotos[viewerIndex] ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(248,250,252,0.55)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
            padding: 12,
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ position: "relative", width: "94vw", maxWidth: 1400, height: "88vh" }}>
            <div
              style={{
                width: "100%",
                height: "88vh",
                borderRadius: 10,
                overflow: "hidden",
                background: "transparent",
                border: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
                    <img
                      src={viewerSrc(displayPhotos[viewerIndex])}
                      alt={displayPhotos[viewerIndex].id}
                      draggable={false}
                      onDragStart={(e) => e.preventDefault()}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                        display: "block",
                    ...imageTransform(displayPhotos[viewerIndex]),
                      }}
                    />
            </div>
            <button
              onClick={() => setViewerOpen(false)}
              style={{ position: "absolute", top: -8, right: -8, fontSize: 12 }}
            >
              Close
            </button>
            <button
              onClick={() =>
                setViewerIndex((i) => (i > 0 ? i - 1 : displayPhotos.length - 1))
              }
              style={{ position: "absolute", left: -8, top: "50%", transform: "translate(-100%,-50%)", fontSize: 12 }}
            >
              ← Prev
            </button>
            <button
              onClick={() =>
                setViewerIndex((i) => (i < displayPhotos.length - 1 ? i + 1 : 0))
              }
              style={{ position: "absolute", right: -8, top: "50%", transform: "translate(100%,-50%)", fontSize: 12 }}
            >
              Next →
            </button>
          </div>
        </div>
  ) : null}

      {editPhotoId && isEditing ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(248,250,252,0.55)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
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
              const p = photos.find((x) => x.id === editPhotoId);
              if (!p) return null;
              const created = p.createdTime ? new Date(p.createdTime).toISOString().slice(0, 10) : "";
              const createdYear = created ? created.slice(0, 4) : "";
              const tags = tagsByPhoto[p.id] || [];
              const tagIds = new Set(tags.map((t) => t.personId));
              const tagNames = tags
                .map((t) => {
                  const fn = t.person?.firstName || "";
                  const ln = t.person?.lastName || "";
                  const full = `${fn} ${ln}`.trim();
                  return full || t.person?.name || "";
                })
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b))
                .join(", ");

              return (
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontWeight: 600 }}>Edit Photo</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={async () => {
                          await saveAllEdits(p.id);
                          setEditPhotoId(null);
                        }}
                        style={{ fontSize: 10, padding: "3px 6px" }}
                      >
                        Save
                      </button>
                      <button
                        onClick={() => {
                          cancelEdits(p.id);
                          setEditPhotoId(null);
                        }}
                        style={{ fontSize: 10, padding: "3px 6px", color: "#b91c1c" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                  <div
                    id={`crop-area-${p.id}`}
                    style={{
                      width: "100%",
                      height: "60vh",
                      borderRadius: 10,
                      overflow: "hidden",
                      background: "#f8fafc",
                      border: "2px solid #e2e8f0",
                      position: "relative",
                      cursor: "default",
                    }}
                  >
                    <img
                      src={viewerSrc(p)}
                      alt={p.id}
                      draggable={false}
                      onDragStart={(e) => e.preventDefault()}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                        display: "block",
                        ...imageTransform(p),
                      }}
                    />
                  </div>
                  <div style={{ fontSize: 12, color: "#444", textAlign: "right" }}>
                    {p.description ? (
                      <div>
                        <i>{p.description}</i>
                      </div>
                    ) : null}
                    {p.location || createdYear ? (
                      <div>
                        {p.location ? p.location : ""}
                        {p.location && createdYear ? ", " : ""}
                        {createdYear || ""}
                      </div>
                    ) : null}
                    {tagNames ? <div>{tagNames}</div> : null}
                  </div>
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "nowrap" }}>
                      <button
                        onClick={() => {
                          setDateDrafts((m) => {
                            const nextDrafts = { ...m };
                            delete nextDrafts[p.id];
                            return nextDrafts;
                          });
                          setLocationDrafts((m) => {
                            const nextDrafts = { ...m };
                            delete nextDrafts[p.id];
                            return nextDrafts;
                          });
                          setDescriptionDrafts((m) => {
                            const nextDrafts = { ...m };
                            delete nextDrafts[p.id];
                            return nextDrafts;
                          });
                          const next = !openTags[p.id];
                          setOpenTags((m) => ({ ...m, [p.id]: next }));
                          if (next && !tagsByPhoto[p.id]) {
                            loadTags(p.id);
                          }
                        }}
                        style={{ fontSize: 10, padding: "3px 6px", minWidth: 78 }}
                      >
                        {openTags[p.id] ? "Hide Tags" : "Tag People"}
                      </button>
                      <button
                        onClick={() => {
                          setOpenTags((m) => ({ ...m, [p.id]: false }));
                          setLocationDrafts((m) => {
                            const next = { ...m };
                            delete next[p.id];
                            return next;
                          });
                          setDescriptionDrafts((m) => {
                            const next = { ...m };
                            delete next[p.id];
                            return next;
                          });
                          setDateDrafts((m) => {
                            if (m[p.id] !== undefined) {
                              const next = { ...m };
                              delete next[p.id];
                              return next;
                            }
                            return { ...m, [p.id]: createdYear };
                          });
                        }}
                        style={{ fontSize: 10, padding: "3px 6px", minWidth: 78 }}
                      >
                        Edit Date
                      </button>
                      <button
                        onClick={() => rotatePhoto(p.id, p.rotation)}
                        style={{ fontSize: 10, padding: "3px 6px", minWidth: 78 }}
                      >
                        Rotate 90°
                      </button>
                      <button
                        onClick={() => deletePhoto(p.id)}
                        style={{ fontSize: 10, padding: "3px 6px", minWidth: 86, color: "#b91c1c" }}
                      >
                        Delete Image
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "nowrap" }}>
                      <button
                        onClick={() => {
                          setOpenTags((m) => ({ ...m, [p.id]: false }));
                          setDateDrafts((m) => {
                            const next = { ...m };
                            delete next[p.id];
                            return next;
                          });
                          setDescriptionDrafts((m) => {
                            const next = { ...m };
                            delete next[p.id];
                            return next;
                          });
                          setLocationDrafts((m) => {
                            if (m[p.id] !== undefined) {
                              const next = { ...m };
                              delete next[p.id];
                              return next;
                            }
                            return { ...m, [p.id]: p.location ?? "" };
                          });
                        }}
                        style={{ fontSize: 10, padding: "3px 6px", minWidth: 78 }}
                      >
                        Edit Location
                      </button>
                      <button
                        onClick={() => {
                          setOpenTags((m) => ({ ...m, [p.id]: false }));
                          setDateDrafts((m) => {
                            const next = { ...m };
                            delete next[p.id];
                            return next;
                          });
                          setLocationDrafts((m) => {
                            const next = { ...m };
                            delete next[p.id];
                            return next;
                          });
                          setDescriptionDrafts((m) => {
                            if (m[p.id] !== undefined) {
                              const next = { ...m };
                              delete next[p.id];
                              return next;
                            }
                            return { ...m, [p.id]: p.description ?? "" };
                          });
                        }}
                        style={{ fontSize: 10, padding: "3px 6px", minWidth: 78 }}
                      >
                        Edit Description
                      </button>
                    </div>
                  </div>
                  {openTags[p.id] ? (
                    <div style={{ marginTop: 8 }}>
                      {tagLoading[p.id] ? (
                        <div style={{ fontSize: 12, color: "#666" }}>Loading tags…</div>
                      ) : people.length === 0 ? (
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
                            const checked = tagIds.has(person.id);
                            return (
                              <label key={person.id} style={{ display: "flex", gap: 8, fontSize: 12 }}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => toggleTag(p.id, person.id, e.target.checked)}
                                />
                                <span>
                                  {displayName(person)}
                                  {person.birthYear ? ` (${person.birthYear})` : ""}
                                </span>
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
                            onClick={() => addNewPersonFromEdit(p.id)}
                            style={{ fontSize: 10, padding: "3px 6px", minWidth: 90 }}
                          >
                            Add person
                          </button>
                        </div>
                      </div>
                      {tagError[p.id] ? (
                        <pre style={{ marginTop: 8, fontSize: 11, color: "#991b1b", background: "#fee2e2", padding: 8, borderRadius: 8 }}>
                          {tagError[p.id]}
                        </pre>
                      ) : null}
                    </div>
                  ) : null}
                  {dateDrafts[p.id] !== undefined ? (
                    <div style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <input
                        type="number"
                        inputMode="numeric"
                        min="1000"
                        max="9999"
                        value={dateDrafts[p.id] ?? createdYear}
                        onChange={(e) => setDateDrafts((m) => ({ ...m, [p.id]: e.target.value }))}
                        placeholder="Year"
                        style={{ fontSize: 10, padding: "3px 6px", width: 90 }}
                      />
                    </div>
                  ) : null}
                  {dateError[p.id] ? (
                    <div style={{ marginTop: 4, fontSize: 11, color: "#991b1b" }}>{dateError[p.id]}</div>
                  ) : null}
                  {locationDrafts[p.id] !== undefined ? (
                    <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
                      <input
                        type="text"
                        value={locationDrafts[p.id] ?? ""}
                        onChange={(e) => setLocationDrafts((m) => ({ ...m, [p.id]: e.target.value }))}
                        placeholder="Location"
                        style={{ fontSize: 10, padding: "3px 6px" }}
                      />
                      {locationError[p.id] ? (
                        <div style={{ fontSize: 11, color: "#991b1b" }}>{locationError[p.id]}</div>
                      ) : null}
                    </div>
                  ) : null}
                  {descriptionDrafts[p.id] !== undefined ? (
                    <div style={{ marginTop: 6, display: "grid", gap: 6 }}>
                      <textarea
                        value={descriptionDrafts[p.id] ?? ""}
                        onChange={(e) => setDescriptionDrafts((m) => ({ ...m, [p.id]: e.target.value }))}
                        placeholder="Event description"
                        rows={2}
                        style={{ fontSize: 10, padding: "3px 6px", resize: "vertical" }}
                      />
                      {descriptionError[p.id] ? (
                        <div style={{ fontSize: 11, color: "#991b1b" }}>{descriptionError[p.id]}</div>
                      ) : null}
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
