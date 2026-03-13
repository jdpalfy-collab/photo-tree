"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEditingMode } from "../../providers";

type Person = {
  id: string;
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  birthYear: number | null;
  profilePhotoId?: string | null;
  profileZoom?: number | null;
  profileX?: number | null;
  profileY?: number | null;
};

type Photo = {
  id: string;
  baseUrl: string;
  localPath?: string | null;
  storageUrl?: string | null;
  mimeType: string;
  createdTime: string | null;
  location?: string | null;
  description?: string | null;
  rotation?: number | null;
  tags?: {
    id: string;
    person: { id: string; name: string; firstName?: string | null; lastName?: string | null };
  }[];
};

function proxyImgUrl(baseUrl: string, photoId: string, w = 600, h = 600) {
  return `/api/photos/image?src=${encodeURIComponent(baseUrl)}&photoId=${encodeURIComponent(
    photoId
  )}&w=${w}&h=${h}&cb=${Date.now()}`;
}

export default function PersonPhotosPage() {
  const { mode } = useEditingMode();
  const isEditing = mode === "editing";
  const params = useParams();
  const searchParams = useSearchParams();
  const personId = typeof params?.id === "string" ? params.id : "";
  const from = searchParams?.get("from");
  const [person, setPerson] = useState<Person | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [err, setErr] = useState<string>("");
  const [sortMode, setSortMode] = useState<"chronological" | "recent">("recent");
  const [dateDrafts, setDateDrafts] = useState<Record<string, string>>({});
  const [dateSaving, setDateSaving] = useState<Record<string, boolean>>({});
  const [dateError, setDateError] = useState<Record<string, string>>({});
  const [locationDrafts, setLocationDrafts] = useState<Record<string, string>>({});
  const [locationSaving, setLocationSaving] = useState<Record<string, boolean>>({});
  const [locationError, setLocationError] = useState<Record<string, string>>({});
  const [descriptionDrafts, setDescriptionDrafts] = useState<Record<string, string>>({});
  const [descriptionSaving, setDescriptionSaving] = useState<Record<string, boolean>>({});
  const [descriptionError, setDescriptionError] = useState<Record<string, string>>({});
  const [selectedWith, setSelectedWith] = useState<Record<string, boolean>>({});
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [openTags, setOpenTags] = useState<Record<string, boolean>>({});
  const [editPhotoId, setEditPhotoId] = useState<string | null>(null);
  const [soloOnly, setSoloOnly] = useState(false);
  const [tagLoading, setTagLoading] = useState<Record<string, boolean>>({});
  const [tagError, setTagError] = useState<Record<string, string>>({});
  const [newPersonDraft, setNewPersonDraft] = useState<{ firstName: string; lastName: string; birthYear: string }>({
    firstName: "",
    lastName: "",
    birthYear: "",
  });

  async function load() {
    setErr("");
    const peopleRes = await fetch("/api/people", { cache: "no-store" });
    const peopleJson = await peopleRes.json().catch(() => ({}));
    if (peopleRes.ok) {
      const list = Array.isArray(peopleJson?.people) ? peopleJson.people : [];
      setPeople(list);
      const p = list.find(
        (x: Person) => x.id === personId
      );
      setPerson(p || null);
    }

    if (!personId) return;

    const r = await fetch(`/api/people/${personId}/photos`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErr(JSON.stringify(j, null, 2));
      setPhotos([]);
      return;
    }
    setPhotos(Array.isArray(j?.photos) ? j.photos : []);
  }

  function displayName(p: Person | null) {
    if (!p) return "Person";
    const full = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
    return full || p.name;
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
      const next = Array.isArray(j?.tags) ? j.tags : [];
      setPhotos((prev) =>
        prev.map((p) => (p.id === photoId ? { ...p, tags: next } : p))
      );
    } finally {
      setTagLoading((m) => ({ ...m, [photoId]: false }));
    }
  }

  async function toggleTag(photoId: string, personIdToToggle: string, checked: boolean) {
    setTagError((m) => ({ ...m, [photoId]: "" }));
    if (checked) {
      const r = await fetch(`/api/photos/${photoId}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personIds: [personIdToToggle] }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setTagError((m) => ({ ...m, [photoId]: JSON.stringify(j) }));
        return;
      }
    } else {
      const r = await fetch(`/api/photos/${photoId}/tags?personId=${encodeURIComponent(personIdToToggle)}`, {
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

  async function saveDate(photoId: string, created: string) {
    const draft = dateDrafts[photoId] ?? created;
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
    if (personId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId]);

  function filteredPhotos() {
    return [...photos]
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
        const present = new Set((p.tags || []).map((t) => t.person?.id).filter(Boolean) as string[]);
        return required.every((id) => present.has(id));
      })
      .filter((p) => {
        if (!soloOnly) return true;
        const tags = (p.tags || []).map((t) => t.person?.id).filter(Boolean) as string[];
        return tags.length === 1 && tags[0] === personId;
      });
  }

  useEffect(() => {
    if (!viewerOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setViewerOpen(false);
      } else if (e.key === "ArrowLeft") {
        setViewerIndex((i) => (i > 0 ? i - 1 : i));
      } else if (e.key === "ArrowRight") {
        setViewerIndex((i) => (i < filteredPhotos().length - 1 ? i + 1 : i));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerOpen, photos.length, sortMode, JSON.stringify(selectedWith)]);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <div
          style={{
            width: 96,
            height: 96,
            borderRadius: 12,
            overflow: "hidden",
            border: "2px solid #cfe4ff",
            background: "#fafafa",
            flexShrink: 0,
          }}
        >
          {person?.profilePhotoId ? (
            (() => {
              const profile =
                photos.find((p) => p.id === person.profilePhotoId) || photos[0];
              const src = profile
                ? profile.storageUrl
                  ? profile.storageUrl
                  : profile.localPath
                  ? profile.localPath
                  : proxyImgUrl(profile.baseUrl, profile.id, 300, 300)
                : "";
              return src ? (
                <img
                  src={src}
                  alt={displayName(person)}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    display: "block",
                    transformOrigin: "center",
                    transform: `translate(${person?.profileX ?? 0}%, ${person?.profileY ?? 0}%) scale(${person?.profileZoom ?? 1}) rotate(${profile?.rotation ?? 0}deg)`,
                  }}
                />
              ) : (
                <div style={{ fontSize: 10, color: "#999", padding: 8 }}>No profile</div>
              );
            })()
          ) : (
            <div style={{ fontSize: 10, color: "#999", padding: 8 }}>No profile</div>
          )}
        </div>
        <div>
          <h1 style={{ margin: 0 }}>{displayName(person)}</h1>
          {person ? (
            <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>
              Birth year: {person.birthYear ?? "—"}
            </div>
          ) : null}
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <Link href={from === "people" ? "/people" : "/family-tree-manual"}>
          ← Back to {from === "people" ? "People" : "Tree"}
        </Link>
      </div>

      <div style={{ marginBottom: 12 }} />

      {err ? (
        <pre style={{ background: "#fee2e2", padding: 12, borderRadius: 10, color: "#991b1b" }}>
          {err}
        </pre>
      ) : null}

      {photos.length === 0 ? (
        <div style={{ color: "#666" }}>No tagged photos.</div>
      ) : (
        <>
        <div style={{ marginBottom: 10 }}>
          {(() => {
            const coTags = new Map<string, string>();
            photos.forEach((ph) => {
              (ph.tags || []).forEach((t) => {
                if (t.person?.id && t.person.name && t.person.id !== personId) {
                  coTags.set(t.person.id, t.person.name);
                }
              });
            });
            const entries = Array.from(coTags.entries()).sort((a, b) => a[1].localeCompare(b[1]));
            if (entries.length === 0) return null;
            return (
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ fontSize: 16, color: "#444" }}>Filter: only show photos with…</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                  {entries.map(([id, name]) => (
                    <label key={id} style={{ fontSize: 16, color: "#444" }}>
                      <input
                        type="checkbox"
                        checked={!!selectedWith[id]}
                        onChange={(e) =>
                          setSelectedWith((m) => ({ ...m, [id]: e.target.checked }))
                        }
                        style={{ marginRight: 8 }}
                      />
                      {name}
                    </label>
                  ))}
                </div>
              </div>
            );
          })()}
          <div style={{ marginTop: 8 }}>
            <label style={{ fontSize: 16, color: "#444" }}>
              <input
                type="checkbox"
                checked={soloOnly}
                onChange={(e) => setSoloOnly(e.target.checked)}
                style={{ marginRight: 8 }}
              />
              Solo
            </label>
          </div>
        </div>

      <div style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <label style={{ fontSize: 16, color: "#444" }} htmlFor="sortModePerson">Sort</label>
          <select
            id="sortModePerson"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as "chronological" | "recent")}
            style={{ fontSize: 16, padding: "6px 10px" }}
          >
            <option value="chronological">Chronological (oldest → newest)</option>
            <option value="recent">Most recent (newest → oldest)</option>
          </select>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
            gap: 16,
            maxWidth: 1600,
          }}
        >
          {(() => {
            const filtered = filteredPhotos();
            return filtered.map((p, idx) => {
              const src = p.storageUrl
                ? p.storageUrl
                : p.localPath
                ? p.localPath
                : proxyImgUrl(p.baseUrl, p.id, 800, 800);
              const created = p.createdTime ? new Date(p.createdTime).toISOString().slice(0, 10) : "";
              const createdYear = created ? created.slice(0, 4) : "";
              const thisName = displayName(person);
              const others = (p.tags || [])
              .map((t) => {
                const fn = t.person?.firstName || "";
                const ln = t.person?.lastName || "";
                const full = `${fn} ${ln}`.trim();
                return full || t.person?.name || "";
              })
              .filter(Boolean)
              .filter((name) => name !== thisName)
              .sort((a, b) => a.localeCompare(b));
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
                    background: "#fafafa",
                    border: "2px solid #dbeafe",
                    borderRadius: 10,
                    overflow: "hidden",
                  }}
                >
                  <img
                    src={src}
                    alt={p.id}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                      transformOrigin: "center",
                      transform: `rotate(${p.rotation ?? 0}deg)`,
                    }}
                    onClick={() => {
                      setViewerIndex(idx);
                      setViewerOpen(true);
                    }}
                  />
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
                    {others.length > 0 ? <div>With {others.join(", ")}</div> : null}
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
            });
          })()}
        </div>
        </>
      )}

      {editPhotoId && isEditing ? (
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
              const p = photos.find((x) => x.id === editPhotoId);
              if (!p) return null;
              const created = p.createdTime ? new Date(p.createdTime).toISOString().slice(0, 10) : "";
              const createdYear = created ? created.slice(0, 4) : "";
              const tagNames = (p.tags || [])
                .map((t) => displayName(t.person as any))
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b))
                .join(", ");
              const tagIds = new Set((p.tags || []).map((t) => t.person?.id).filter(Boolean));
              const imgSrc = p.storageUrl
                ? p.storageUrl
                : p.localPath
                ? p.localPath
                : proxyImgUrl(p.baseUrl, p.id, 1200, 1200);

              return (
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontWeight: 600 }}>Edit Photo</div>
                    <button onClick={() => setEditPhotoId(null)} style={{ fontSize: 10, padding: "3px 6px" }}>
                      Close
                    </button>
                  </div>
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
                      alt={p.id}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                        display: "block",
                        transformOrigin: "center",
                        transform: `rotate(${p.rotation ?? 0}deg)`,
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
                            const next = { ...m };
                            delete next[p.id];
                            return next;
                          });
                          const next = !openTags[p.id];
                          setOpenTags((m) => ({ ...m, [p.id]: next }));
                          if (next && !p.tags) loadTags(p.id);
                        }}
                        style={{ fontSize: 10, padding: "3px 6px", minWidth: 78 }}
                      >
                        {openTags[p.id] ? "Hide Tags" : "Tag People"}
                      </button>
                      <button
                        onClick={() => rotatePhoto(p.id, p.rotation)}
                        style={{ fontSize: 10, padding: "3px 6px", minWidth: 78 }}
                      >
                        Rotate 90°
                      </button>
                      <button
                        onClick={() => deletePhoto(p.id)}
                        style={{ fontSize: 10, padding: "3px 6px", minWidth: 78, color: "#b91c1c" }}
                      >
                        Delete
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
                        {dateDrafts[p.id] !== undefined ? "Cancel" : "Edit Date"}
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
                        {locationDrafts[p.id] !== undefined ? "Cancel" : "Edit Location"}
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
                        {descriptionDrafts[p.id] !== undefined ? "Cancel" : "Edit Description"}
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
                          {people.map((personOpt) => {
                            const checked = tagIds.has(personOpt.id);
                            return (
                              <label key={personOpt.id} style={{ display: "flex", gap: 8, fontSize: 12 }}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => toggleTag(p.id, personOpt.id, e.target.checked)}
                                />
                                <span>{displayName(personOpt)}</span>
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
                      <button
                        onClick={() => saveDate(p.id, created)}
                        disabled={dateSaving[p.id] || (dateDrafts[p.id] ?? createdYear) === createdYear}
                        style={{ fontSize: 10, padding: "3px 6px", minWidth: 78 }}
                      >
                        {dateSaving[p.id] ? "Saving..." : "Save Date"}
                      </button>
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
                      <button
                        onClick={() => saveLocation(p.id)}
                        disabled={locationSaving[p.id]}
                        style={{ fontSize: 10, padding: "3px 6px", minWidth: 78, width: "fit-content" }}
                      >
                        {locationSaving[p.id] ? "Saving..." : "Save Location"}
                      </button>
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
                      <button
                        onClick={() => saveDescription(p.id)}
                        disabled={descriptionSaving[p.id]}
                        style={{ fontSize: 10, padding: "3px 6px", minWidth: 78, width: "fit-content" }}
                      >
                        {descriptionSaving[p.id] ? "Saving..." : "Save Description"}
                      </button>
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

      {(() => {
        const filtered = filteredPhotos();

        const viewerSrc = (p: Photo) =>
          p.storageUrl
            ? p.storageUrl
            : p.localPath
            ? p.localPath
            : proxyImgUrl(p.baseUrl, p.id, 2000, 2000);

        return viewerOpen && filtered[viewerIndex] ? (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(255,255,255,0.0)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 50,
              padding: 12,
            }}
          >
            <div onClick={(e) => e.stopPropagation()} style={{ position: "relative", width: "98vw", maxWidth: 1600, height: "96vh" }}>
              <div
                style={{
                  width: "100%",
                  height: "96vh",
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
                  src={viewerSrc(filtered[viewerIndex])}
                  alt={filtered[viewerIndex].id}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                    display: "block",
                    transformOrigin: "center",
                    transform: `rotate(${filtered[viewerIndex].rotation ?? 0}deg)`,
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
                onClick={() => setViewerIndex((i) => (i > 0 ? i - 1 : i))}
                disabled={viewerIndex === 0}
                style={{ position: "absolute", left: -8, top: "50%", transform: "translate(-100%,-50%)", fontSize: 12 }}
              >
                ← Prev
              </button>
              <button
                onClick={() => setViewerIndex((i) => (i < filtered.length - 1 ? i + 1 : i))}
                disabled={viewerIndex === filtered.length - 1}
                style={{ position: "absolute", right: -8, top: "50%", transform: "translate(100%,-50%)", fontSize: 12 }}
              >
                Next →
              </button>
            </div>
          </div>
        ) : null;
      })()}
    </main>
  );
}
