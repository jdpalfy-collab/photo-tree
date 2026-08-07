"use client";

import { useEffect, useRef, useState } from "react";
import { useEditingMode } from "../providers";
import MobileScrollTracker from "../ui/mobile-scroll-tracker";
import MobileGalleryHeaderStatus from "../ui/mobile-gallery-header-status";

type Person = {
  id: string;
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  birthYear: number | null;
  createdAt: string;
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
  rotation?: number | null;
};

function proxyImgUrl(baseUrl: string, photoId: string, w = 200, h = 200) {
  return `/api/photos/image?src=${encodeURIComponent(baseUrl)}&photoId=${encodeURIComponent(
    photoId
  )}&w=${w}&h=${h}&cb=${Date.now()}`;
}

const PROFILE_CROP_MIN_ZOOM = 0.6;
const PROFILE_CROP_MAX_ZOOM = 8;

export default function PeoplePage() {
  const { mode } = useEditingMode();
  const isEditing = mode === "editing";
  const [people, setPeople] = useState<Person[]>([]);
  const [err, setErr] = useState<string>("");
  const [firstName, setFirstName] = useState<string>("");
  const [lastName, setLastName] = useState<string>("");
  const [birthYear, setBirthYear] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);
  const [addOpen, setAddOpen] = useState<boolean>(false);
  const [photosByPerson, setPhotosByPerson] = useState<Record<string, Photo[]>>({});
  const [pickerOpen, setPickerOpen] = useState<Record<string, boolean>>({});
  const [loadingPhotos, setLoadingPhotos] = useState<Record<string, boolean>>({});
  const [savingProfile, setSavingProfile] = useState<Record<string, boolean>>({});
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null);
  const [editFirst, setEditFirst] = useState<Record<string, string>>({});
  const [editLast, setEditLast] = useState<Record<string, string>>({});
  const [editBirth, setEditBirth] = useState<Record<string, string>>({});
  const [editSaving, setEditSaving] = useState<Record<string, boolean>>({});
  const [editError, setEditError] = useState<Record<string, string>>({});
  const [profilePhotos, setProfilePhotos] = useState<Record<string, Photo>>({});
  const [cropZoom, setCropZoom] = useState<Record<string, number>>({});
  const [cropX, setCropX] = useState<Record<string, number>>({});
  const [cropY, setCropY] = useState<Record<string, number>>({});
  const [cropSaving, setCropSaving] = useState<Record<string, boolean>>({});
  const [cropError, setCropError] = useState<Record<string, string>>({});
  const [peopleSortMode, setPeopleSortMode] = useState<"name" | "birthRecent" | "birthOldest">("name");
  const [selectedLastNames, setSelectedLastNames] = useState<Record<string, boolean>>({});
  const cropDragRef = useRef<{
    personId: string | null;
    pointerId: number | null;
    startX: number;
    startY: number;
    startCropX: number;
    startCropY: number;
    width: number;
    height: number;
  }>({ personId: null, pointerId: null, startX: 0, startY: 0, startCropX: 0, startCropY: 0, width: 1, height: 1 });
  const cropTouchRef = useRef<
    | {
        mode: "drag";
        personId: string;
        startX: number;
        startY: number;
        startCropX: number;
        startCropY: number;
        width: number;
        height: number;
      }
    | {
        mode: "pinch";
        personId: string;
        startDistance: number;
        startZoom: number;
      }
    | null
  >(null);

  function clampCropZoom(value: number) {
    return Math.max(PROFILE_CROP_MIN_ZOOM, Math.min(PROFILE_CROP_MAX_ZOOM, Math.round(value * 100) / 100));
  }

  function cropZoomProgress(value: number) {
    const zoom = clampCropZoom(value);
    return `${((zoom - PROFILE_CROP_MIN_ZOOM) / (PROFILE_CROP_MAX_ZOOM - PROFILE_CROP_MIN_ZOOM)) * 100}%`;
  }

  function cropTouchDistance(touches: { [index: number]: { clientX: number; clientY: number } }) {
    const first = touches[0];
    const second = touches[1];
    return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
  }

  function resetPersonEdit(p: Person) {
    setEditingPersonId(null);
    setCropZoom((m) => ({ ...m, [p.id]: p.profileZoom ?? 1 }));
    setCropX((m) => ({ ...m, [p.id]: p.profileX ?? 0 }));
    setCropY((m) => ({ ...m, [p.id]: p.profileY ?? 0 }));
    setEditFirst((m) => ({ ...m, [p.id]: p.firstName ?? "" }));
    setEditLast((m) => ({ ...m, [p.id]: p.lastName ?? "" }));
    setEditBirth((m) => ({ ...m, [p.id]: p.birthYear ? String(p.birthYear) : "" }));
    cropDragRef.current.personId = null;
    cropDragRef.current.pointerId = null;
    cropTouchRef.current = null;
  }

  function startCropTouch(p: Person, e: React.TouchEvent<HTMLDivElement>) {
    const target = e.currentTarget;
    if (e.touches.length === 2) {
      e.preventDefault();
      cropDragRef.current.personId = null;
      cropDragRef.current.pointerId = null;
      cropTouchRef.current = {
        mode: "pinch",
        personId: p.id,
        startDistance: cropTouchDistance(e.touches),
        startZoom: cropZoom[p.id] ?? p.profileZoom ?? 1,
      };
      return;
    }

    if (e.touches.length === 1) {
      e.preventDefault();
      const rect = target.getBoundingClientRect();
      const touch = e.touches[0];
      cropTouchRef.current = {
        mode: "drag",
        personId: p.id,
        startX: touch.clientX,
        startY: touch.clientY,
        startCropX: cropX[p.id] ?? p.profileX ?? 0,
        startCropY: cropY[p.id] ?? p.profileY ?? 0,
        width: rect.width || 1,
        height: rect.height || 1,
      };
    }
  }

  function moveCropTouch(p: Person, e: React.TouchEvent<HTMLDivElement>) {
    const state = cropTouchRef.current;
    if (!state || state.personId !== p.id) return;

    if (e.touches.length === 2) {
      e.preventDefault();
      const distance = cropTouchDistance(e.touches);
      const startDistance = state.mode === "pinch" ? state.startDistance : distance;
      const startZoom = state.mode === "pinch" ? state.startZoom : cropZoom[p.id] ?? p.profileZoom ?? 1;
      if (startDistance <= 0) return;
      setCropZoom((m) => ({
        ...m,
        [p.id]: clampCropZoom(startZoom * (distance / startDistance)),
      }));
      if (state.mode !== "pinch") {
        cropTouchRef.current = {
          mode: "pinch",
          personId: p.id,
          startDistance: distance,
          startZoom,
        };
      }
      return;
    }

    if (state.mode === "drag" && e.touches.length === 1) {
      e.preventDefault();
      const touch = e.touches[0];
      const dx = touch.clientX - state.startX;
      const dy = touch.clientY - state.startY;
      const nx = state.startCropX + (dx / state.width) * 100;
      const ny = state.startCropY + (dy / state.height) * 100;
      setCropX((m) => ({ ...m, [p.id]: nx }));
      setCropY((m) => ({ ...m, [p.id]: ny }));
    }
  }

  function endCropTouch(p: Person, e: React.TouchEvent<HTMLDivElement>) {
    if (e.touches.length === 1) {
      const rect = e.currentTarget.getBoundingClientRect();
      const touch = e.touches[0];
      cropTouchRef.current = {
        mode: "drag",
        personId: p.id,
        startX: touch.clientX,
        startY: touch.clientY,
        startCropX: cropX[p.id] ?? p.profileX ?? 0,
        startCropY: cropY[p.id] ?? p.profileY ?? 0,
        width: rect.width || 1,
        height: rect.height || 1,
      };
      return;
    }
    cropTouchRef.current = null;
  }

  async function load() {
    setErr("");
    const r = await fetch("/api/people", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErr(JSON.stringify(j, null, 2));
      setPeople([]);
      return;
    }
    const list = Array.isArray(j?.people) ? j.people : [];
    setPeople(list);

    const toFetch = list
      .map((p: Person) => ({ personId: p.id, photoId: p.profilePhotoId }))
      .filter((x: { personId: string; photoId?: string | null }) => !!x.photoId);

    await Promise.all(
      toFetch.map(async ({ personId, photoId }: { personId: string; photoId?: string | null }) => {
        if (!photoId) return;
        const r2 = await fetch(`/api/photos/${photoId}`, { cache: "no-store" });
        const j2 = await r2.json().catch(() => ({}));
        if (!r2.ok) return;
        if (j2?.photo) {
          setProfilePhotos((m) => ({ ...m, [personId]: j2.photo }));
        }
      })
    );
  }

  async function loadPhotos(personId: string) {
    setLoadingPhotos((m) => ({ ...m, [personId]: true }));
    try {
      const r = await fetch(`/api/people/${personId}/photos`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return;
      setPhotosByPerson((m) => ({ ...m, [personId]: Array.isArray(j?.photos) ? j.photos : [] }));
    } finally {
      setLoadingPhotos((m) => ({ ...m, [personId]: false }));
    }
  }

  function getProfileSrc(personId: string, profilePhotoId?: string | null) {
    if (!profilePhotoId) return "";
    const cached = profilePhotos[personId];
    if (cached?.id === profilePhotoId) {
      return cached.storageUrl
        ? cached.storageUrl
        : cached.localPath
        ? cached.localPath
        : proxyImgUrl(cached.baseUrl, cached.id);
    }
    const photos = photosByPerson[personId] || [];
    const match = photos.find((p) => p.id === profilePhotoId);
    if (!match) return "";
    return match.storageUrl
      ? match.storageUrl
      : match.localPath
      ? match.localPath
      : proxyImgUrl(match.baseUrl, match.id);
  }

  function displayName(p: Person) {
    const full = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
    return full || p.name;
  }

  function profileTransform(p: Person) {
    return {
      zoom: p.profileZoom ?? 1,
      x: p.profileX ?? 0,
      y: p.profileY ?? 0,
    };
  }

  async function saveCrop(personId: string) {
    setCropSaving((m) => ({ ...m, [personId]: true }));
    setCropError((m) => ({ ...m, [personId]: "" }));
    try {
      const r = await fetch(`/api/people/${personId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileZoom: clampCropZoom(cropZoom[personId] ?? 1),
          profileX: cropX[personId] ?? 0,
          profileY: cropY[personId] ?? 0,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setCropError((m) => ({ ...m, [personId]: JSON.stringify(j) }));
        return;
      }
      setPeople((prev) =>
        prev.map((p) =>
          p.id === personId
            ? {
                ...p,
                profileZoom: j?.person?.profileZoom ?? 1,
                profileX: j?.person?.profileX ?? 0,
                profileY: j?.person?.profileY ?? 0,
              }
            : p
        )
      );
    } finally {
      setCropSaving((m) => ({ ...m, [personId]: false }));
    }
  }

  async function setProfilePhoto(personId: string, photoId: string) {
    setSavingProfile((m) => ({ ...m, [personId]: true }));
    try {
      const r = await fetch(`/api/people/${personId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profilePhotoId: photoId, profileZoom: 1, profileX: 0, profileY: 0 }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(JSON.stringify(j, null, 2));
        return;
      }
      setPeople((prev) =>
        prev.map((p) =>
          p.id === personId
            ? {
                ...p,
                profilePhotoId: j?.person?.profilePhotoId,
                profileZoom: j?.person?.profileZoom ?? 1,
                profileX: j?.person?.profileX ?? 0,
                profileY: j?.person?.profileY ?? 0,
              }
            : p
        )
      );
      const r2 = await fetch(`/api/photos/${photoId}`, { cache: "no-store" });
      const j2 = await r2.json().catch(() => ({}));
      if (r2.ok && j2?.photo) {
        setProfilePhotos((m) => ({ ...m, [personId]: j2.photo }));
      }
    } finally {
      setSavingProfile((m) => ({ ...m, [personId]: false }));
    }
  }

  async function saveName(personId: string) {
    const first = (editFirst[personId] ?? "").trim();
    const last = (editLast[personId] ?? "").trim();
    if (!first || !last) {
      setEditError((m) => ({ ...m, [personId]: "First and last name are required." }));
      return;
    }
    const birthRaw = (editBirth[personId] ?? "").trim();
    const birthYear = birthRaw === "" ? null : Number(birthRaw);
    if (birthRaw !== "" && !Number.isInteger(birthYear)) {
      setEditError((m) => ({ ...m, [personId]: "Birth year must be an integer." }));
      return;
    }
    setEditSaving((m) => ({ ...m, [personId]: true }));
    setEditError((m) => ({ ...m, [personId]: "" }));
    try {
      const r = await fetch(`/api/people/${personId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: first, lastName: last, birthYear }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setEditError((m) => ({ ...m, [personId]: JSON.stringify(j) }));
        return;
      }
      setPeople((prev) =>
        prev.map((p) =>
          p.id === personId
            ? {
                ...p,
                firstName: j?.person?.firstName,
                lastName: j?.person?.lastName,
                name: j?.person?.name,
                birthYear: j?.person?.birthYear ?? null,
              }
            : p
        )
      );
      setEditingPersonId(null);
    } finally {
      setEditSaving((m) => ({ ...m, [personId]: false }));
    }
  }

  async function createPerson(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setSaving(true);
    try {
      const payload: { firstName: string; lastName: string; birthYear?: number | null } = {
        firstName,
        lastName,
      };
      if (birthYear.trim() !== "") {
        payload.birthYear = Number(birthYear);
      }
      const r = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(JSON.stringify(j, null, 2));
        return;
      }
      setFirstName("");
      setLastName("");
      setBirthYear("");
      await load();
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const lastNameFilters = Array.from(
    new Set(people.map((p) => (p.lastName || "").trim() || "No last name"))
  ).sort((a, b) => a.localeCompare(b));

  const displayedPeople = [...people]
    .filter((p) => {
      const required = Object.keys(selectedLastNames).filter((key) => selectedLastNames[key]);
      if (required.length === 0) return true;
      const lastName = (p.lastName || "").trim() || "No last name";
      return required.includes(lastName);
    })
    .sort((a, b) => {
      const fallback = () => {
        const al = (a.lastName || "").toLowerCase();
        const bl = (b.lastName || "").toLowerCase();
        if (al !== bl) return al.localeCompare(bl);
        const af = (a.firstName || "").toLowerCase();
        const bf = (b.firstName || "").toLowerCase();
        if (af !== bf) return af.localeCompare(bf);
        return (a.name || "").localeCompare(b.name || "");
      };

      if (peopleSortMode === "birthRecent") {
        const ay = a.birthYear ?? -Infinity;
        const by = b.birthYear ?? -Infinity;
        return by - ay || fallback();
      }

      if (peopleSortMode === "birthOldest") {
        const ay = a.birthYear ?? Infinity;
        const by = b.birthYear ?? Infinity;
        return ay - by || fallback();
      }

      return fallback();
    });
  const selectedLastNameCount = Object.values(selectedLastNames).filter(Boolean).length;
  const peopleFilterStatus =
    selectedLastNameCount === 0
      ? "All"
      : selectedLastNameCount === 1
      ? Object.keys(selectedLastNames).find((key) => selectedLastNames[key]) || "1 selected"
      : `${selectedLastNameCount} selected`;
  const peopleSortStatus =
    peopleSortMode === "birthOldest"
      ? "Birth year"
      : peopleSortMode === "birthRecent"
      ? "Recent birth"
      : "Last name";

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <MobileScrollTracker />
      <MobileGalleryHeaderStatus
        filterValue={peopleFilterStatus}
        filterOptions={lastNameFilters.map((lastName) => ({
          id: lastName,
          label: lastName,
          checked: !!selectedLastNames[lastName],
        }))}
        onFilterChange={(lastName, checked) =>
          setSelectedLastNames((current) => ({ ...current, [lastName]: checked }))
        }
        sortValue={peopleSortStatus}
        sortMode={peopleSortMode}
        sortOptions={[
          { value: "name", label: "Last name (A to Z)" },
          { value: "birthOldest", label: "Chronological birth year" },
          { value: "birthRecent", label: "Most recent birth year" },
        ]}
        onSortChange={(value) =>
          setPeopleSortMode(value as "name" | "birthRecent" | "birthOldest")
        }
      />
      <h1 className="mobile-route-title" style={{ marginTop: 0 }}>People</h1>

      <div className="mobile-route-spacer" style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }} />

      {err ? (
        <pre style={{ background: "#fee2e2", padding: 12, borderRadius: 10, color: "#991b1b" }}>
          {err}
        </pre>
      ) : null}

      <div
        className={!isEditing ? "mobile-route-spacer" : undefined}
        style={{ display: "grid", gap: 10, marginBottom: 16, maxWidth: 900, minHeight: 40 }}
      >
        {isEditing ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => setAddOpen((v) => !v)}
              style={{ fontSize: 12, padding: "6px 12px" }}
            >
              {addOpen ? "Close add person" : "Add person"}
            </button>
          </div>
        ) : (
          <div style={{ height: 34 }} />
        )}
        {isEditing && addOpen ? (
          <form
            onSubmit={createPerson}
            style={{
              display: "grid",
              gap: 8,
              maxWidth: 420,
              padding: 12,
              border: "2px solid #cfe4ff",
              borderRadius: 12,
              marginTop: 4,
            }}
          >
            <label style={{ display: "grid", gap: 4 }}>
              <span>First name</span>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="e.g. Margaret"
                required
              />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span>Last name</span>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="e.g. Johnson"
                required
              />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span>Birth year (optional)</span>
              <input
                value={birthYear}
                onChange={(e) => setBirthYear(e.target.value)}
                placeholder="e.g. 1952"
                inputMode="numeric"
              />
            </label>
            <button type="submit" disabled={saving || firstName.trim() === "" || lastName.trim() === ""}>
              {saving ? "Saving..." : "Save person"}
            </button>
          </form>
        ) : null}
      </div>

      <div style={{ marginBottom: 10, color: "#555" }} />

      {people.length > 0 ? (
        <>
          <div className="mobile-control-row">
            <details className="mobile-filter-dropdown">
              <summary>
                Filter
              </summary>
              <div className="mobile-filter-options" style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                {lastNameFilters.map((lastName) => (
                  <label key={lastName} style={{ fontSize: 16, color: "#444" }}>
                    <input
                      type="checkbox"
                      checked={!!selectedLastNames[lastName]}
                      onChange={(e) =>
                        setSelectedLastNames((m) => ({ ...m, [lastName]: e.target.checked }))
                      }
                      style={{ marginRight: 8 }}
                    />
                    {lastName}
                  </label>
                ))}
              </div>
            </details>
            <div className="mobile-sort-control">
              <label style={{ fontSize: 16, color: "#444" }} htmlFor="peopleSortMode">Sort</label>
              <select
                id="peopleSortMode"
                value={peopleSortMode}
                onChange={(e) => setPeopleSortMode(e.target.value as "name" | "birthRecent" | "birthOldest")}
                className="mobile-sort-select"
                style={{ fontSize: 14, padding: "6px 10px" }}
              >
                <option value="name">Last name (A → Z)</option>
                <option value="birthOldest">Chronological birth year</option>
                <option value="birthRecent">Most recent birth year</option>
              </select>
            </div>
          </div>
        </>
      ) : null}

      {people.length === 0 ? (
        <div style={{ color: "#666" }}>No people added yet.</div>
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
          {displayedPeople.map((p) => (
            <div
              key={p.id}
              className="mobile-list-card people-list-card"
              style={{
                border: "2px solid #cfe4ff",
                borderRadius: 12,
                padding: 10,
                display: "grid",
                gap: 6,
                position: "relative",
                minHeight: 220,
                alignContent: "start",
                paddingBottom: 14,
              }}
            >
              <a
                href={`/family-tree/${p.id}?from=people`}
                style={{ display: "block", textDecoration: "none", color: "inherit" }}
                aria-label={`Open ${p.name} gallery`}
              >
                <div
                  className="people-card-profile"
                  style={{
                    width: "100%",
                    aspectRatio: "1 / 1",
                    background: "#ffffff",
                    border: "2px solid #dbeafe",
                    borderRadius: 10,
                    overflow: "hidden",
                    marginBottom: 8,
                  }}
                >
                  {getProfileSrc(p.id, p.profilePhotoId) ? (
                    <img
                      src={getProfileSrc(p.id, p.profilePhotoId)}
                      alt={p.name}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                        display: "block",
                        transformOrigin: "center",
                        transform: `translate(${profileTransform(p).x}%, ${profileTransform(p).y}%) scale(${profileTransform(p).zoom}) rotate(${profilePhotos[p.id]?.rotation ?? 0}deg)`,
                      }}
                    />
                  ) : (
                    <div style={{ padding: 12, color: "#999", fontSize: 13 }}>No profile</div>
                  )}
                </div>
              </a>

              <div className="people-card-name" style={{ minHeight: 28, textAlign: "right" }}>
                <div style={{ fontWeight: 700, fontSize: 20 }}>
                  <a href={`/family-tree/${p.id}?from=people`} style={{ textDecoration: "none", color: "#6aa8ff" }}>
                    {displayName(p)}
                  </a>
                </div>
              </div>
              {isEditing ? (
              <div style={{ position: "absolute", right: 10, top: 8 }}>
                <button
                  onClick={() => {
                    const next = editingPersonId !== p.id;
                    setEditingPersonId(next ? p.id : null);
                    if (next) {
                      setEditFirst((m) => ({ ...m, [p.id]: p.firstName ?? "" }));
                      setEditLast((m) => ({ ...m, [p.id]: p.lastName ?? "" }));
                      setEditBirth((m) => ({ ...m, [p.id]: p.birthYear ? String(p.birthYear) : "" }));
                      setCropZoom((m) => ({ ...m, [p.id]: p.profileZoom ?? 1 }));
                      setCropX((m) => ({ ...m, [p.id]: p.profileX ?? 0 }));
                      setCropY((m) => ({ ...m, [p.id]: p.profileY ?? 0 }));
                      setPickerOpen((m) => ({ ...m, [p.id]: false }));
                      if (!photosByPerson[p.id]) loadPhotos(p.id);
                    } else {
                      setPickerOpen((m) => ({ ...m, [p.id]: false }));
                    }
                  }}
                  style={{ fontSize: 12 }}
                >
                  {editingPersonId === p.id ? "Close" : "Edit"}
                </button>
              </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {editingPersonId && isEditing ? (
        <div
          className="person-edit-overlay"
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
            className="person-edit-modal"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: 16,
              maxWidth: 720,
              width: "90vw",
              maxHeight: "90vh",
              overflow: "auto",
              border: "2px solid #cfe4ff",
            }}
          >
            {(() => {
              const p = people.find((x) => x.id === editingPersonId);
              if (!p) return null;
              const profileSrc = getProfileSrc(p.id, p.profilePhotoId);
              const profileRotation = profilePhotos[p.id]?.rotation ?? 0;
              return (
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontWeight: 600 }}>Edit Profile</div>
                    <button
                      type="button"
                      onClick={() => resetPersonEdit(p)}
                      className="person-profile-cancel-button"
                    >
                      Cancel
                    </button>
                  </div>
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    <div
                      className="person-profile-crop-box"
                      style={{
                        width: "min(260px, 72vw)",
                        aspectRatio: "1 / 1",
                        background: "#ffffff",
                        border: "2px solid #dbeafe",
                        borderRadius: 10,
                        overflow: "hidden",
                        position: "relative",
                        cursor: profileSrc ? "grab" : "default",
                        touchAction: "none",
                      }}
                      onDragStart={(e) => e.preventDefault()}
                      onPointerDown={(e) => {
                        if (!profileSrc) return;
                        if (e.pointerType === "touch") return;
                        e.preventDefault();
                        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                        cropDragRef.current = {
                          personId: p.id,
                          pointerId: e.pointerId,
                          startX: e.clientX,
                          startY: e.clientY,
                          startCropX: cropX[p.id] ?? p.profileX ?? 0,
                          startCropY: cropY[p.id] ?? p.profileY ?? 0,
                          width: rect.width || 1,
                          height: rect.height || 1,
                        };
                        (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
                      }}
                      onPointerMove={(e) => {
                        if (e.pointerType === "touch") return;
                        const drag = cropDragRef.current;
                        if (!drag.personId || drag.personId !== p.id || drag.pointerId !== e.pointerId) return;
                        e.preventDefault();
                        const dx = e.clientX - drag.startX;
                        const dy = e.clientY - drag.startY;
                        const nx = drag.startCropX + (dx / drag.width) * 100;
                        const ny = drag.startCropY + (dy / drag.height) * 100;
                        setCropX((m) => ({ ...m, [p.id]: nx }));
                        setCropY((m) => ({ ...m, [p.id]: ny }));
                      }}
                      onPointerUp={(e) => {
                        if (cropDragRef.current.personId === p.id && cropDragRef.current.pointerId === e.pointerId) {
                          (e.currentTarget as HTMLDivElement).releasePointerCapture?.(e.pointerId);
                          cropDragRef.current.personId = null;
                          cropDragRef.current.pointerId = null;
                        }
                      }}
                      onPointerCancel={(e) => {
                        if (cropDragRef.current.personId === p.id && cropDragRef.current.pointerId === e.pointerId) {
                          (e.currentTarget as HTMLDivElement).releasePointerCapture?.(e.pointerId);
                          cropDragRef.current.personId = null;
                          cropDragRef.current.pointerId = null;
                        }
                      }}
                      onTouchStart={(e) => {
                        if (!profileSrc) return;
                        startCropTouch(p, e);
                      }}
                      onTouchMove={(e) => {
                        if (!profileSrc) return;
                        moveCropTouch(p, e);
                      }}
                      onTouchEnd={(e) => endCropTouch(p, e)}
                      onTouchCancel={() => {
                        cropTouchRef.current = null;
                      }}
                    >
                      {profileSrc ? (
                        <img
                          src={profileSrc}
                          alt={p.name}
                          draggable={false}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "contain",
                            display: "block",
                            transformOrigin: "center",
                            transform: `translate(${cropX[p.id] ?? p.profileX ?? 0}%, ${cropY[p.id] ?? p.profileY ?? 0}%) scale(${cropZoom[p.id] ?? p.profileZoom ?? 1}) rotate(${profileRotation}deg)`,
                          }}
                        />
                      ) : (
                        <div style={{ padding: 12, color: "#999", fontSize: 13 }}>No profile</div>
                      )}
                    </div>
                  </div>
                  {profileSrc ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      <label style={{ fontSize: 12, color: "#555" }}>
                        Zoom
                        <input
                          className="profile-zoom-range"
                          type="range"
                          min={PROFILE_CROP_MIN_ZOOM}
                          max={PROFILE_CROP_MAX_ZOOM}
                          step="0.05"
                          value={clampCropZoom(cropZoom[p.id] ?? p.profileZoom ?? 1)}
                          onChange={(e) =>
                            setCropZoom((m) => ({ ...m, [p.id]: clampCropZoom(Number(e.target.value)) }))
                          }
                          style={
                            {
                              "--profile-zoom-progress": cropZoomProgress(cropZoom[p.id] ?? p.profileZoom ?? 1),
                            } as React.CSSProperties
                          }
                        />
                      </label>
                      <div style={{ fontSize: 12, color: "#555" }}>
                        Pinch to zoom and drag the photo to reposition.
                      </div>
                      {cropError[p.id] ? (
                        <div style={{ fontSize: 11, color: "#991b1b" }}>{cropError[p.id]}</div>
                      ) : null}
                    </div>
                  ) : null}
                  <div style={{ display: "grid", gap: 6 }}>
                    <input
                      value={editFirst[p.id] ?? ""}
                      onChange={(e) => setEditFirst((m) => ({ ...m, [p.id]: e.target.value }))}
                      placeholder="First name"
                      style={{ fontSize: 14, fontWeight: 600, padding: "6px 8px" }}
                    />
                    <input
                      value={editLast[p.id] ?? ""}
                      onChange={(e) => setEditLast((m) => ({ ...m, [p.id]: e.target.value }))}
                      placeholder="Last name"
                      style={{ fontSize: 14, fontWeight: 600, padding: "6px 8px" }}
                    />
                    <input
                      value={editBirth[p.id] ?? ""}
                      onChange={(e) => setEditBirth((m) => ({ ...m, [p.id]: e.target.value }))}
                      placeholder="Birth year"
                      inputMode="numeric"
                      style={{ fontSize: 12, padding: "6px 8px" }}
                    />
                  </div>
                  {editError[p.id] ? (
                    <div style={{ fontSize: 11, color: "#991b1b" }}>{editError[p.id]}</div>
                  ) : null}
                  <details
                    open={!!pickerOpen[p.id]}
                    onToggle={(e) => {
                      const open = (e.currentTarget as HTMLDetailsElement).open;
                      setPickerOpen((m) => ({ ...m, [p.id]: open }));
                      if (open && !photosByPerson[p.id]) loadPhotos(p.id);
                    }}
                    className="profile-photo-picker"
                  >
                    <summary>Choose new profile picture</summary>
                    <div className="profile-photo-picker__body">
                      {loadingPhotos[p.id] ? (
                        <div style={{ fontSize: 12, color: "#666" }}>Loading photos...</div>
                      ) : (photosByPerson[p.id] || []).length === 0 ? (
                        <div style={{ fontSize: 12, color: "#666" }}>No tagged photos.</div>
                      ) : (
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))",
                            gap: 8,
                          }}
                        >
                          {(photosByPerson[p.id] || []).map((ph) => {
                            const src = ph.storageUrl
                              ? ph.storageUrl
                              : ph.localPath
                              ? ph.localPath
                              : proxyImgUrl(ph.baseUrl, ph.id);
                            const isProfile = p.profilePhotoId === ph.id;
                            return (
                              <button
                                key={ph.id}
                                onClick={() => setProfilePhoto(p.id, ph.id)}
                                disabled={!!savingProfile[p.id]}
                                style={{
                                  padding: 0,
                                  border: isProfile ? "2px solid #111827" : "2px solid #cfe4ff",
                                  borderRadius: 8,
                                  overflow: "hidden",
                                  background: "#fff",
                                }}
                                title={isProfile ? "Current profile" : "Set as profile"}
                              >
                                <img
                                  src={src}
                                  alt={ph.id}
                                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                                />
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </details>
                  <div className="photo-edit-save-row person-profile-save-row">
                    <button
                      type="button"
                      onClick={async () => {
                        await saveCrop(p.id);
                        await saveName(p.id);
                      }}
                      disabled={cropSaving[p.id] || editSaving[p.id]}
                      className="photo-edit-save-button person-profile-save-button"
                    >
                      {cropSaving[p.id] || editSaving[p.id] ? "Saving..." : "Save profile"}
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
