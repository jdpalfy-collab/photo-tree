// app/saved/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useEditingMode } from "../providers";
import React from "react";
import PhotoLightbox from "../ui/photo-lightbox";
import MobileScrollTracker from "../ui/mobile-scroll-tracker";
import MobileGalleryHeaderStatus from "../ui/mobile-gallery-header-status";

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

function comparePeopleByLastFirst(a: Person, b: Person) {
  const al = (a.lastName || "").toLowerCase();
  const bl = (b.lastName || "").toLowerCase();
  if (al !== bl) return al.localeCompare(bl);
  const af = (a.firstName || "").toLowerCase();
  const bf = (b.firstName || "").toLowerCase();
  if (af !== bf) return af.localeCompare(bf);
  return displayName(a).localeCompare(displayName(b));
}

function photoNameTokenClass(name: string) {
  const compactLength = name.replace(/\s+/g, "").length;
  if (compactLength >= 18) return "mobile-photo-name-token mobile-photo-name-token--extra-long";
  if (compactLength >= 13) return "mobile-photo-name-token mobile-photo-name-token--long";
  return "mobile-photo-name-token";
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
  const searchParams = useSearchParams();
  const focusPhotoId = searchParams?.get("photoId") || "";
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
  const [focusedPhotoId, setFocusedPhotoId] = useState("");
  const [newPersonDraft, setNewPersonDraft] = useState<{ firstName: string; lastName: string; birthYear: string }>({
    firstName: "",
    lastName: "",
    birthYear: "",
  });
  const cacheRepairAttemptedRef = React.useRef(false);
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

  useEffect(() => {
    if (cacheRepairAttemptedRef.current) return;
    if (photos.length === 0) return;
    const hasMissingDurableImage = photos.some((p) => !p.storageUrl && p.baseUrl);
    if (!hasMissingDurableImage) return;
    cacheRepairAttemptedRef.current = true;
    void cacheMissing();
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
  const photoFilterIds = new Set(
    Object.values(tagsByPhoto).flatMap((tags) => (tags || []).map((tag) => tag.personId))
  );
  const photoFilterPeople = people
    .filter((person) => photoFilterIds.has(person.id))
    .sort(comparePeopleByLastFirst);
  const selectedPeople = photoFilterPeople.filter((person) => selectedWith[person.id]);
  const photoFilterStatus =
    selectedPeople.length === 0
      ? "All"
      : selectedPeople.length === 1
      ? displayName(selectedPeople[0])
      : `${selectedPeople.length} people`;
  const photoSortStatus = sortMode === "recent" ? "Most recent" : "Chronological";
  const focusPhotoVisible = focusPhotoId ? displayPhotos.some((photo) => photo.id === focusPhotoId) : false;

  useEffect(() => {
    if (!focusPhotoId || !focusPhotoVisible) return;
    const timer = window.setTimeout(() => {
      const card = document.getElementById(`photo-card-${focusPhotoId}`);
      if (!card) return;
      setFocusedPhotoId(focusPhotoId);
      const scroller = document.querySelector<HTMLElement>(".site-content");
      if (scroller) {
        scroller.scrollTo({
          top: Math.max(0, card.offsetTop - 12),
          behavior: "smooth",
        });
      } else {
        card.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      window.setTimeout(() => setFocusedPhotoId(""), 1600);
    }, 260);
    return () => window.clearTimeout(timer);
  }, [focusPhotoId, focusPhotoVisible]);

  function viewerSrc(p: Photo) {
    return p.storageUrl
      ? p.storageUrl
      : p.localPath
      ? p.localPath
      : proxyImgUrl(p.baseUrl, p.id, 2000, 2000);
  }

  function personGalleryHref(personId: string, photoId: string) {
    const params = new URLSearchParams({ from: "photos", photoId });
    return `/family-tree/${encodeURIComponent(personId)}?${params.toString()}`;
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <MobileScrollTracker />
      <MobileGalleryHeaderStatus
        filterValue={photoFilterStatus}
        filterOptions={photoFilterPeople.map((person) => ({
          id: person.id,
          label: displayName(person),
          checked: !!selectedWith[person.id],
        }))}
        onFilterChange={(personId, checked) =>
          setSelectedWith((current) => ({ ...current, [personId]: checked }))
        }
        sortValue={photoSortStatus}
        sortMode={sortMode}
        sortOptions={[
          { value: "chronological", label: "Chronological" },
          { value: "recent", label: "Most recent" },
        ]}
        onSortChange={(value) => setSortMode(value as "chronological" | "recent")}
      />
      <h1 className="mobile-route-title" style={{ marginTop: 0 }}>Photos</h1>

      <div className="mobile-route-spacer" style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }} />

      {err ? (
        <pre style={{ background: "#fee2e2", padding: 12, borderRadius: 10, color: "#991b1b" }}>
          {err}
        </pre>
      ) : null}

      {cacheMsg ? (
        <div style={{ marginBottom: 10, color: "#065f46" }}>{cacheMsg}</div>
      ) : null}

      <div className="mobile-route-spacer" style={{ marginBottom: 10, color: "#555" }} />

      <div className="mobile-control-row">
        {(() => {
          const coTags = new Map<
            string,
            { firstName: string; lastName: string; name: string }
          >();
          Object.values(tagsByPhoto).forEach((tags) => {
            (tags || []).forEach((t) => {
              const fn = t.person?.firstName || "";
              const ln = t.person?.lastName || "";
              const full = `${fn} ${ln}`.trim();
              const name = full || t.person?.name || "";
              if (t.personId && name) {
                coTags.set(t.personId, { firstName: fn, lastName: ln, name });
              }
            });
          });
          const entries = Array.from(coTags.entries()).sort((a, b) => {
            const al = (a[1].lastName || "").toLowerCase();
            const bl = (b[1].lastName || "").toLowerCase();
            if (al !== bl) return al.localeCompare(bl);
            const af = (a[1].firstName || "").toLowerCase();
            const bf = (b[1].firstName || "").toLowerCase();
            if (af !== bf) return af.localeCompare(bf);
            return (a[1].name || "").localeCompare(b[1].name || "");
          });
          if (entries.length === 0) return <span />;
          return (
            <details className="mobile-filter-dropdown">
              <summary>
                Filter
              </summary>
              <div className="mobile-filter-options" style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                {entries.map(([id, meta]) => (
                  <label key={id} style={{ fontSize: 16, color: "#444" }}>
                    <input
                      type="checkbox"
                      checked={!!selectedWith[id]}
                      onChange={(e) => setSelectedWith((m) => ({ ...m, [id]: e.target.checked }))}
                      style={{ marginRight: 8 }}
                    />
                    {meta.name}
                  </label>
                ))}
              </div>
            </details>
          );
        })()}
        <div className="mobile-sort-control">
          <label style={{ fontSize: 16, color: "#444" }} htmlFor="sortModeSaved">Sort</label>
          <select
            id="sortModeSaved"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as "chronological" | "recent")}
            className="mobile-sort-select"
            style={{ fontSize: 16, padding: "6px 10px" }}
          >
            <option value="chronological">Chronological</option>
            <option value="recent">Most recent</option>
          </select>
        </div>
      </div>

      {photos.length === 0 ? (
        <div style={{ color: "#666" }}>
          No photos saved yet. Go to the Import page and click “Save selected to DB”.
        </div>
      ) : (
        <div
          className="mobile-card-grid"
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
            const cardHeadline = [p.description, createdYear].filter(Boolean).join(", ");
            const tags = tagsByPhoto[p.id] || [];
            const tagPeople = tags
              .map((t) => t.person)
              .filter((person): person is Person => !!person)
              .sort(comparePeopleByLastFirst)
              .filter((person) => !!displayName(person));
            const nameDensityClass =
              tagPeople.length > 6
                ? "mobile-photo-card-names--crowded"
                : tagPeople.length > 3
                ? "mobile-photo-card-names--dense"
                : "";

            return (
              <div
                id={`photo-card-${p.id}`}
                key={p.id}
                className={
                  focusedPhotoId === p.id
                    ? "mobile-list-card mobile-photo-card mobile-photo-card--focused"
                    : "mobile-list-card mobile-photo-card"
                }
                style={{
                  border: "2px solid #cfe4ff",
                  borderRadius: 12,
                  padding: 10,
                  position: "relative",
                  paddingBottom: 36,
                }}
                >
                <div
                  className="mobile-photo-card-frame"
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
                  className="mobile-photo-card-meta"
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
                  <div className="mobile-photo-card-details" style={{ textAlign: "right" }}>
                    {cardHeadline ? (
                      <div className="mobile-photo-card-date">
                        {cardHeadline}
                      </div>
                    ) : null}
                    {p.location ? <div className="mobile-photo-card-location">{p.location}</div> : null}
                    {tagsByPhoto[p.id] && tagPeople.length > 0 ? (
                      <div className={["mobile-photo-card-names", nameDensityClass].filter(Boolean).join(" ")}>
                        {tagPeople.map((tagPerson) => {
                          const name = displayName(tagPerson);
                          return (
                            <a
                              className={photoNameTokenClass(name)}
                              href={personGalleryHref(tagPerson.id, p.id)}
                              key={tagPerson.id}
                            >
                              {name}
                            </a>
                          );
                        })}
                      </div>
                    ) : null}
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
        <PhotoLightbox
          src={viewerSrc(displayPhotos[viewerIndex])}
          alt={displayPhotos[viewerIndex].id}
          rotation={displayPhotos[viewerIndex].rotation}
          caption={displayPhotos[viewerIndex].description}
          year={
            displayPhotos[viewerIndex].createdTime
              ? new Date(displayPhotos[viewerIndex].createdTime as string).toISOString().slice(0, 4)
              : null
          }
          people={(tagsByPhoto[displayPhotos[viewerIndex].id] || []).map((tag) => ({
            id: tag.person.id,
            name: displayName(tag.person),
          }))}
          getPersonHref={(personId) => personGalleryHref(personId, displayPhotos[viewerIndex].id)}
          onClose={() => setViewerOpen(false)}
          onPrev={() => setViewerIndex((i) => (i > 0 ? i - 1 : displayPhotos.length - 1))}
          onNext={() => setViewerIndex((i) => (i < displayPhotos.length - 1 ? i + 1 : 0))}
        />
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
            className="photo-edit-modal"
          >
            {(() => {
              const p = photos.find((x) => x.id === editPhotoId);
              if (!p) return null;
              const created = p.createdTime ? new Date(p.createdTime).toISOString().slice(0, 10) : "";
              const createdYear = created ? created.slice(0, 4) : "";
              const tags = tagsByPhoto[p.id] || [];
              const tagIds = new Set(tags.map((t) => t.personId));
              const tagNames = tags
                .map((t) => t.person)
                .filter((person): person is Person => !!person)
                .sort(comparePeopleByLastFirst)
                .map(displayName)
                .filter(Boolean)
                ;

              return (
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontWeight: 600 }}>Edit Photo</div>
                    <div style={{ display: "flex", gap: 8 }}>
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
                    className="photo-edit-image"
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
                  <div className="photo-edit-meta" style={{ fontSize: 12, color: "#444", textAlign: "right" }}>
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
                  <div className="photo-edit-actions-grid" style={{ display: "grid", gap: 8 }}>
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
                  <div className="photo-edit-save-row photo-edit-save-row--split">
                    <button
                      onClick={() => deletePhoto(p.id)}
                      className="photo-edit-danger photo-edit-delete-footer"
                    >
                      Delete Image
                    </button>
                    <button
                      onClick={async () => {
                        await saveAllEdits(p.id);
                        setEditPhotoId(null);
                      }}
                      className="photo-edit-save-button"
                    >
                      Save
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      ) : null}
    </main>
  );
}
