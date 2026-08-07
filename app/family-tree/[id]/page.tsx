"use client";

import React, { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useEditingMode } from "../../providers";
import PhotoLightbox from "../../ui/photo-lightbox";
import MobileScrollTracker from "../../ui/mobile-scroll-tracker";
import MobileGalleryHeaderStatus from "../../ui/mobile-gallery-header-status";

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

type PersonLike = {
  id: string;
  name: string;
  firstName?: string | null;
  lastName?: string | null;
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
  cropX?: number | null;
  cropY?: number | null;
  cropW?: number | null;
  cropH?: number | null;
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

const PROFILE_CROP_MIN_ZOOM = 0.6;
const PROFILE_CROP_MAX_ZOOM = 8;

function clampProfileZoom(value: number) {
  return Math.max(PROFILE_CROP_MIN_ZOOM, Math.min(PROFILE_CROP_MAX_ZOOM, Math.round(value * 100) / 100));
}

function profileZoomProgress(value: number) {
  const zoom = clampProfileZoom(value);
  return `${((zoom - PROFILE_CROP_MIN_ZOOM) / (PROFILE_CROP_MAX_ZOOM - PROFILE_CROP_MIN_ZOOM)) * 100}%`;
}

function touchDistance(touches: { [index: number]: { clientX: number; clientY: number } }) {
  const first = touches[0];
  const second = touches[1];
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

export default function PersonPhotosPage() {
  const { mode } = useEditingMode();
  const isEditing = mode === "editing";
  const params = useParams();
  const searchParams = useSearchParams();
  const personId = typeof params?.id === "string" ? params.id : "";
  const from = searchParams?.get("from");
  const sourcePhotoId = searchParams?.get("photoId") || "";
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
  const [profileEditOpen, setProfileEditOpen] = useState(false);
  const [profileFirst, setProfileFirst] = useState("");
  const [profileLast, setProfileLast] = useState("");
  const [profileBirth, setProfileBirth] = useState("");
  const [profilePhotoIdDraft, setProfilePhotoIdDraft] = useState<string | null>(null);
  const [profileZoomDraft, setProfileZoomDraft] = useState(1);
  const [profileXDraft, setProfileXDraft] = useState(0);
  const [profileYDraft, setProfileYDraft] = useState(0);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profilePhotoPickerOpen, setProfilePhotoPickerOpen] = useState(false);
  const profileCropDragRef = React.useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
    startCropX: number;
    startCropY: number;
    width: number;
    height: number;
  }>({ pointerId: null, startX: 0, startY: 0, startCropX: 0, startCropY: 0, width: 1, height: 1 });
  const profileTouchRef = React.useRef<
    | {
        mode: "drag";
        startX: number;
        startY: number;
        startCropX: number;
        startCropY: number;
        width: number;
        height: number;
      }
    | {
        mode: "pinch";
        startDistance: number;
        startZoom: number;
      }
    | null
  >(null);

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

  function displayName(p: PersonLike | null) {
    if (!p) return "Person";
    const full = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
    return full || p.name || "Person";
  }

  function comparePeopleByLastFirst(a: PersonLike, b: PersonLike) {
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

  function photoSrc(p: Photo, w = 600, h = 600) {
    return p.storageUrl
      ? p.storageUrl
      : p.localPath
      ? p.localPath
      : proxyImgUrl(p.baseUrl, p.id, w, h);
  }

  function openProfileEditor() {
    if (!person) return;
    setProfileFirst(person.firstName ?? "");
    setProfileLast(person.lastName ?? "");
    setProfileBirth(person.birthYear ? String(person.birthYear) : "");
    setProfilePhotoIdDraft(person.profilePhotoId ?? null);
    setProfileZoomDraft(clampProfileZoom(person.profileZoom ?? 1));
    setProfileXDraft(person.profileX ?? 0);
    setProfileYDraft(person.profileY ?? 0);
    setProfileError("");
    setProfilePhotoPickerOpen(false);
    setProfileEditOpen(true);
    profileTouchRef.current = null;
    profileCropDragRef.current.pointerId = null;
  }

  function startProfileTouch(e: React.TouchEvent<HTMLDivElement>) {
    if (e.touches.length === 2) {
      e.preventDefault();
      profileCropDragRef.current.pointerId = null;
      profileTouchRef.current = {
        mode: "pinch",
        startDistance: touchDistance(e.touches),
        startZoom: profileZoomDraft,
      };
      return;
    }

    if (e.touches.length === 1) {
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const touch = e.touches[0];
      profileTouchRef.current = {
        mode: "drag",
        startX: touch.clientX,
        startY: touch.clientY,
        startCropX: profileXDraft,
        startCropY: profileYDraft,
        width: rect.width || 1,
        height: rect.height || 1,
      };
    }
  }

  function moveProfileTouch(e: React.TouchEvent<HTMLDivElement>) {
    const state = profileTouchRef.current;
    if (!state) return;

    if (e.touches.length === 2) {
      e.preventDefault();
      const distance = touchDistance(e.touches);
      const startDistance = state.mode === "pinch" ? state.startDistance : distance;
      const startZoom = state.mode === "pinch" ? state.startZoom : profileZoomDraft;
      if (startDistance <= 0) return;
      setProfileZoomDraft(clampProfileZoom(startZoom * (distance / startDistance)));
      if (state.mode !== "pinch") {
        profileTouchRef.current = {
          mode: "pinch",
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
      setProfileXDraft(nx);
      setProfileYDraft(ny);
    }
  }

  function endProfileTouch(e: React.TouchEvent<HTMLDivElement>) {
    if (e.touches.length === 1) {
      const rect = e.currentTarget.getBoundingClientRect();
      const touch = e.touches[0];
      profileTouchRef.current = {
        mode: "drag",
        startX: touch.clientX,
        startY: touch.clientY,
        startCropX: profileXDraft,
        startCropY: profileYDraft,
        width: rect.width || 1,
        height: rect.height || 1,
      };
      return;
    }
    profileTouchRef.current = null;
  }

  async function saveProfileEdits() {
    if (!person) return;
    const firstName = profileFirst.trim();
    const lastName = profileLast.trim();
    if (!firstName || !lastName) {
      setProfileError("First and last name are required.");
      return;
    }
    const birthRaw = profileBirth.trim();
    const birthYear = birthRaw === "" ? null : Number(birthRaw);
    if (birthRaw !== "" && !Number.isInteger(birthYear)) {
      setProfileError("Birth year must be an integer.");
      return;
    }

    setProfileSaving(true);
    setProfileError("");
    try {
      const r = await fetch(`/api/people/${person.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName,
          lastName,
          birthYear,
          profilePhotoId: profilePhotoIdDraft,
          profileZoom: clampProfileZoom(profileZoomDraft),
          profileX: profileXDraft,
          profileY: profileYDraft,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setProfileError(JSON.stringify(j));
        return;
      }
      const updated = j?.person as Person;
      if (updated?.id) {
        setPerson(updated);
        setPeople((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      }
      setProfileEditOpen(false);
      await load();
    } finally {
      setProfileSaving(false);
    }
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

  async function saveAllEdits(photoId: string, created: string) {
    if (dateDrafts[photoId] !== undefined) {
      await saveDate(photoId, created);
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

  const selectedPeople = people.filter((candidate) => selectedWith[candidate.id]);
  const personFilterMap = new Map<string, PersonLike>();
  photos.forEach((photo) => {
    (photo.tags || []).forEach((tag) => {
      if (tag.person?.id && tag.person.id !== personId) {
        personFilterMap.set(tag.person.id, tag.person);
      }
    });
  });
  const personFilterPeople = Array.from(personFilterMap.values()).sort(comparePeopleByLastFirst);
  const personFilterStatus = soloOnly
    ? selectedPeople.length > 0
      ? `Solo + ${selectedPeople.length}`
      : "Solo"
    : selectedPeople.length === 0
    ? "All"
    : selectedPeople.length === 1
    ? displayName(selectedPeople[0])
    : `${selectedPeople.length} people`;
  const personSortStatus = sortMode === "recent" ? "Most recent" : "Chronological";
  const sourceTab = from === "people" || from === "photos" || from === "tree" ? from : "tree";
  const backTarget =
    sourceTab === "people"
      ? { href: "/people", label: "People" }
      : sourceTab === "photos"
      ? {
          href: sourcePhotoId ? `/saved?photoId=${encodeURIComponent(sourcePhotoId)}` : "/saved",
          label: "Photos",
        }
      : { href: "/family-tree-manual", label: "Tree" };

  function personGalleryHref(nextPersonId: string, photoId = sourcePhotoId) {
    const params = new URLSearchParams({ from: sourceTab });
    if (sourceTab === "photos") {
      const targetPhotoId = sourcePhotoId || photoId;
      if (targetPhotoId) params.set("photoId", targetPhotoId);
    }
    return `/family-tree/${encodeURIComponent(nextPersonId)}?${params.toString()}`;
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <MobileScrollTracker />
      <MobileGalleryHeaderStatus
        personName={person ? displayName(person) : "Person"}
        personId={personId}
        personOptions={people
          .map((candidate) => ({ id: candidate.id, label: displayName(candidate) }))
          .sort((a, b) => a.label.localeCompare(b.label))}
        onPersonChange={(nextPersonId) => {
          window.location.href = personGalleryHref(nextPersonId);
        }}
        filterValue={personFilterStatus}
        filterOptions={[
          ...personFilterPeople.map((candidate) => ({
            id: candidate.id,
            label: displayName(candidate),
            checked: !!selectedWith[candidate.id],
          })),
          { id: "__solo__", label: "Solo", checked: soloOnly },
        ]}
        onFilterChange={(filterId, checked) => {
          if (filterId === "__solo__") {
            setSoloOnly(checked);
            return;
          }
          setSelectedWith((current) => ({ ...current, [filterId]: checked }));
        }}
        sortValue={personSortStatus}
        sortMode={sortMode}
        sortOptions={[
          { value: "chronological", label: "Chronological" },
          { value: "recent", label: "Most recent" },
        ]}
        onSortChange={(value) => setSortMode(value as "chronological" | "recent")}
      />
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
                    objectFit: "contain",
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
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ margin: 0 }}>{displayName(person)}</h1>
            {isEditing && person ? (
              <button
                type="button"
                onClick={openProfileEditor}
                style={{ fontSize: 12, padding: "5px 10px", minHeight: 30 }}
              >
                Edit
              </button>
            ) : null}
          </div>
          {person ? (
            <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>
              Birth year: {person.birthYear ?? "—"}
            </div>
          ) : null}
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
        <a href={backTarget.href}>
          ← Back to {backTarget.label}
        </a>
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
        <div className="mobile-control-row">
          {(() => {
            const coTags = new Map<
              string,
              { firstName: string; lastName: string; name: string }
            >();
            photos.forEach((ph) => {
              (ph.tags || []).forEach((t) => {
                if (t.person?.id && t.person.name && t.person.id !== personId) {
                  coTags.set(t.person.id, {
                    firstName: t.person.firstName || "",
                    lastName: t.person.lastName || "",
                    name: t.person.name,
                  });
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
            return (
              <details className="mobile-filter-dropdown mobile-filter-dropdown--wide">
                <summary>
                  Filter
                </summary>
                <div className="mobile-filter-options mobile-filter-options--wide" style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                  {entries.map(([id, meta]) => (
                    <label key={id} style={{ fontSize: 16, color: "#444" }}>
                      <input
                        type="checkbox"
                        checked={!!selectedWith[id]}
                        onChange={(e) =>
                          setSelectedWith((m) => ({ ...m, [id]: e.target.checked }))
                        }
                        style={{ marginRight: 8 }}
                      />
                      {meta.name}
                    </label>
                  ))}
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
              </details>
            );
          })()}
          <div className="mobile-sort-control">
            <label style={{ fontSize: 16, color: "#444" }} htmlFor="sortModePerson">Sort</label>
            <select
              id="sortModePerson"
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
        <div
          className="mobile-card-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
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
              const cardHeadline = [p.description, createdYear].filter(Boolean).join(", ");
              const others = (p.tags || [])
                .map((t) => t.person)
                .filter((tagPerson): tagPerson is PersonLike => !!tagPerson)
                .filter((tagPerson) => tagPerson.id !== person?.id)
                .sort(comparePeopleByLastFirst)
                .filter((tagPerson) => !!displayName(tagPerson));
              const nameDensityClass =
                others.length > 6
                  ? "mobile-photo-card-names--crowded"
                  : others.length > 3
                  ? "mobile-photo-card-names--dense"
                  : "";
            return (
              <div
                key={p.id}
                className="mobile-list-card mobile-photo-card"
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
                      ...imageTransform(p),
                    }}
                    onClick={() => {
                      setViewerIndex(idx);
                      setViewerOpen(true);
                    }}
                  />
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
                    {others.length > 0 ? (
                      <div className={["mobile-photo-card-names", nameDensityClass].filter(Boolean).join(" ")}>
                        <span className="mobile-photo-card-names__prefix">With</span>
                        {others.map((tagPerson) => {
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
            });
          })()}
        </div>
        </>
      )}

      {profileEditOpen && isEditing && person ? (
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
              const selectedProfile = profilePhotoIdDraft
                ? photos.find((ph) => ph.id === profilePhotoIdDraft)
                : null;
              const profilePreviewSrc = selectedProfile ? photoSrc(selectedProfile, 900, 900) : "";
              const profileRotation = selectedProfile?.rotation ?? 0;

              return (
                <div style={{ display: "grid", gap: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ fontWeight: 600 }}>Edit Profile</div>
                    <button
                      type="button"
                      onClick={() => {
                        setProfileEditOpen(false);
                        profileTouchRef.current = null;
                        profileCropDragRef.current.pointerId = null;
                      }}
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
                        cursor: profilePreviewSrc ? "grab" : "default",
                        touchAction: "none",
                      }}
                      onDragStart={(e) => e.preventDefault()}
                      onPointerDown={(e) => {
                        if (!profilePreviewSrc) return;
                        if (e.pointerType === "touch") return;
                        e.preventDefault();
                        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                        profileCropDragRef.current = {
                          pointerId: e.pointerId,
                          startX: e.clientX,
                          startY: e.clientY,
                          startCropX: profileXDraft,
                          startCropY: profileYDraft,
                          width: rect.width || 1,
                          height: rect.height || 1,
                        };
                        (e.currentTarget as HTMLDivElement).setPointerCapture?.(e.pointerId);
                      }}
                      onPointerMove={(e) => {
                        if (e.pointerType === "touch") return;
                        const drag = profileCropDragRef.current;
                        if (drag.pointerId !== e.pointerId) return;
                        e.preventDefault();
                        const dx = e.clientX - drag.startX;
                        const dy = e.clientY - drag.startY;
                        const nx = drag.startCropX + (dx / drag.width) * 100;
                        const ny = drag.startCropY + (dy / drag.height) * 100;
                        setProfileXDraft(nx);
                        setProfileYDraft(ny);
                      }}
                      onPointerUp={(e) => {
                        if (profileCropDragRef.current.pointerId === e.pointerId) {
                          (e.currentTarget as HTMLDivElement).releasePointerCapture?.(e.pointerId);
                          profileCropDragRef.current.pointerId = null;
                        }
                      }}
                      onPointerCancel={(e) => {
                        if (profileCropDragRef.current.pointerId === e.pointerId) {
                          (e.currentTarget as HTMLDivElement).releasePointerCapture?.(e.pointerId);
                          profileCropDragRef.current.pointerId = null;
                        }
                      }}
                      onTouchStart={(e) => {
                        if (!profilePreviewSrc) return;
                        startProfileTouch(e);
                      }}
                      onTouchMove={(e) => {
                        if (!profilePreviewSrc) return;
                        moveProfileTouch(e);
                      }}
                      onTouchEnd={endProfileTouch}
                      onTouchCancel={() => {
                        profileTouchRef.current = null;
                      }}
                    >
                      {profilePreviewSrc ? (
                        <img
                          src={profilePreviewSrc}
                          alt={displayName(person)}
                          draggable={false}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "contain",
                            display: "block",
                            transformOrigin: "center",
                            transform: `translate(${profileXDraft}%, ${profileYDraft}%) scale(${profileZoomDraft}) rotate(${profileRotation}deg)`,
                          }}
                        />
                      ) : (
                        <div style={{ padding: 12, color: "#999", fontSize: 13 }}>Choose a profile photo below.</div>
                      )}
                    </div>
                  </div>
                  {profilePreviewSrc ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      <label style={{ fontSize: 12, color: "#555" }}>
                        Zoom
                        <input
                          className="profile-zoom-range"
                          type="range"
                          min={PROFILE_CROP_MIN_ZOOM}
                          max={PROFILE_CROP_MAX_ZOOM}
                          step="0.05"
                          value={clampProfileZoom(profileZoomDraft)}
                          onChange={(e) => setProfileZoomDraft(clampProfileZoom(Number(e.target.value)))}
                          style={
                            {
                              "--profile-zoom-progress": profileZoomProgress(profileZoomDraft),
                            } as React.CSSProperties
                          }
                        />
                      </label>
                      <div style={{ fontSize: 12, color: "#555" }}>
                        Pinch to zoom and drag the photo to reposition.
                      </div>
                    </div>
                  ) : null}
                  <div style={{ display: "grid", gap: 6 }}>
                    <input
                      value={profileFirst}
                      onChange={(e) => setProfileFirst(e.target.value)}
                      placeholder="First name"
                      style={{ fontSize: 14, fontWeight: 600, padding: "6px 8px" }}
                    />
                    <input
                      value={profileLast}
                      onChange={(e) => setProfileLast(e.target.value)}
                      placeholder="Last name"
                      style={{ fontSize: 14, fontWeight: 600, padding: "6px 8px" }}
                    />
                    <input
                      value={profileBirth}
                      onChange={(e) => setProfileBirth(e.target.value)}
                      placeholder="Birth year"
                      inputMode="numeric"
                      style={{ fontSize: 12, padding: "6px 8px" }}
                    />
                  </div>
                  {profileError ? (
                    <div style={{ fontSize: 11, color: "#991b1b" }}>{profileError}</div>
                  ) : null}
                  <details
                    open={profilePhotoPickerOpen}
                    onToggle={(e) => setProfilePhotoPickerOpen((e.currentTarget as HTMLDetailsElement).open)}
                    className="profile-photo-picker"
                  >
                    <summary>Choose new profile picture</summary>
                    <div className="profile-photo-picker__body">
                      {photos.length > 0 ? (
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))",
                            gap: 8,
                          }}
                        >
                          {photos.map((ph) => {
                            const src = photoSrc(ph, 200, 200);
                            const isProfile = profilePhotoIdDraft === ph.id;
                            return (
                              <button
                                key={ph.id}
                                type="button"
                                onClick={() => {
                                  setProfilePhotoIdDraft(ph.id);
                                  setProfileZoomDraft(1);
                                  setProfileXDraft(0);
                                  setProfileYDraft(0);
                                }}
                                style={{
                                  padding: 0,
                                  aspectRatio: "1 / 1",
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
                      ) : (
                        <div style={{ fontSize: 12, color: "#666" }}>No tagged photos are available for profile selection.</div>
                      )}
                    </div>
                  </details>
                  <div className="photo-edit-save-row person-profile-save-row">
                    <button
                      type="button"
                      onClick={saveProfileEdits}
                      disabled={profileSaving}
                      className="photo-edit-save-button person-profile-save-button"
                    >
                      {profileSaving ? "Saving..." : "Save profile"}
                    </button>
                  </div>
                </div>
              );
            })()}
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
            className="photo-edit-modal"
          >
            {(() => {
              const p = photos.find((x) => x.id === editPhotoId);
              if (!p) return null;
              const created = p.createdTime ? new Date(p.createdTime).toISOString().slice(0, 10) : "";
              const createdYear = created ? created.slice(0, 4) : "";
              const tagNames = (p.tags || [])
                .map((t) => t.person)
                .filter((tagPerson): tagPerson is PersonLike => !!tagPerson)
                .sort(comparePeopleByLastFirst)
                .map(displayName)
                .filter(Boolean)
                ;
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
                      cursor: "default",
                    }}
                  >
                    <img
                      src={imgSrc}
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
                            .map((personOpt) => {
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
                        await saveAllEdits(p.id, created);
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

      {(() => {
        const filtered = filteredPhotos();

        const viewerSrc = (p: Photo) =>
          p.storageUrl
            ? p.storageUrl
            : p.localPath
            ? p.localPath
            : proxyImgUrl(p.baseUrl, p.id, 2000, 2000);

        return viewerOpen && filtered[viewerIndex] ? (
          <PhotoLightbox
            src={viewerSrc(filtered[viewerIndex])}
            alt={filtered[viewerIndex].id}
            rotation={filtered[viewerIndex].rotation}
            caption={filtered[viewerIndex].description}
            year={
              filtered[viewerIndex].createdTime
                ? new Date(filtered[viewerIndex].createdTime as string).toISOString().slice(0, 4)
                : null
            }
            people={(filtered[viewerIndex].tags || []).map((tag) => ({
              id: tag.person.id,
              name: displayName(tag.person),
            }))}
            getPersonHref={(nextPersonId) => personGalleryHref(nextPersonId, filtered[viewerIndex].id)}
            onClose={() => setViewerOpen(false)}
            onPrev={() => setViewerIndex((i) => (i > 0 ? i - 1 : filtered.length - 1))}
            onNext={() => setViewerIndex((i) => (i < filtered.length - 1 ? i + 1 : 0))}
          />
        ) : null;
      })()}
    </main>
  );
}
