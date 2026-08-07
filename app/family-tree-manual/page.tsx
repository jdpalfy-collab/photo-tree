// app/family-tree-manual/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useEditingMode, useGuestAccess } from "../providers";
import { useSession } from "next-auth/react";

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
  rotation?: number | null;
};

type LineType = "v-black" | "h-black" | "h-blue";
type Item =
  | { id: string; kind: "line"; lineType: LineType; x: number; y: number; length: number }
  | { id: string; kind: "heart"; x: number; y: number };
type LayoutPayload = {
  positions: Record<string, { x: number; y: number }>;
  items: Item[];
};

function proxyImgUrl(baseUrl: string, photoId: string, w = 400, h = 400) {
  return `/api/photos/image?src=${encodeURIComponent(baseUrl)}&photoId=${encodeURIComponent(
    photoId
  )}&w=${w}&h=${h}&cb=${Date.now()}`;
}

function displayName(p: Person) {
  const full = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
  return full || p.name;
}

function treeTouchDistance(touches: { [index: number]: { clientX: number; clientY: number } }) {
  const first = touches[0];
  const second = touches[1];
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

export default function FamilyTreeManualPage() {
  const { status } = useSession();
  const { guestAccess } = useGuestAccess();
  const hasAppAccess = status === "authenticated" || guestAccess;
  const { mode, setMode, editLockState, editingSessionId } = useEditingMode();
  const hasEditLease = mode === "editing" && editLockState === "held" && !!editingSessionId;
  const [people, setPeople] = useState<Person[]>([]);
  const [photosByPerson, setPhotosByPerson] = useState<Record<string, Photo[]>>({});
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [items, setItems] = useState<Item[]>([]);
  const [err, setErr] = useState<string>("");
  const [selectedPeople, setSelectedPeople] = useState<Set<string>>(new Set());
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [trashActive, setTrashActive] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string>("");
  const [isDirty, setIsDirty] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [layoutApplied, setLayoutApplied] = useState(false);
  const [layoutLoadFinished, setLayoutLoadFinished] = useState(false);
  const [layoutLoadSucceeded, setLayoutLoadSucceeded] = useState(false);
  const [peopleLoaded, setPeopleLoaded] = useState(false);
  const [editLayoutReady, setEditLayoutReady] = useState(false);
  const isEditing = hasEditLease && editLayoutReady;
  const cardSize = 220;
  const cardHeight = cardSize;
  const edgePad = 12;
  const lineThickness = 16;
  const [canvasSize, setCanvasSize] = useState({ w: 2400, h: 1800 });
  const [selectionRect, setSelectionRect] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
    active: boolean;
  }>({ x: 0, y: 0, w: 0, h: 0, active: false });

  const dragRef = useRef<{
    kind: "person" | "line" | "heart" | null;
    id: string | null;
    mode?: "move";
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    originLength?: number;
    groupPeople?: Record<string, { x: number; y: number }>;
    groupItems?: Record<string, { x: number; y: number; length?: number }>;
  }>({ kind: null, id: null, startX: 0, startY: 0, originX: 0, originY: 0 });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const treeStageShellRef = useRef<HTMLDivElement | null>(null);
  const treeStageRef = useRef<HTMLDivElement | null>(null);
  const trashRef = useRef<HTMLDivElement | null>(null);
  const lastMouseRef = useRef<{ x: number; y: number } | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const latestPayloadRef = useRef<LayoutPayload | null>(null);
  const latestPositionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const latestItemsRef = useRef<Item[]>([]);
  const snapTimerRef = useRef<number | null>(null);
  const selectRef = useRef<{ startX: number; startY: number; active: boolean }>({
    startX: 0,
    startY: 0,
    active: false,
  });
  const autoFrameAppliedRef = useRef(false);
  const mobileCenteredLayoutKeyRef = useRef<string | null>(null);
  const mobileTreeScaleRef = useRef(isEditing ? 0.115 : 0.158);
  const treePinchRef = useRef<{
    startDistance: number;
    startScale: number;
    contentX: number;
    contentY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const treePinchFrameRef = useRef<number | null>(null);
  const treeTouchPanRef = useRef<{
    startX: number;
    startY: number;
    startTime: number;
    lastX: number;
    lastY: number;
    lastTime: number;
    velocityX: number;
    velocityY: number;
    moved: boolean;
    samples: Array<{ x: number; y: number; time: number }>;
  } | null>(null);
  const treeMomentumFrameRef = useRef<number | null>(null);
  const suppressTreeNavigationUntilRef = useRef(0);
  const dragPointerRef = useRef<{ lastX: number; lastY: number }>({ lastX: 0, lastY: 0 });
  const undoStackRef = useRef<
    Array<{
      positions: Record<string, { x: number; y: number }>;
      items: Item[];
      canvasSize: { w: number; h: number };
    }>
  >([]);
  const scrollbarDragRef = useRef<{
    axis: "x" | "y";
    startClient: number;
    startScroll: number;
    trackLength: number;
    thumbLength: number;
    scrollRange: number;
  } | null>(null);
  const [treeScrollState, setTreeScrollState] = useState({
    scrollLeft: 0,
    scrollTop: 0,
    scrollWidth: 1,
    scrollHeight: 1,
    clientWidth: 1,
    clientHeight: 1,
  });
  const serverLayoutUpdatedAtRef = useRef<string | null>(null);
  const serverLayoutRevisionRef = useRef<number | null>(null);
  const suppressNextAutosaveRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const pendingSaveRef = useRef<LayoutPayload | null>(null);
  const canSaveRef = useRef(false);
  const isDirtyRef = useRef(false);
  const saveNowRef = useRef<(payload?: LayoutPayload) => Promise<void>>(async () => {});

  function expandCanvasFromOrigin(deltaX: number, deltaY: number) {
    if (deltaX <= 0 && deltaY <= 0) return;

    setCanvasSize((s) => ({ w: s.w + deltaX, h: s.h + deltaY }));
    setPositions((prev) => {
      const next: Record<string, { x: number; y: number }> = {};
      for (const [id, pos] of Object.entries(prev)) {
        next[id] = { x: pos.x + deltaX, y: pos.y + deltaY };
      }
      return next;
    });
    setItems((prev) =>
      prev.map((it) => ({
        ...it,
        x: it.x + deltaX,
        y: it.y + deltaY,
      }))
    );

    dragRef.current.originX += deltaX;
    dragRef.current.originY += deltaY;
    if (dragRef.current.groupPeople) {
      dragRef.current.groupPeople = Object.fromEntries(
        Object.entries(dragRef.current.groupPeople).map(([id, pos]) => [
          id,
          { x: pos.x + deltaX, y: pos.y + deltaY },
        ])
      );
    }
    if (dragRef.current.groupItems) {
      dragRef.current.groupItems = Object.fromEntries(
        Object.entries(dragRef.current.groupItems).map(([id, pos]) => [
          id,
          { ...pos, x: pos.x + deltaX, y: pos.y + deltaY },
        ])
      );
    }

    window.requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;

      const canScrollX = container.scrollWidth > container.clientWidth + 1;
      const canScrollY = container.scrollHeight > container.clientHeight + 1;
      const scale = Math.max(0.01, mobileTreeScaleRef.current);
      if (canScrollX) container.scrollLeft += deltaX * scale;
      if (canScrollY) container.scrollTop += deltaY * scale;

      window.scrollBy({
        left: canScrollX ? 0 : deltaX,
        top: canScrollY ? 0 : deltaY,
        behavior: "instant",
      });
    });
  }

  function currentDragDelta() {
    const drag = dragRef.current;
    if (!drag.kind) return { dx: 0, dy: 0 };
    const state = dragPointerRef.current;
    const scale = Math.max(0.01, mobileTreeScaleRef.current);
    const dx = (state.lastX - drag.startX) / scale;
    const dy = (state.lastY - drag.startY) / scale;
    const step = Math.max(2, Math.round(cardSize / 32));
    return {
      dx: Math.round(dx / step) * step,
      dy: Math.round(dy / step) * step,
    };
  }

  function lineLengthForType(lineType: LineType) {
    if (lineType === "h-black") return cardHeight * 2;
    if (lineType === "v-black") return cardHeight * 0.75;
    return cardHeight;
  }

  function itemBounds(item: Item, x: number, y: number) {
    if (item.kind === "heart") {
      return { left: x, top: y, right: x + 18, bottom: y + 18 };
    }
    const isVertical = item.lineType === "v-black";
    const len = lineLengthForType(item.lineType);
    return {
      left: x,
      top: y,
      right: x + (isVertical ? lineThickness : len),
      bottom: y + (isVertical ? len : lineThickness),
    };
  }

  function unionBounds(bounds: Array<{ left: number; top: number; right: number; bottom: number }>) {
    if (bounds.length === 0) return null;
    return bounds.reduce(
      (acc, b) => ({
        left: Math.min(acc.left, b.left),
        top: Math.min(acc.top, b.top),
        right: Math.max(acc.right, b.right),
        bottom: Math.max(acc.bottom, b.bottom),
      }),
      bounds[0]
    );
  }

  function getActiveDragCanvasBounds() {
    const drag = dragRef.current;
    if (!drag.kind || !drag.id) return null;
    const { dx, dy } = currentDragDelta();
    const bounds: Array<{ left: number; top: number; right: number; bottom: number }> = [];

    if (drag.groupPeople) {
      Object.values(drag.groupPeople).forEach((pos) => {
        bounds.push({
          left: pos.x + dx,
          top: pos.y + dy,
          right: pos.x + dx + cardSize,
          bottom: pos.y + dy + cardHeight,
        });
      });
    } else if (drag.kind === "person") {
      bounds.push({
        left: drag.originX + dx,
        top: drag.originY + dy,
        right: drag.originX + dx + cardSize,
        bottom: drag.originY + dy + cardHeight,
      });
    }

    const sourceItems = latestItemsRef.current.length ? latestItemsRef.current : items;
    if (drag.groupItems) {
      Object.entries(drag.groupItems).forEach(([id, pos]) => {
        const item = sourceItems.find((it) => it.id === id);
        if (!item) return;
        bounds.push(itemBounds(item, pos.x + dx, pos.y + dy));
      });
    } else if (drag.kind === "line" || drag.kind === "heart") {
      const item = sourceItems.find((it) => it.id === drag.id);
      if (item) bounds.push(itemBounds(item, drag.originX + dx, drag.originY + dy));
    }

    return unionBounds(bounds);
  }

  function getActiveDragScreenBounds() {
    const container = containerRef.current;
    const canvasBounds = getActiveDragCanvasBounds();
    const rect = container?.getBoundingClientRect();
    if (!container || !rect || !canvasBounds) return null;
    const scale = Math.max(0.01, mobileTreeScaleRef.current);
    return {
      left: rect.left + canvasBounds.left * scale - container.scrollLeft,
      top: rect.top + canvasBounds.top * scale - container.scrollTop,
      right: rect.left + canvasBounds.right * scale - container.scrollLeft,
      bottom: rect.top + canvasBounds.bottom * scale - container.scrollTop,
    };
  }

  function isActiveLineOverTrash() {
    if (dragRef.current.kind !== "line") return false;
    const trash = trashRef.current?.getBoundingClientRect();
    const bounds = getActiveDragScreenBounds();
    if (!trash || !bounds) return false;
    const pad = 72;
    return (
      bounds.right >= trash.left - pad &&
      bounds.left <= trash.right + pad &&
      bounds.bottom >= trash.top - pad &&
      bounds.top <= trash.bottom + pad
    );
  }

  function updateDragPointer(clientX: number, clientY: number) {
    const state = dragPointerRef.current;
    state.lastX = clientX;
    state.lastY = clientY;
  }

  function expandCanvasForEdgeBounds(
    bounds: { minX: number; minY: number; maxX: number; maxY: number },
    delta: { dx: number; dy: number }
  ) {
    const growStep = 120;
    const originGrowStep = 24;
    const shiftX = delta.dx < 0 && bounds.minX <= edgePad ? originGrowStep : 0;
    const shiftY = delta.dy < 0 && bounds.minY <= edgePad ? originGrowStep : 0;
    if (shiftX || shiftY) {
      expandCanvasFromOrigin(shiftX, shiftY);
    }
    if (delta.dx > 0 && bounds.maxX >= canvasSize.w - edgePad) {
      setCanvasSize((s) => ({ w: s.w + growStep, h: s.h }));
    }
    if (delta.dy > 0 && bounds.maxY >= canvasSize.h - edgePad) {
      setCanvasSize((s) => ({ w: s.w, h: s.h + growStep }));
    }
  }

  function getLayoutBounds(
    layoutPositions: Record<string, { x: number; y: number }>,
    layoutItems: Item[]
  ) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    Object.values(layoutPositions).forEach((p) => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + cardSize);
      maxY = Math.max(maxY, p.y + cardHeight);
    });

    layoutItems.forEach((it) => {
      if (it.kind === "heart") {
        minX = Math.min(minX, it.x);
        minY = Math.min(minY, it.y);
        maxX = Math.max(maxX, it.x + 18);
        maxY = Math.max(maxY, it.y + 18);
        return;
      }

      const isVertical = it.lineType === "v-black";
      const len = lineLengthForType(it.lineType);
      const w = isVertical ? lineThickness : len;
      const h = isVertical ? len : lineThickness;
      minX = Math.min(minX, it.x);
      minY = Math.min(minY, it.y);
      maxX = Math.max(maxX, it.x + w);
      maxY = Math.max(maxY, it.y + h);
    });

    if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
      return { minX: 0, minY: 0, maxX: cardSize, maxY: cardHeight };
    }

    return { minX, minY, maxX, maxY };
  }

  function normalizeLayoutForSave(payload: {
    positions: Record<string, { x: number; y: number }>;
    items: Item[];
  }) {
    const bounds = getLayoutBounds(payload.positions, payload.items);
    const dx = buffer - bounds.minX;
    const dy = buffer - bounds.minY;
    const nextPositions: Record<string, { x: number; y: number }> = {};

    for (const [id, pos] of Object.entries(payload.positions)) {
      nextPositions[id] = { x: pos.x + dx, y: pos.y + dy };
    }

    const nextItems = payload.items.map((it) => ({
      ...it,
      x: it.x + dx,
      y: it.y + dy,
    }));

    const width = Math.max(800, Math.ceil(bounds.maxX - bounds.minX + buffer * 2));
    const height = Math.max(800, Math.ceil(bounds.maxY - bounds.minY + buffer * 2));
    const changed = dx !== 0 || dy !== 0 || width !== canvasSize.w || height !== canvasSize.h;

    return {
      payload: { positions: nextPositions, items: nextItems },
      canvasSize: { w: width, h: height },
      changed,
      dx,
      dy,
    };
  }

  function applyRemoteLayout(data: string, updatedAt?: string | null, revision?: number | null) {
    if (!data) return false;
    let parsed: { positions?: unknown; items?: unknown };
    try {
      parsed = JSON.parse(data);
    } catch {
      return false;
    }
    if (!parsed?.positions || typeof parsed.positions !== "object" || Array.isArray(parsed.positions)) {
      return false;
    }
    if (!Array.isArray(parsed.items)) return false;
    const normalized = normalizeLayoutForSave({
      positions: parsed.positions as Record<string, { x: number; y: number }>,
      items: parsed.items as Item[],
    });
    const nextPositions = normalized.payload.positions;
    const nextItems = normalized.payload.items;
    latestPayloadRef.current = normalized.payload;
    latestPositionsRef.current = nextPositions;
    latestItemsRef.current = nextItems;
    suppressNextAutosaveRef.current = true;
    if (updatedAt) {
      serverLayoutUpdatedAtRef.current = updatedAt;
    }
    if (typeof revision === "number") {
      serverLayoutRevisionRef.current = revision;
    }
    setPositions(nextPositions);
    setItems(nextItems);
    setCanvasSize(normalized.canvasSize);
    window.localStorage.setItem("photoTreeManualState", JSON.stringify(normalized.payload));
    setLayoutApplied(true);
    setIsDirty(false);
    return true;
  }

  useEffect(() => {
    if (!hasAppAccess) return;
    let cancelled = false;
    setLayoutLoadFinished(false);
    setLayoutLoadSucceeded(false);
    setIsHydrated(false);
    void fetch("/api/manual-layout", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result?.ok) {
          throw new Error(result?.error || "Tree layout could not be loaded.");
        }
        if (cancelled) return;
        if (typeof result?.data === "string" && result.data) {
          const applied = applyRemoteLayout(
            result.data,
            result?.layout?.updatedAt,
            result?.layout?.revision
          );
          if (!applied) throw new Error("The saved tree layout is invalid.");
          setLayoutLoadSucceeded(true);
          return;
        }
        serverLayoutUpdatedAtRef.current = null;
        serverLayoutRevisionRef.current = null;
        setLayoutApplied(false);
        setLayoutLoadSucceeded(true);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setErr(error instanceof Error ? error.message : "Tree layout could not be loaded.");
        }
      })
      .finally(() => {
        if (!cancelled) setLayoutLoadFinished(true);
      });
    return () => {
      cancelled = true;
    };
  }, [hasAppAccess]);

  canSaveRef.current =
    hasAppAccess && isEditing && isHydrated && layoutApplied && !!editingSessionId;
  isDirtyRef.current = isDirty;

  async function saveNow(payload?: LayoutPayload) {
    if (!canSaveRef.current || !editingSessionId) return;
    const requestedPayload = payload || latestPayloadRef.current || { positions, items };
    if (saveInFlightRef.current) {
      pendingSaveRef.current = requestedPayload;
      return;
    }
    saveInFlightRef.current = true;
    const viewportBefore = containerRef.current
      ? {
          scrollLeft: containerRef.current.scrollLeft,
          scrollTop: containerRef.current.scrollTop,
          scale: Math.max(0.01, mobileTreeScaleRef.current),
        }
      : null;
    const normalized = normalizeLayoutForSave(requestedPayload);
    const data = normalized.payload;
    latestPayloadRef.current = data;
    if (normalized.changed) {
      suppressNextAutosaveRef.current = true;
      setPositions(data.positions);
      setItems(data.items);
      setCanvasSize(normalized.canvasSize);
      window.localStorage.setItem("photoTreeManualState", JSON.stringify(data));
      window.requestAnimationFrame(() => {
        if (containerRef.current) {
          const scale = viewportBefore?.scale ?? Math.max(0.01, mobileTreeScaleRef.current);
          const nextLeft = (viewportBefore?.scrollLeft ?? containerRef.current.scrollLeft) + normalized.dx * scale;
          const nextTop = (viewportBefore?.scrollTop ?? containerRef.current.scrollTop) + normalized.dy * scale;
          const maxLeft = Math.max(0, containerRef.current.scrollWidth - containerRef.current.clientWidth);
          const maxTop = Math.max(0, containerRef.current.scrollHeight - containerRef.current.clientHeight);
          containerRef.current.scrollLeft = Math.min(maxLeft, Math.max(0, nextLeft));
          containerRef.current.scrollTop = Math.min(maxTop, Math.max(0, nextTop));
          updateTreeScrollState();
        }
      });
    }
    setSaveStatus("saving");
    setSaveError("");
    try {
      const res = await fetch("/api/manual-layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: JSON.stringify(data),
          baseUpdatedAt: serverLayoutUpdatedAtRef.current,
          baseRevision: serverLayoutRevisionRef.current,
          editorId: editingSessionId,
        }),
        keepalive: true,
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 409 && typeof j?.data === "string") {
        applyRemoteLayout(j.data, j?.layout?.updatedAt, j?.layout?.revision);
        pendingSaveRef.current = null;
        setSaveStatus("error");
        setSaveError("A newer tree version was loaded. Re-enter Editing Mode to make another change.");
        setIsDirty(false);
        setMode("viewing");
        return;
      }
      if (res.status === 423) {
        pendingSaveRef.current = null;
        setSaveStatus("error");
        setSaveError("Editing access expired. Re-enter Editing Mode to continue.");
        setIsDirty(false);
        setMode("viewing");
        return;
      }
      if (!res.ok) {
        throw new Error(j?.error || "save failed");
      }
      if (j?.layout?.updatedAt) {
        serverLayoutUpdatedAtRef.current = j.layout.updatedAt;
      }
      if (typeof j?.layout?.revision === "number") {
        serverLayoutRevisionRef.current = j.layout.revision;
      }
      if (!pendingSaveRef.current) {
        setSaveStatus("saved");
        setIsDirty(false);
        window.setTimeout(() => setSaveStatus("idle"), 1500);
      }
    } catch (error: unknown) {
      setSaveStatus("error");
      setSaveError(error instanceof Error ? error.message : "Save failed. Check the connection.");
    } finally {
      saveInFlightRef.current = false;
      const pending = pendingSaveRef.current;
      pendingSaveRef.current = null;
      if (pending && canSaveRef.current) {
        await saveNow(pending);
      }
    }
  }
  saveNowRef.current = saveNow;

  useEffect(() => {
    if (!isHydrated) return;
    const payload = { positions, items };
    latestPositionsRef.current = positions;
    latestItemsRef.current = items;
    latestPayloadRef.current = payload;
    window.localStorage.setItem("photoTreeManualState", JSON.stringify(payload));
    if (!isEditing) {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      setIsDirty(false);
      setSaveStatus("idle");
      return;
    }
    if (suppressNextAutosaveRef.current) {
      suppressNextAutosaveRef.current = false;
      setIsDirty(false);
      setSaveStatus("idle");
      return;
    }
    setIsDirty(true);
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    setSaveStatus("saving");
    saveTimerRef.current = window.setTimeout(() => {
      void saveNowRef.current(payload);
    }, 650);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [positions, items, isEditing, isHydrated]);

  useEffect(() => {
    function onVisChange() {
      if (document.visibilityState === "hidden") {
        if (canSaveRef.current && isDirtyRef.current) void saveNowRef.current();
      }
    }
    window.addEventListener("beforeunload", onVisChange);
    document.addEventListener("visibilitychange", onVisChange);
    return () => {
      window.removeEventListener("beforeunload", onVisChange);
      document.removeEventListener("visibilitychange", onVisChange);
    };
  }, []);

  useEffect(() => {
    if (!isEditing || !isDirty) return;
    const id = window.setInterval(() => {
      void saveNowRef.current();
    }, 5000);
    return () => window.clearInterval(id);
  }, [isDirty, isEditing]);

  async function loadPeople() {
    setErr("");
    const r = await fetch("/api/people", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErr(JSON.stringify(j, null, 2));
      return;
    }
    const list: Person[] = Array.isArray(j?.people) ? j.people : [];
    setPeople(list);
    setPeopleLoaded(true);
  }

  async function loadPhotos(personId: string) {
    const r = await fetch(`/api/people/${personId}/photos`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return;
    setPhotosByPerson((m) => ({ ...m, [personId]: Array.isArray(j?.photos) ? j.photos : [] }));
  }

  useEffect(() => {
    if (!hasAppAccess) return;
    loadPeople();
  }, [hasAppAccess]);

  useEffect(() => {
    if (people.length === 0) return;
    people.forEach((p) => {
      if (!photosByPerson[p.id]) loadPhotos(p.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people.length]);

  useEffect(() => {
    if (!layoutLoadFinished || !layoutLoadSucceeded || !peopleLoaded) return;
    suppressNextAutosaveRef.current = true;
    setPositions((previous) => {
      const next = { ...previous };
      const missing = people.filter((person) => !next[person.id]);
      if (missing.length === 0) {
        latestPositionsRef.current = next;
        latestPayloadRef.current = { positions: next, items: latestItemsRef.current };
        return previous;
      }

      const existing = Object.values(next);
      const startY = existing.length > 0 ? Math.max(...existing.map((position) => position.y)) + cardHeight + 80 : buffer;
      const columns = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(missing.length))));
      missing.forEach((person, index) => {
        next[person.id] = {
          x: buffer + (index % columns) * (cardSize + 80),
          y: startY + Math.floor(index / columns) * (cardHeight + 80),
        };
      });
      latestPositionsRef.current = next;
      latestPayloadRef.current = { positions: next, items: latestItemsRef.current };
      return next;
    });
    setLayoutApplied(true);
    setIsHydrated(true);
  }, [layoutLoadFinished, layoutLoadSucceeded, people, peopleLoaded]);

  useEffect(() => {
    if (!hasEditLease) {
      setEditLayoutReady(false);
      return;
    }
    if (!isHydrated) return;
    let cancelled = false;
    setEditLayoutReady(false);
    setSaveStatus("saving");
    void fetch("/api/manual-layout", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result?.ok) throw new Error(result?.error || "Latest tree could not be confirmed.");
        if (cancelled) return;
        if (typeof result?.data === "string" && result.data) {
          const applied = applyRemoteLayout(
            result.data,
            result?.layout?.updatedAt,
            result?.layout?.revision
          );
          if (!applied) throw new Error("The saved tree layout is invalid.");
        }
        setSaveStatus("idle");
        setEditLayoutReady(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSaveStatus("error");
        setSaveError(error instanceof Error ? error.message : "Latest tree could not be confirmed.");
        setMode("viewing");
      });
    return () => {
      cancelled = true;
    };
  }, [editingSessionId, hasEditLease, isHydrated]);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!isEditing) return;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      if (selectRef.current.active) {
        e.preventDefault();
        const { x, y } = clientToCanvasPoint(e.clientX, e.clientY);
        const sx = selectRef.current.startX;
        const sy = selectRef.current.startY;
        const left = Math.min(sx, x);
        const top = Math.min(sy, y);
        const w = Math.abs(x - sx);
        const h = Math.abs(y - sy);
        setSelectionRect({ x: left, y: top, w, h, active: true });
        return;
      }
      if (!dragRef.current.kind || !dragRef.current.id) return;
      e.preventDefault();
      updateDragPointer(e.clientX, e.clientY);
      setTrashActive(isActiveLineOverTrash());
      const scale = Math.max(0.01, mobileTreeScaleRef.current);
      const dx = (e.clientX - dragRef.current.startX) / scale;
      const dy = (e.clientY - dragRef.current.startY) / scale;
      const step = Math.max(2, Math.round(cardSize / 32));
      const qdx = Math.round(dx / step) * step;
      const qdy = Math.round(dy / step) * step;
      const id = dragRef.current.id;

      if (dragRef.current.kind === "person") {
        const boundsW = canvasSize.w;
        const boundsH = canvasSize.h;
        const clampGroupDelta = (base: Record<string, { x: number; y: number }>) => {
          if (boundsW <= 0 || boundsH <= 0) return { dx, dy };
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          Object.values(base).forEach((p) => {
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x + cardSize > maxX) maxX = p.x + cardSize;
            if (p.y + cardHeight > maxY) maxY = p.y + cardHeight;
          });
          if (!Number.isFinite(minX) || !Number.isFinite(minY)) return { dx, dy };
          const minDx = edgePad - minX;
          const maxDx = boundsW - edgePad - maxX;
          const minDy = edgePad - minY;
          const maxDy = boundsH - edgePad - maxY;
          return {
            dx: Math.min(Math.max(qdx, minDx), maxDx),
            dy: Math.min(Math.max(qdy, minDy), maxDy),
          };
        };

        if (dragRef.current.groupPeople) {
          const clamped = clampGroupDelta(dragRef.current.groupPeople);
          setPositions((m) => {
            const next = { ...m };
            Object.entries(dragRef.current.groupPeople || {}).forEach(([pid, pos]) => {
              next[pid] = { x: pos.x + clamped.dx, y: pos.y + clamped.dy };
            });
            return next;
          });
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          Object.values(dragRef.current.groupPeople || {}).forEach((pos) => {
            const nx = pos.x + clamped.dx;
            const ny = pos.y + clamped.dy;
            if (nx < minX) minX = nx;
            if (ny < minY) minY = ny;
            if (nx + cardSize > maxX) maxX = nx + cardSize;
            if (ny + cardHeight > maxY) maxY = ny + cardHeight;
          });
          expandCanvasForEdgeBounds({ minX, minY, maxX, maxY }, clamped);
        } else {
          const nx = dragRef.current.originX + qdx;
          const ny = dragRef.current.originY + qdy;
          const clampedX =
            boundsW > 0 ? Math.min(Math.max(nx, edgePad), boundsW - edgePad - cardSize) : nx;
          const clampedY =
            boundsH > 0 ? Math.min(Math.max(ny, edgePad), boundsH - edgePad - cardHeight) : ny;
          setPositions((m) => ({
            ...m,
            [id]: { x: clampedX, y: clampedY },
          }));
          expandCanvasForEdgeBounds(
            { minX: clampedX, minY: clampedY, maxX: clampedX + cardSize, maxY: clampedY + cardHeight },
            { dx: qdx, dy: qdy }
          );
        }
        if (dragRef.current.groupItems) {
          const clamped = dragRef.current.groupPeople
            ? clampGroupDelta(dragRef.current.groupPeople)
            : { dx: qdx, dy: qdy };
          setItems((prev) =>
            prev.map((it) => {
              const base = dragRef.current.groupItems?.[it.id];
              if (!base) return it;
              if (it.kind === "line") return { ...it, x: base.x + clamped.dx, y: base.y + clamped.dy };
              if (it.kind === "heart") return { ...it, x: base.x + clamped.dx, y: base.y + clamped.dy };
              return it;
            })
          );
        }
        return;
      }

      if (dragRef.current.kind === "heart") {
        if (dragRef.current.groupItems) {
          setItems((prev) =>
            prev.map((it) => {
              const base = dragRef.current.groupItems?.[it.id];
              if (!base) return it;
              if (it.kind === "heart") return { ...it, x: base.x + qdx, y: base.y + qdy };
              if (it.kind === "line") return { ...it, x: base.x + qdx, y: base.y + qdy };
              return it;
            })
          );
        } else {
          setItems((prev) =>
            prev.map((it) =>
              it.id === id && it.kind === "heart"
                ? { ...it, x: dragRef.current.originX + qdx, y: dragRef.current.originY + qdy }
                : it
            )
          );
        }
        if (dragRef.current.groupPeople) {
          setPositions((m) => {
            const next = { ...m };
            Object.entries(dragRef.current.groupPeople || {}).forEach(([pid, pos]) => {
              next[pid] = { x: pos.x + qdx, y: pos.y + qdy };
            });
            return next;
          });
        }
        const bounds = getActiveDragCanvasBounds();
        if (bounds) {
          expandCanvasForEdgeBounds(
            { minX: bounds.left, minY: bounds.top, maxX: bounds.right, maxY: bounds.bottom },
            { dx: qdx, dy: qdy }
          );
        }
        return;
      }

      if (dragRef.current.kind === "line") {
        const snapThreshold = 10;
        const lineLen = (it: Item) => (it.kind === "line" ? lineLengthForType(it.lineType) : 0);
        const endpoints = (it: Item) => {
          if (it.kind !== "line") return [];
          const isVertical = it.lineType === "v-black";
          const len = lineLen(it);
          if (isVertical) {
            return [
              { x: it.x, y: it.y },
              { x: it.x, y: it.y + len },
            ];
          }
          return [
            { x: it.x, y: it.y },
            { x: it.x + len, y: it.y },
          ];
        };
        const allEndpoints = items.flatMap((it) => (it.id === id ? [] : endpoints(it)));

        setItems((prev) => {
          if (dragRef.current.groupItems && dragRef.current.mode === "move") {
            return prev.map((it) => {
              const base = dragRef.current.groupItems?.[it.id];
              if (!base) return it;
              if (it.kind === "line") return { ...it, x: base.x + qdx, y: base.y + qdy };
              if (it.kind === "heart") return { ...it, x: base.x + qdx, y: base.y + qdy };
              return it;
            });
          }
          return prev.map((it) => {
            if (it.id !== id || it.kind !== "line") return it;
            const isVertical = it.lineType === "v-black";
            const fixedLen = lineLen(it);
            let nx = dragRef.current.originX + qdx;
            let ny = dragRef.current.originY + qdy;
              // snap moved line by matching endpoints
              const moved = { ...it, x: nx, y: ny, length: fixedLen };
              const movedEnds = endpoints(moved);
              for (const me of movedEnds) {
                const hit = allEndpoints.find(
                  (p) => Math.abs(p.x - me.x) <= snapThreshold && Math.abs(p.y - me.y) <= snapThreshold
                );
                if (hit) {
                  nx += hit.x - me.x;
                  ny += hit.y - me.y;
                  break;
                }
              }
              // live snap for blue horizontal line between two cards
              if (it.lineType === "h-blue") {
                const lineY = ny;
                const lineX1 = nx;
                const lineX2 = nx + fixedLen;
                const tol = 40;
                const currentPositions = latestPositionsRef.current;
                const candidates = people
                  .map((p) => {
                    const pos = currentPositions[p.id];
                    if (!pos) return null;
                    const top = pos.y;
                    const bottom = pos.y + cardHeight;
                    const left = pos.x;
                    const right = pos.x + cardSize;
                    const yOk = lineY >= top - tol && lineY <= bottom + tol;
                    const intersects = lineX1 <= right && lineX2 >= left;
                    const touchesEdge =
                      Math.abs(lineX2 - left) <= tol || Math.abs(lineX1 - right) <= tol;
                    const xOk = intersects || touchesEdge;
                    if (!yOk || !xOk) return null;
                    return { id: p.id, x: pos.x, y: pos.y };
                  })
                  .filter(Boolean) as { id: string; x: number; y: number }[];
                if (candidates.length >= 2) {
                  const sorted = candidates.sort((a, b) => a.x - b.x);
                  const leftCard = sorted[0];
                  const rightCard = sorted[sorted.length - 1];
                  const alignedY = Math.min(leftCard.y, rightCard.y);
                  const newLineX = leftCard.x + cardSize;
                  const newLen = Math.max(10, rightCard.x - newLineX);
                  const newLineY = alignedY + cardHeight / 2;
                  nx = newLineX;
                  ny = newLineY;
                  // align both cards while dragging
                  setPositions((prevPos) => ({
                    ...prevPos,
                    [leftCard.id]: { x: prevPos[leftCard.id].x, y: alignedY },
                    [rightCard.id]: { x: prevPos[rightCard.id].x, y: alignedY },
                  }));
                  return { ...it, x: nx, y: ny, length: fixedLen };
                }
              }
              return { ...it, x: nx, y: ny, length: fixedLen };
          });
        });
        const bounds = getActiveDragCanvasBounds();
        if (bounds) {
          expandCanvasForEdgeBounds(
            { minX: bounds.left, minY: bounds.top, maxX: bounds.right, maxY: bounds.bottom },
            { dx: qdx, dy: qdy }
          );
        }
        if (dragRef.current.groupPeople && dragRef.current.mode === "move") {
          setPositions((m) => {
            const next = { ...m };
            Object.entries(dragRef.current.groupPeople || {}).forEach(([pid, pos]) => {
              next[pid] = { x: pos.x + qdx, y: pos.y + qdy };
            });
            return next;
          });
        }
      }
    }

    function onUp(e: PointerEvent) {
      if (!isEditing) return;
      e.preventDefault();
      if (dragRef.current.kind) {
        dragPointerRef.current.lastX = e.clientX;
        dragPointerRef.current.lastY = e.clientY;
      }
      const droppedOnTrash = isActiveLineOverTrash();
      if (selectRef.current.active) {
        const rect = selectionRect;
        if (rect.w > 4 && rect.h > 4) {
          const inRect = (bx: number, by: number, bw: number, bh: number) => {
            return (
              bx + bw >= rect.x &&
              by + bh >= rect.y &&
              bx <= rect.x + rect.w &&
              by <= rect.y + rect.h
            );
          };
          const nextPeople = new Set<string>();
          const nextItems = new Set<string>();
          people.forEach((p) => {
            const pos = positions[p.id];
            if (!pos) return;
            const bw = cardSize;
            const bh = cardHeight;
            if (inRect(pos.x, pos.y, bw, bh)) nextPeople.add(p.id);
          });
          items.forEach((it) => {
            if (it.kind === "heart") {
              if (inRect(it.x, it.y, 18, 18)) nextItems.add(it.id);
            } else {
              const isVertical = it.lineType === "v-black";
              const len = lineLengthForType(it.lineType);
              const bw = isVertical ? lineThickness : len;
              const bh = isVertical ? len : lineThickness;
              if (inRect(it.x, it.y, bw, bh)) nextItems.add(it.id);
            }
          });
          setSelectedPeople(nextPeople);
          setSelectedItems(nextItems);
        } else {
          setSelectedPeople(new Set());
          setSelectedItems(new Set());
        }
        selectRef.current.active = false;
        setSelectionRect({ x: 0, y: 0, w: 0, h: 0, active: false });
        return;
      }
      if (dragRef.current.kind === "line" && dragRef.current.id) {
        if (droppedOnTrash) {
          const removeId = dragRef.current.id;
          setItems((prev) => prev.filter((it) => it.id !== removeId));
          setSelectedItems((s) => {
            const next = new Set(s);
            next.delete(removeId);
            return next;
          });
          setActiveLineId(null);
        }
        const lineId = dragRef.current.id;
        const line = latestItemsRef.current.find((it) => it.id === lineId);
        if (line && line.kind === "line" && line.lineType === "h-blue") {
          const currentItems = latestItemsRef.current;
          const currentPositions = latestPositionsRef.current;
          const target = currentItems.find((it) => it.id === lineId);
          if (!target || target.kind !== "line" || target.lineType !== "h-blue") {
            dragRef.current = { kind: null, id: null, startX: 0, startY: 0, originX: 0, originY: 0 };
            return;
          }
          const lineY = target.y;
          const lineX1 = target.x;
          const lineX2 = target.x + target.length;
          const tol = 20;
          const candidates = people
            .map((p) => {
              const pos = currentPositions[p.id];
              if (!pos) return null;
              const top = pos.y;
              const bottom = pos.y + cardHeight;
              const left = pos.x;
              const right = pos.x + cardSize;
              const yOk = lineY >= top - tol && lineY <= bottom + tol;
              const xOk = lineX2 >= left - tol && lineX1 <= right + tol;
              if (!yOk || !xOk) return null;
              return { id: p.id, x: pos.x, y: pos.y };
            })
            .filter(Boolean) as { id: string; x: number; y: number }[];

          if (candidates.length >= 2) {
            const sorted = candidates.sort((a, b) => a.x - b.x);
            const leftCard = sorted[0];
            const rightCard = sorted[sorted.length - 1];
            const alignedY = Math.min(leftCard.y, rightCard.y);
            const newLineX = leftCard.x + cardSize;
            const newLen = Math.max(10, rightCard.x - newLineX);
            const newLineY = alignedY + cardHeight / 2;

            setPositions((prev) => ({
              ...prev,
              [leftCard.id]: { x: prev[leftCard.id].x, y: alignedY },
              [rightCard.id]: { x: prev[rightCard.id].x, y: alignedY },
            }));
            setItems((prev) =>
              prev.map((it) =>
                it.id === lineId && it.kind === "line"
                  ? { ...it, x: newLineX, y: newLineY, length: newLen }
                  : it
              )
            );
          }
        }
      }
      dragRef.current = { kind: null, id: null, startX: 0, startY: 0, originX: 0, originY: 0 };
      setTrashActive(false);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (!isEditing) return;
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (selectedItems.size === 0) return;
      setItems((prev) => prev.filter((it) => !selectedItems.has(it.id)));
      setSelectedItems(new Set());
      setActiveLineId(null);
    }

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp, { passive: false });
    window.addEventListener("pointercancel", onUp, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKeyDown);
      setTrashActive(false);
    };
  }, [selectedItems, isEditing, canvasSize.w, canvasSize.h, selectionRect, people, positions, items]);

  function startDragPerson(id: string, e: React.PointerEvent<HTMLDivElement>) {
    if (!isEditing) return;
    if (e.button === 2) return;
    e.preventDefault();
    e.stopPropagation();
    pushUndoSnapshot();
    if (e.shiftKey) {
      setSelectedPeople((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }
    const pos = positions[id] || { x: 0, y: 0 };
    const groupPeople: Record<string, { x: number; y: number }> = {};
    const draggingSelected = selectedPeople.has(id);
    if (draggingSelected) {
      selectedPeople.forEach((pid) => {
        const ppos = positions[pid];
        if (ppos) groupPeople[pid] = { x: ppos.x, y: ppos.y };
      });
    } else {
      const ppos = positions[id];
      if (ppos) groupPeople[id] = { x: ppos.x, y: ppos.y };
      setSelectedPeople(new Set([id]));
      setSelectedItems(new Set());
    }
    const groupItems: Record<string, { x: number; y: number; length?: number }> = {};
    if (draggingSelected) {
      selectedItems.forEach((iid) => {
        const item = items.find((x) => x.id === iid);
        if (item && item.kind === "line") groupItems[iid] = { x: item.x, y: item.y, length: item.length };
        if (item && item.kind === "heart") groupItems[iid] = { x: item.x, y: item.y };
      });
    }
    dragRef.current = {
      kind: "person",
      id,
      startX: e.clientX,
      startY: e.clientY,
      originX: pos.x,
      originY: pos.y,
      groupPeople: Object.keys(groupPeople).length ? groupPeople : undefined,
      groupItems: Object.keys(groupItems).length ? groupItems : undefined,
    };
    updateDragPointer(e.clientX, e.clientY);
    setTrashActive(false);
  }

  function startDragLine(id: string, e: React.PointerEvent<HTMLDivElement>, mode: "move") {
    if (!isEditing) return;
    if (e.button === 2) return;
    e.preventDefault();
    e.stopPropagation();
    pushUndoSnapshot();
    if (e.shiftKey && mode === "move") {
      setSelectedItems((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }
    const it = items.find((x) => x.id === id) as Item | undefined;
    if (!it || it.kind !== "line") return;
    const groupItems: Record<string, { x: number; y: number; length?: number }> = {};
    if (mode === "move") {
      if (selectedItems.has(id)) {
        selectedItems.forEach((iid) => {
          const item = items.find((x) => x.id === iid);
          if (item && item.kind === "line") groupItems[iid] = { x: item.x, y: item.y, length: item.length };
          if (item && item.kind === "heart") groupItems[iid] = { x: item.x, y: item.y };
        });
      } else {
        groupItems[id] = { x: it.x, y: it.y, length: it.length };
        setSelectedItems(new Set([id]));
        setSelectedPeople(new Set());
      }
    }
    const groupPeople: Record<string, { x: number; y: number }> = {};
    if (mode === "move") {
      if (selectedItems.has(id)) {
        selectedPeople.forEach((pid) => {
          const ppos = positions[pid];
          if (ppos) groupPeople[pid] = { x: ppos.x, y: ppos.y };
        });
      }
    }
    dragRef.current = {
      kind: "line",
      id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      originX: it.x,
      originY: it.y,
      originLength: it.length,
      groupItems: Object.keys(groupItems).length ? groupItems : undefined,
      groupPeople: Object.keys(groupPeople).length ? groupPeople : undefined,
    };
    setActiveLineId(id);
    updateDragPointer(e.clientX, e.clientY);
    setTrashActive(false);
  }

  function startDragHeart(id: string, e: React.PointerEvent<HTMLDivElement>) {
    if (!isEditing) return;
    if (e.button === 2) return;
    e.preventDefault();
    e.stopPropagation();
    pushUndoSnapshot();
    if (e.shiftKey) {
      setSelectedItems((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      return;
    }
    const it = items.find((x) => x.id === id) as Item | undefined;
    if (!it || it.kind !== "heart") return;
    const groupItems: Record<string, { x: number; y: number; length?: number }> = {};
    if (selectedItems.has(id)) {
      selectedItems.forEach((iid) => {
        const item = items.find((x) => x.id === iid);
        if (item && item.kind === "line") groupItems[iid] = { x: item.x, y: item.y, length: item.length };
        if (item && item.kind === "heart") groupItems[iid] = { x: item.x, y: item.y };
      });
    } else {
      groupItems[id] = { x: it.x, y: it.y };
      setSelectedItems(new Set([id]));
      setSelectedPeople(new Set());
    }
    const groupPeople: Record<string, { x: number; y: number }> = {};
    if (selectedItems.has(id)) {
      selectedPeople.forEach((pid) => {
        const ppos = positions[pid];
        if (ppos) groupPeople[pid] = { x: ppos.x, y: ppos.y };
      });
    }
    dragRef.current = {
      kind: "heart",
      id,
      startX: e.clientX,
      startY: e.clientY,
      originX: it.x,
      originY: it.y,
      groupItems: Object.keys(groupItems).length ? groupItems : undefined,
      groupPeople: Object.keys(groupPeople).length ? groupPeople : undefined,
    };
    updateDragPointer(e.clientX, e.clientY);
    setTrashActive(false);
  }

  function addLine(lineType: LineType) {
    const id = `line_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const length = lineLengthForType(lineType);
    const viewport = visibleCanvasViewport();
    const isVertical = lineType === "v-black";
    const visibleTop = viewport.top + Math.min(72, Math.max(36, viewport.height * 0.16));
    const visibleCenterX = viewport.left + viewport.width / 2;
    const x = Math.max(
      edgePad,
      Math.min(
        canvasSize.w - edgePad - (isVertical ? lineThickness : length),
        visibleCenterX - (isVertical ? lineThickness / 2 : length / 2)
      )
    );
    const y = Math.max(
      edgePad,
      Math.min(
        canvasSize.h - edgePad - (isVertical ? length : lineThickness),
        visibleTop
      )
    );
    pushUndoSnapshot();
    setItems((prev) => [
      ...prev,
      { id, kind: "line", lineType, x, y, length },
    ]);
    setActiveLineId(id);
    setSelectedItems(new Set([id]));
    setSelectedPeople(new Set());
  }

  function addHeart() {
    const id = `heart_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const center = visibleCanvasCenter();
    pushUndoSnapshot();
    setItems((prev) => [...prev, { id, kind: "heart", x: center.x - 9, y: center.y - 9 }]);
  }

  function resetLayoutGrid() {
    const next: Record<string, { x: number; y: number }> = {};
    people.forEach((p) => {
      next[p.id] = { x: 0, y: 0 };
    });
    setPositions(next);
  }

  function resetAllToOrigin() {
    const next: Record<string, { x: number; y: number }> = {};
    people.forEach((p) => {
      next[p.id] = { x: 0, y: 0 };
    });
    setPositions(next);
    setItems((prev) =>
      prev.map((it) => ({
        ...it,
        x: 0,
        y: 0,
      }))
    );
  }

  const [activeLineId, setActiveLineId] = useState<string | null>(null);
  const buffer = cardSize;
  const mobileTreeMinScale = isEditing ? 0.115 : 0.158;
  const mobileTreeMaxScale = 1.0;
  const [mobileTreeScale, setMobileTreeScale] = useState(() => (isEditing ? 0.115 : 0.158));

  useEffect(() => {
    mobileTreeScaleRef.current = mobileTreeScale;
  }, [mobileTreeScale]);

  useEffect(() => {
    return () => {
      if (treePinchFrameRef.current) {
        window.cancelAnimationFrame(treePinchFrameRef.current);
        treePinchFrameRef.current = null;
      }
      if (treeMomentumFrameRef.current) {
        window.cancelAnimationFrame(treeMomentumFrameRef.current);
        treeMomentumFrameRef.current = null;
      }
    };
  }, []);

  function clampMobileTreeScale(scale: number) {
    return Math.min(mobileTreeMaxScale, Math.max(mobileTreeMinScale, scale));
  }

  useEffect(() => {
    setMobileTreeScale((scale) => clampMobileTreeScale(scale));
    mobileTreeScaleRef.current = clampMobileTreeScale(mobileTreeScaleRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  function updateTreeScrollState() {
    const container = containerRef.current;
    if (!container) return;
    setTreeScrollState({
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
      scrollWidth: Math.max(1, container.scrollWidth),
      scrollHeight: Math.max(1, container.scrollHeight),
      clientWidth: Math.max(1, container.clientWidth),
      clientHeight: Math.max(1, container.clientHeight),
    });
  }

  function clientToCanvasPoint(clientX: number, clientY: number) {
    const container = containerRef.current;
    const rect = container?.getBoundingClientRect();
    const scale = Math.max(0.01, mobileTreeScaleRef.current);
    if (!container || !rect) return { x: 0, y: 0 };
    return {
      x: (container.scrollLeft + clientX - rect.left) / scale,
      y: (container.scrollTop + clientY - rect.top) / scale,
    };
  }

  function visibleCanvasCenter() {
    const container = containerRef.current;
    const scale = Math.max(0.01, mobileTreeScaleRef.current);
    if (!container) {
      return { x: canvasSize.w / 2, y: canvasSize.h / 2 };
    }
    return {
      x: (container.scrollLeft + container.clientWidth / 2) / scale,
      y: (container.scrollTop + container.clientHeight / 2) / scale,
    };
  }

  function visibleCanvasViewport() {
    const container = containerRef.current;
    const scale = Math.max(0.01, mobileTreeScaleRef.current);
    if (!container) {
      return { left: 0, top: 0, width: canvasSize.w, height: canvasSize.h };
    }
    return {
      left: container.scrollLeft / scale,
      top: container.scrollTop / scale,
      width: container.clientWidth / scale,
      height: container.clientHeight / scale,
    };
  }

  function pushUndoSnapshot() {
    undoStackRef.current = [
      ...undoStackRef.current.slice(-19),
      {
        positions: JSON.parse(JSON.stringify(positions)),
        items: JSON.parse(JSON.stringify(items)),
        canvasSize: { ...canvasSize },
      },
    ];
  }

  function undoLayoutChange() {
    const snapshot = undoStackRef.current.pop();
    if (!snapshot) return;
    setPositions(snapshot.positions);
    setItems(snapshot.items);
    setCanvasSize(snapshot.canvasSize);
    setSelectedPeople(new Set());
    setSelectedItems(new Set());
    setActiveLineId(null);
  }

  function startTreePinch(touches: React.TouchList) {
    if (touches.length !== 2) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const stageRect = treeStageRef.current?.getBoundingClientRect();
    const localX = container.clientWidth / 2;
    const localY = container.clientHeight / 2;
    const centerX = rect.left + localX;
    const centerY = rect.top + localY;
    const scale = Math.max(0.01, mobileTreeScaleRef.current);
    treePinchRef.current = {
      startDistance: treeTouchDistance(touches),
      startScale: scale,
      contentX: stageRect ? (centerX - stageRect.left) / scale : (container.scrollLeft + localX) / scale,
      contentY: stageRect ? (centerY - stageRect.top) / scale : (container.scrollTop + localY) / scale,
      originX: stageRect ? container.scrollLeft + stageRect.left - rect.left : 0,
      originY: stageRect ? container.scrollTop + stageRect.top - rect.top : 0,
    };
    suppressTreeNavigationUntilRef.current = Date.now() + 600;
    dragRef.current.kind = null;
    selectRef.current.active = false;
    setSelectionRect((rectState) => ({ ...rectState, active: false }));
    stopTreeMomentum();
  }

  function moveTreePinch(touches: React.TouchList) {
    const pinch = treePinchRef.current;
    const container = containerRef.current;
    if (!pinch || !container || touches.length !== 2) return;
    const localX = container.clientWidth / 2;
    const localY = container.clientHeight / 2;
    const nextScale = clampMobileTreeScale(
      pinch.startScale * (treeTouchDistance(touches) / Math.max(1, pinch.startDistance))
    );
    suppressTreeNavigationUntilRef.current = Date.now() + 600;

    mobileTreeScaleRef.current = nextScale;
    if (treePinchFrameRef.current) {
      window.cancelAnimationFrame(treePinchFrameRef.current);
    }
    treePinchFrameRef.current = window.requestAnimationFrame(() => {
      treePinchFrameRef.current = null;
      if (treeStageRef.current) {
        treeStageRef.current.style.transform = `scale(${nextScale})`;
      }
      if (treeStageShellRef.current) {
        treeStageShellRef.current.style.width = `${canvasSize.w * nextScale + mobileTreePanSlack}px`;
        treeStageShellRef.current.style.height = `${canvasSize.h * nextScale + mobileTreePanSlack}px`;
      }
      container.scrollLeft = Math.max(0, pinch.originX + pinch.contentX * nextScale - localX);
      container.scrollTop = Math.max(0, pinch.originY + pinch.contentY * nextScale - localY);
    });
  }

  function finishTreePinch() {
    if (!treePinchRef.current) return;
    treePinchRef.current = null;
    setMobileTreeScale(mobileTreeScaleRef.current);
    window.requestAnimationFrame(updateTreeScrollState);
    suppressTreeNavigationUntilRef.current = Date.now() + 600;
  }

  function startTreeTouchPan(touch: React.Touch, target: EventTarget | null) {
    const container = containerRef.current;
    if (!container) return;
    if (isEditing && (target as HTMLElement | null)?.closest?.("[data-draggable='true']")) {
      treeTouchPanRef.current = null;
      stopTreeMomentum();
      return;
    }
    stopTreeMomentum();
    const now = performance.now();
    treeTouchPanRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: now,
      lastX: touch.clientX,
      lastY: touch.clientY,
      lastTime: now,
      velocityX: 0,
      velocityY: 0,
      moved: false,
      samples: [{ x: touch.clientX, y: touch.clientY, time: now }],
    };
  }

  function moveTreeTouchPan(touch: React.Touch) {
    const container = containerRef.current;
    const pan = treeTouchPanRef.current;
    if (!container || !pan) return;
    const now = performance.now();
    const elapsed = Math.max(8, Math.min(40, now - pan.lastTime));
    const deltaX = touch.clientX - pan.lastX;
    const deltaY = touch.clientY - pan.lastY;
    container.scrollLeft -= deltaX;
    container.scrollTop -= deltaY;
    const instantVelocityX = -deltaX / elapsed;
    const instantVelocityY = -deltaY / elapsed;
    pan.velocityX = pan.velocityX * 0.35 + instantVelocityX * 0.65;
    pan.velocityY = pan.velocityY * 0.35 + instantVelocityY * 0.65;
    pan.lastX = touch.clientX;
    pan.lastY = touch.clientY;
    pan.lastTime = now;
    pan.moved = pan.moved || Math.abs(deltaX) + Math.abs(deltaY) > 2;
    pan.samples.push({ x: touch.clientX, y: touch.clientY, time: now });
    pan.samples = pan.samples.filter((sample) => now - sample.time <= 180);
    suppressTreeNavigationUntilRef.current = Date.now() + 300;
  }

  function treeReleaseVelocity(pan: NonNullable<typeof treeTouchPanRef.current>) {
    const last = pan.samples[pan.samples.length - 1];
    const first = pan.samples.find((sample) => last.time - sample.time <= 140) || pan.samples[0];
    const elapsed = Math.max(16, last.time - first.time);
    const sampledX = -(last.x - first.x) / elapsed;
    const sampledY = -(last.y - first.y) / elapsed;
    const strokeElapsed = Math.max(16, last.time - pan.startTime);
    const strokeX = -(last.x - pan.startX) / strokeElapsed;
    const strokeY = -(last.y - pan.startY) / strokeElapsed;
    let x = sampledX * 0.65 + pan.velocityX * 0.2 + strokeX * 0.15;
    let y = sampledY * 0.65 + pan.velocityY * 0.2 + strokeY * 0.15;
    const speed = Math.hypot(x, y);
    const strokeDistance = Math.hypot(last.x - pan.startX, last.y - pan.startY);
    if (strokeDistance > 4 && speed < 0.035) {
      const directionX = -(last.x - pan.startX) / strokeDistance;
      const directionY = -(last.y - pan.startY) / strokeDistance;
      x = directionX * 0.035;
      y = directionY * 0.035;
    }
    return { x, y };
  }

  function stopTreeMomentum() {
    if (!treeMomentumFrameRef.current) return;
    window.cancelAnimationFrame(treeMomentumFrameRef.current);
    treeMomentumFrameRef.current = null;
  }

  function startTreeMomentum(velocityX: number, velocityY: number) {
    const container = containerRef.current;
    if (!container || Math.hypot(velocityX, velocityY) < 0.005) return;
    stopTreeMomentum();
    let vx = Math.max(-3, Math.min(3, velocityX));
    let vy = Math.max(-3, Math.min(3, velocityY));
    let lastTime = performance.now();

    const coast = (now: number) => {
      const activeContainer = containerRef.current;
      if (!activeContainer) {
        treeMomentumFrameRef.current = null;
        return;
      }
      const elapsed = Math.min(32, now - lastTime);
      lastTime = now;
      const previousLeft = activeContainer.scrollLeft;
      const previousTop = activeContainer.scrollTop;
      activeContainer.scrollLeft += vx * elapsed;
      activeContainer.scrollTop += vy * elapsed;
      if (activeContainer.scrollLeft === previousLeft) vx = 0;
      if (activeContainer.scrollTop === previousTop) vy = 0;
      const decay = Math.pow(0.955, elapsed / 16.67);
      vx *= decay;
      vy *= decay;
      if (Math.hypot(vx, vy) < 0.012) {
        treeMomentumFrameRef.current = null;
        updateTreeScrollState();
        return;
      }
      treeMomentumFrameRef.current = window.requestAnimationFrame(coast);
    };
    treeMomentumFrameRef.current = window.requestAnimationFrame(coast);
  }

  useEffect(() => {
    if (!isHydrated) return;
    if (autoFrameAppliedRef.current) return;
    const hasLayout = Object.keys(positions).length > 0 || items.length > 0;
    if (!hasLayout) return;
    autoFrameAppliedRef.current = true;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    Object.values(positions).forEach((p) => {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x + cardSize > maxX) maxX = p.x + cardSize;
      if (p.y + cardHeight > maxY) maxY = p.y + cardHeight;
    });

    items.forEach((it) => {
      if (it.kind === "heart") {
        const w = 18;
        const h = 18;
        if (it.x + w > maxX) maxX = it.x + w;
        if (it.y + h > maxY) maxY = it.y + h;
      } else {
        const isVertical = it.lineType === "v-black";
        const len = lineLengthForType(it.lineType);
        const w = isVertical ? lineThickness : len;
        const h = isVertical ? len : lineThickness;
        if (it.x + w > maxX) maxX = it.x + w;
        if (it.y + h > maxY) maxY = it.y + h;
      }
    });

    if (!Number.isFinite(minX)) minX = 0;
    if (!Number.isFinite(minY)) minY = 0;
    if (!Number.isFinite(maxX)) maxX = minX;
    if (!Number.isFinite(maxY)) maxY = minY;

    const neededW = Math.max(800, Math.ceil((maxX - minX) + buffer * 2));
    const neededH = Math.max(800, Math.ceil((maxY - minY) + buffer * 2));
    setCanvasSize({ w: neededW, h: neededH });

    const dx = buffer - minX;
    const dy = buffer - minY;
    if (dx === 0 && dy === 0) return;

    setPositions((prev) => {
      const next: Record<string, { x: number; y: number }> = {};
      for (const [id, p] of Object.entries(prev)) {
        next[id] = { x: p.x + dx, y: p.y + dy };
      }
      return next;
    });
    setItems((prev) =>
      prev.map((it) => ({
        ...it,
        x: it.x + dx,
        y: it.y + dy,
      }))
    );
  }, [isHydrated, positions, items]);

  useEffect(() => {
    if (!isHydrated) return;
    if (typeof window === "undefined" || window.innerWidth > 950) return;
    if (isEditing) return;
    const container = containerRef.current;
    if (!container) return;
    const bounds = getLayoutBounds(positions, items);
    if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY)) return;
    const layoutKey = [
      Math.round(bounds.minX),
      Math.round(bounds.minY),
      Math.round(bounds.maxX),
      Math.round(bounds.maxY),
      positions ? Object.keys(positions).length : 0,
      items.length,
    ].join(":");
    if (mobileCenteredLayoutKeyRef.current === layoutKey) return;
    const centerX = bounds.minX + (bounds.maxX - bounds.minX) / 2;
    const centerY = bounds.minY + (bounds.maxY - bounds.minY) / 2;
    window.requestAnimationFrame(() => {
      container.scrollLeft = Math.max(0, centerX * mobileTreeScale - container.clientWidth / 2);
      container.scrollTop = Math.max(0, centerY * mobileTreeScale - container.clientHeight / 2);
      mobileCenteredLayoutKeyRef.current = layoutKey;
    });
  }, [isHydrated, isEditing, positions, items, mobileTreeScale]);

  useEffect(() => {
    updateTreeScrollState();
    window.addEventListener("resize", updateTreeScrollState);
    return () => window.removeEventListener("resize", updateTreeScrollState);
  }, [canvasSize.w, canvasSize.h, mobileTreeScale]);

  const hasHorizontalTreeScroll = treeScrollState.scrollWidth > treeScrollState.clientWidth + 2;
  const hasVerticalTreeScroll = treeScrollState.scrollHeight > treeScrollState.clientHeight + 2;
  const horizontalThumbWidth = Math.max(
    34,
    (treeScrollState.clientWidth / treeScrollState.scrollWidth) * treeScrollState.clientWidth
  );
  const verticalThumbHeight = Math.max(
    34,
    (treeScrollState.clientHeight / treeScrollState.scrollHeight) * treeScrollState.clientHeight
  );
  const horizontalThumbLeft = hasHorizontalTreeScroll
    ? (treeScrollState.scrollLeft / (treeScrollState.scrollWidth - treeScrollState.clientWidth)) *
      (treeScrollState.clientWidth - horizontalThumbWidth)
    : 0;
  const verticalThumbTop = hasVerticalTreeScroll
    ? (treeScrollState.scrollTop / (treeScrollState.scrollHeight - treeScrollState.clientHeight)) *
      (treeScrollState.clientHeight - verticalThumbHeight)
    : 0;
  const mobileTreePanSlack = Math.max(
    180,
    Math.round(Math.min(treeScrollState.clientWidth, treeScrollState.clientHeight) * 0.35)
  );

  function startTreeScrollbarDrag(axis: "x" | "y", e: React.PointerEvent<HTMLDivElement>) {
    const container = containerRef.current;
    if (!container) return;
    e.preventDefault();
    e.stopPropagation();

    const trackRect = e.currentTarget.getBoundingClientRect();
    const trackLength = axis === "x" ? trackRect.width : trackRect.height;
    const thumbLength = axis === "x" ? horizontalThumbWidth : verticalThumbHeight;
    const scrollRange =
      axis === "x"
        ? container.scrollWidth - container.clientWidth
        : container.scrollHeight - container.clientHeight;
    if (scrollRange <= 0 || trackLength <= thumbLength) return;

    const client = axis === "x" ? e.clientX : e.clientY;
    const trackStart = axis === "x" ? trackRect.left : trackRect.top;
    const thumbStart = axis === "x" ? horizontalThumbLeft : verticalThumbTop;
    const thumbEnd = thumbStart + thumbLength;
    const local = client - trackStart;

    if (local < thumbStart || local > thumbEnd) {
      const nextThumbStart = Math.max(0, Math.min(local - thumbLength / 2, trackLength - thumbLength));
      const nextScroll = (nextThumbStart / (trackLength - thumbLength)) * scrollRange;
      if (axis === "x") {
        container.scrollLeft = nextScroll;
      } else {
        container.scrollTop = nextScroll;
      }
      updateTreeScrollState();
    }

    scrollbarDragRef.current = {
      axis,
      startClient: client,
      startScroll: axis === "x" ? container.scrollLeft : container.scrollTop,
      trackLength,
      thumbLength,
      scrollRange,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function moveTreeScrollbarDrag(e: React.PointerEvent<HTMLDivElement>) {
    const drag = scrollbarDragRef.current;
    const container = containerRef.current;
    if (!drag || !container) return;
    e.preventDefault();
    e.stopPropagation();

    const client = drag.axis === "x" ? e.clientX : e.clientY;
    const delta = client - drag.startClient;
    const thumbTravel = Math.max(1, drag.trackLength - drag.thumbLength);
    const nextScroll = Math.max(
      0,
      Math.min(drag.scrollRange, drag.startScroll + (delta / thumbTravel) * drag.scrollRange)
    );

    if (drag.axis === "x") {
      container.scrollLeft = nextScroll;
    } else {
      container.scrollTop = nextScroll;
    }
    updateTreeScrollState();
  }

  function endTreeScrollbarDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (!scrollbarDragRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    scrollbarDragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <div className="manual-tree-title-row">
        <h1 className="mobile-route-title" style={{ marginTop: 0 }}>Tree</h1>
        {isEditing ? (
          <span
            className="manual-tree-save-status"
            title={saveStatus === "error" ? saveError : undefined}
            data-status={saveStatus}
          >
            {saveStatus === "saved"
              ? "Saved"
              : saveStatus === "saving"
              ? "Saving..."
              : saveStatus === "error"
              ? "Save failed"
              : "Saved"}
          </span>
        ) : null}
      </div>
      {err ? (
        <pre style={{ background: "#fee2e2", padding: 12, borderRadius: 10, color: "#991b1b" }}>
          {err}
        </pre>
      ) : null}

      {isEditing ? (
        <div className="manual-tree-edit-toolbar">
          <button onClick={() => addLine("v-black")}>Child/Parent Line</button>
          <button onClick={() => addLine("h-black")}>Sibling Line</button>
          <button onClick={() => addLine("h-blue")}>Marriage Line</button>
          <button
            type="button"
            className="manual-tree-undo-button"
            onClick={undoLayoutChange}
            aria-label="Undo last tree edit"
            title="Undo"
          >
            <span className="manual-tree-undo-icon" aria-hidden="true">
              <svg viewBox="0 0 32 32" focusable="false">
                <path d="M12.1 11.2H5.7V4.8" />
                <path d="M6.5 11.1a10.2 10.2 0 1 1-1.3 8.1" />
              </svg>
            </span>
            <span>Undo</span>
          </button>
        </div>
      ) : null}

      <div className="manual-tree-frame">
        {isEditing ? (
          <div
            ref={trashRef}
            className={trashActive ? "manual-tree-trash-target manual-tree-trash-target--active" : "manual-tree-trash-target"}
            aria-label="Drag selected lines here to delete"
          >
            <svg className="manual-tree-trash-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8.4 5.5c.2-1.2 1.2-2 2.4-2h2.4c1.2 0 2.2.8 2.4 2l.2 1H20v2.2H4V6.5h4.2l.2-1Z" />
              <path d="M6.2 9.7h11.6l-.8 10.1c-.1 1.1-1 1.9-2.1 1.9H9.1c-1.1 0-2-.8-2.1-1.9L6.2 9.7Z" />
              <path className="manual-tree-trash-cutout" d="M10 12.2v6.2M14 12.2v6.2" />
            </svg>
          </div>
        ) : null}
        {hasHorizontalTreeScroll ? (
          <div
            className="manual-tree-scrollbar manual-tree-scrollbar--horizontal"
            aria-label="Horizontal tree scroll"
            onPointerDown={(e) => startTreeScrollbarDrag("x", e)}
            onPointerMove={moveTreeScrollbarDrag}
            onPointerUp={endTreeScrollbarDrag}
            onPointerCancel={endTreeScrollbarDrag}
          >
            <div
              className="manual-tree-scrollbar__thumb"
              style={{
                width: horizontalThumbWidth,
                transform: `translateX(${horizontalThumbLeft}px)`,
              }}
            />
          </div>
        ) : null}
        <div
          ref={containerRef}
          className={isEditing ? "manual-tree-canvas manual-tree-canvas--editing" : "manual-tree-canvas manual-tree-canvas--viewing"}
          style={{
            position: "relative",
            width: canvasSize.w,
            height: canvasSize.h,
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            overflow: "auto",
            padding: 12,
            background: "#f8fbff",
          }}
          onScroll={() => {
            if (!treePinchRef.current) updateTreeScrollState();
          }}
          onContextMenu={(e) => {
            e.preventDefault();
          }}
          onClick={() => {
            setActiveLineId(null);
            setSelectedPeople(new Set());
            setSelectedItems(new Set());
          }}
          onPointerDown={(e) => {
            if (!isEditing) return;
            if (e.pointerType === "touch") return;
            const target = e.target as HTMLElement;
            if (target.closest("[data-draggable='true']") && !e.shiftKey && e.button !== 2) return;
            if (e.button === 2) return;
            const { x, y } = clientToCanvasPoint(e.clientX, e.clientY);
            selectRef.current = { startX: x, startY: y, active: true };
            setSelectionRect({ x, y, w: 0, h: 0, active: true });
          }}
          onTouchStart={(e) => {
            if (e.touches.length === 2) {
              e.preventDefault();
              e.stopPropagation();
              treeTouchPanRef.current = null;
              startTreePinch(e.touches);
            } else if (e.touches.length === 1) {
              e.preventDefault();
              startTreeTouchPan(e.touches[0], e.target);
            }
          }}
          onTouchMove={(e) => {
            if (treePinchRef.current && e.touches.length === 2) {
              e.preventDefault();
              e.stopPropagation();
              moveTreePinch(e.touches);
            } else if (treeTouchPanRef.current && e.touches.length === 1) {
              e.preventDefault();
              moveTreeTouchPan(e.touches[0]);
            }
          }}
          onTouchEnd={(e) => {
            if (treePinchRef.current && e.touches.length < 2) {
              finishTreePinch();
            }
            if (e.touches.length === 1) {
              startTreeTouchPan(e.touches[0], e.target);
            } else if (e.touches.length === 0) {
              const finishedPan = treeTouchPanRef.current;
              treeTouchPanRef.current = null;
              if (finishedPan?.moved) {
                const releaseVelocity = treeReleaseVelocity(finishedPan);
                startTreeMomentum(releaseVelocity.x, releaseVelocity.y);
              }
            }
          }}
          onTouchCancel={() => {
            finishTreePinch();
            treeTouchPanRef.current = null;
            stopTreeMomentum();
          }}
        >
        <div
          ref={treeStageShellRef}
          className="manual-tree-stage-shell"
          style={{
            position: "relative",
            width: canvasSize.w * mobileTreeScale + mobileTreePanSlack,
            height: canvasSize.h * mobileTreeScale + mobileTreePanSlack,
          }}
        >
        <div
          ref={treeStageRef}
          className={isEditing ? "manual-tree-stage manual-tree-stage--editing" : "manual-tree-stage manual-tree-stage--viewing"}
          style={{
            position: "relative",
            width: canvasSize.w,
            height: canvasSize.h,
            transform: `scale(${mobileTreeScale})`,
          }}
        >
        {selectionRect.active ? (
          <div
            style={{
              position: "absolute",
              left: selectionRect.x,
              top: selectionRect.y,
              width: selectionRect.w,
              height: selectionRect.h,
              border: "2px dashed #3b82f6",
              background: "rgba(59,130,246,0.08)",
              zIndex: 5,
            }}
          />
        ) : null}
        {/* Lines and hearts */}
        {items.map((it) => {
          if (it.kind === "heart") {
            return (
              <div
                key={it.id}
                onPointerDown={(e) => startDragHeart(it.id, e)}
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "absolute",
                  left: it.x,
                  top: it.y,
                  fontSize: 18,
                  color: "#2563eb",
                  cursor: isEditing ? "move" : "default",
                  userSelect: "none",
                  WebkitUserSelect: "none",
                  WebkitTouchCallout: "none",
                  touchAction: "none",
                  outline: selectedItems.has(it.id) ? "2px solid #3b82f6" : "none",
                  borderRadius: 4,
                }}
                data-draggable="true"
              >
                ❤
              </div>
            );
          }

          const isVertical = it.lineType === "v-black";
          const fixedLen = lineLengthForType(it.lineType);
          const isBlue = it.lineType === "h-blue";
          const thickness = lineThickness;
          const color = isBlue ? "#2563eb" : "#111827";
          const isActive = activeLineId === it.id;
          const isSelected = selectedItems.has(it.id) || isActive;
          const hitPad = isEditing ? (isSelected ? 40 : 24) : 0;
          const len = fixedLen;
          return (
            <div
              key={it.id}
              style={{
                position: "absolute",
                left: it.x - hitPad,
                top: it.y - hitPad,
                width: (isVertical ? thickness : len) + hitPad * 2,
                height: (isVertical ? len : thickness) + hitPad * 2,
                background: "transparent",
                cursor: isEditing ? "move" : "default",
                userSelect: "none",
                WebkitUserSelect: "none",
                WebkitTouchCallout: "none",
                touchAction: "none",
                zIndex: isSelected ? 4 : 2,
              }}
              onPointerDown={(e) => startDragLine(it.id, e, "move")}
              onClick={(e) => {
                e.stopPropagation();
                if (isEditing) setActiveLineId(it.id);
              }}
              data-draggable="true"
            >
              <div
                style={{
                  position: "absolute",
                  left: hitPad,
                  top: hitPad,
                  width: isVertical ? thickness : len,
                  height: isVertical ? len : thickness,
                  minWidth: isVertical ? thickness : undefined,
                  minHeight: isVertical ? undefined : thickness,
                  borderRadius: 0,
                  background: color,
                  boxShadow: isSelected ? "0 0 0 5px rgba(59, 130, 246, 0.24)" : "none",
                  outline: isSelected ? "2px solid #3b82f6" : "none",
                }}
              />
            </div>
          );
        })}

        {/* People cards */}
        {people.map((p) => {
          const pos = positions[p.id] || { x: 0, y: 0 };
          const photos = photosByPerson[p.id] || [];
          const profile =
            (p.profilePhotoId ? photos.find((ph) => ph.id === p.profilePhotoId) : null) || photos[0];
          const profileSrc = profile
            ? profile.storageUrl
              ? profile.storageUrl
              : profile.localPath
              ? profile.localPath
              : proxyImgUrl(profile.baseUrl, profile.id, 300, 300)
            : "";

          return (
            <div
              key={p.id}
              onPointerDown={(e) => startDragPerson(p.id, e)}
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "absolute",
                left: pos.x,
                top: pos.y,
                width: cardSize,
                height: cardHeight,
                border: "2px solid #cfe4ff",
                borderRadius: 12,
                padding: 10,
                background: "#f3f8ff",
                cursor: isEditing ? "move" : "pointer",
                boxSizing: "border-box",
                boxShadow: "inset 0 0 0 1px rgba(207, 228, 255, 0.42)",
                outline: selectedPeople.has(p.id) ? "2px solid #3b82f6" : "none",
                userSelect: "none",
                WebkitUserSelect: "none",
                WebkitTouchCallout: "none",
                touchAction: isEditing ? "none" : "auto",
                zIndex: 20,
              }}
              data-draggable="true"
              onPointerUp={() => {
                if (!isEditing && Date.now() >= suppressTreeNavigationUntilRef.current) {
                  window.location.href = `/family-tree/${p.id}`;
                }
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: cardSize - 40,
                  background: "#fff",
                  border: "2px solid #dbeafe",
                  borderRadius: 10,
                  overflow: "hidden",
                  marginBottom: 6,
                  userSelect: "none",
                  WebkitUserSelect: "none",
                  WebkitTouchCallout: "none",
                }}
                onDragStart={(e) => e.preventDefault()}
              >
                    {profileSrc ? (
                      <img
                        src={profileSrc}
                        alt={displayName(p)}
                        draggable={false}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "contain",
                          display: "block",
                          userSelect: "none",
                          WebkitUserSelect: "none",
                          WebkitTouchCallout: "none",
                          pointerEvents: "none",
                          transformOrigin: "center",
                          transform: `translate(${p.profileX ?? 0}%, ${p.profileY ?? 0}%) scale(${p.profileZoom ?? 1}) rotate(${profile?.rotation ?? 0}deg)`,
                        }}
                      />
                ) : (
                  <div style={{ padding: 12, color: "#999", fontSize: 13 }}>No tagged photo</div>
                )}
              </div>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 16,
                  lineHeight: 1.12,
                  textAlign: "right",
                  color: "#3b82f6",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {displayName(p)}
              </div>
            </div>
          );
        })}
        </div>
        </div>
        </div>
      </div>
    </main>
  );
}
