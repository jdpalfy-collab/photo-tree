// app/family-tree-manual/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useEditingMode } from "../providers";
import { useRouter } from "next/navigation";
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

function proxyImgUrl(baseUrl: string, photoId: string, w = 400, h = 400) {
  return `/api/photos/image?src=${encodeURIComponent(baseUrl)}&photoId=${encodeURIComponent(
    photoId
  )}&w=${w}&h=${h}&cb=${Date.now()}`;
}

function displayName(p: Person) {
  const full = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
  return full || p.name;
}

export default function FamilyTreeManualPage() {
  const { status } = useSession();
  const { mode } = useEditingMode();
  const isEditing = mode === "editing";
  const router = useRouter();
  const [people, setPeople] = useState<Person[]>([]);
  const [photosByPerson, setPhotosByPerson] = useState<Record<string, Photo[]>>({});
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [items, setItems] = useState<Item[]>([]);
  const [err, setErr] = useState<string>("");
  const [selectedPeople, setSelectedPeople] = useState<Set<string>>(new Set());
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string>("");
  const [isDirty, setIsDirty] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [layoutApplied, setLayoutApplied] = useState(false);
  const cardSize = 220;
  const cardHeight = cardSize;
  const edgePad = 12;
  const lineThickness = 8;
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
  const trashRef = useRef<HTMLDivElement | null>(null);
  const lastMouseRef = useRef<{ x: number; y: number } | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const latestPayloadRef = useRef<{ positions: Record<string, { x: number; y: number }>; items: Item[] } | null>(null);
  const latestPositionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const latestItemsRef = useRef<Item[]>([]);
  const snapTimerRef = useRef<number | null>(null);
  const selectRef = useRef<{ startX: number; startY: number; active: boolean }>({
    startX: 0,
    startY: 0,
    active: false,
  });
  const autoFrameAppliedRef = useRef(false);

  useEffect(() => {
    if (status !== "authenticated") return;
    let didSet = false;
    fetch("/api/manual-layout", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok && typeof j?.data === "string" && j.data) {
          const parsed = JSON.parse(j.data);
          if (parsed?.positions) setPositions(parsed.positions);
          if (Array.isArray(parsed?.items)) setItems(parsed.items);
          didSet = true;
          setLayoutApplied(true);
        }
      })
      .catch(() => {
        // ignore
      })
      .finally(() => {
        if (didSet) {
          window.setTimeout(() => setIsHydrated(true), 0);
          return;
        }
        const stored = window.localStorage.getItem("photoTreeManualState");
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            if (parsed?.positions) setPositions(parsed.positions);
            if (Array.isArray(parsed?.items)) setItems(parsed.items);
            // auto-restore to DB if remote was empty
            if (parsed?.positions || Array.isArray(parsed?.items)) {
              latestPayloadRef.current = {
                positions: parsed?.positions || {},
                items: Array.isArray(parsed?.items) ? parsed.items : [],
              };
              void saveNow(latestPayloadRef.current);
            }
            setLayoutApplied(true);
            window.setTimeout(() => setIsHydrated(true), 0);
            return;
          } catch {
            // ignore
          }
        }
        // no saved layout yet; wait for initial positions
        setLayoutApplied(false);
      });
  }, [status]);


  async function saveNow(payload?: { positions: Record<string, { x: number; y: number }>; items: Item[] }) {
    if (status !== "authenticated") {
      setIsDirty(true);
      return;
    }
    const data = payload || latestPayloadRef.current || { positions, items };
    latestPayloadRef.current = data;
    setSaveStatus("saving");
    setSaveError("");
    try {
      const res = await fetch("/api/manual-layout", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: JSON.stringify(data) }),
        keepalive: true,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "save failed");
      }
      setSaveStatus("saved");
      setIsDirty(false);
      window.setTimeout(() => setSaveStatus("idle"), 1500);
    } catch {
      setSaveStatus("error");
      setSaveError("Save failed. Check console/network.");
    }
  }

  useEffect(() => {
    if (!isHydrated) return;
    const payload = { positions, items };
    latestPositionsRef.current = positions;
    latestItemsRef.current = items;
    latestPayloadRef.current = payload;
    window.localStorage.setItem("photoTreeManualState", JSON.stringify(payload));
    setIsDirty(true);
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    setSaveStatus("saving");
    saveTimerRef.current = window.setTimeout(() => {
      saveNow(payload);
    }, 400);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [positions, items, isHydrated]);

  useEffect(() => {
    function onVisChange() {
      if (document.visibilityState === "hidden") {
        saveNow();
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
    if (status !== "authenticated") return;
    if (isDirty) {
      saveNow();
    }
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated") return;
    if (!isDirty) return;
    const id = window.setInterval(() => {
      saveNow();
    }, 5000);
    return () => window.clearInterval(id);
  }, [status, isDirty]);

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

    // initialize positions if missing
    setPositions((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      const next: Record<string, { x: number; y: number }> = {};
      list.forEach((p: Person, idx) => {
        next[p.id] = { x: 0, y: 0 };
      });
      if (!layoutApplied) {
        window.setTimeout(() => setIsHydrated(true), 0);
      }
      return next;
    });
  }

  async function loadPhotos(personId: string) {
    const r = await fetch(`/api/people/${personId}/photos`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return;
    setPhotosByPerson((m) => ({ ...m, [personId]: Array.isArray(j?.photos) ? j.photos : [] }));
  }

  useEffect(() => {
    if (status !== "authenticated") return;
    loadPeople();
  }, [status]);

  useEffect(() => {
    if (people.length === 0) return;
    people.forEach((p) => {
      if (!photosByPerson[p.id]) loadPhotos(p.id);
    });
    setPositions((prev) => {
      const next = { ...prev };
      people.forEach((p) => {
        if (next[p.id]) return;
        next[p.id] = { x: 0, y: 0 };
      });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people.length]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!isEditing) return;
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
      if (selectRef.current.active) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = e.clientX - rect.left + (containerRef.current?.scrollLeft || 0);
        const y = e.clientY - rect.top + (containerRef.current?.scrollTop || 0);
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
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const step = Math.max(2, Math.round(cardSize / 32));
      const qdx = Math.round(dx / step) * step;
      const qdy = Math.round(dy / step) * step;
      const id = dragRef.current.id;

      if (dragRef.current.kind === "person") {
        const boundsW = containerRef.current?.scrollWidth ?? 0;
        const boundsH = containerRef.current?.scrollHeight ?? 0;
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
          const boundsW = containerRef.current?.scrollWidth ?? 0;
          const boundsH = containerRef.current?.scrollHeight ?? 0;
          const growPad = 160;
          const growStep = 120;
          let maxX = -Infinity;
          let maxY = -Infinity;
          Object.values(dragRef.current.groupPeople || {}).forEach((pos) => {
            const nx = pos.x + clamped.dx;
            const ny = pos.y + clamped.dy;
            if (nx + cardSize > maxX) maxX = nx + cardSize;
            if (ny + cardHeight > maxY) maxY = ny + cardHeight;
          });
          if (boundsW > 0 && maxX > boundsW - growPad) {
            setCanvasSize((s) => ({ w: s.w + growStep, h: s.h }));
          }
          if (boundsH > 0 && maxY > boundsH - growPad) {
            setCanvasSize((s) => ({ w: s.w, h: s.h + growStep }));
          }
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
          // slow canvas expansion when dragging near edges
          const growPad = 160;
          const growStep = 120;
          if (boundsW > 0 && clampedX + cardSize > boundsW - growPad) {
            setCanvasSize((s) => ({ w: s.w + growStep, h: s.h }));
          }
          if (boundsH > 0 && clampedY + cardHeight > boundsH - growPad) {
            setCanvasSize((s) => ({ w: s.w, h: s.h + growStep }));
          }
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
        return;
      }

      if (dragRef.current.kind === "line") {
        const baseLine = items.find((it) => it.id === id && it.kind === "line");
        const snapThreshold = 10;
        const lineLen = (it: Item) => {
          if (it.kind !== "line") return 0;
          if (it.lineType === "h-black") return cardHeight * 2;
          return cardHeight;
        };
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
        if (baseLine && baseLine.kind === "line") {
          const boundsW = containerRef.current?.scrollWidth ?? 0;
          const boundsH = containerRef.current?.scrollHeight ?? 0;
          const growPad = 160;
          const growStep = 120;
          const len = lineLen(baseLine);
          const isVertical = baseLine.lineType === "v-black";
          const nx = dragRef.current.originX + qdx;
          const ny = dragRef.current.originY + qdy;
          const maxX = isVertical ? nx : nx + len;
          const maxY = isVertical ? ny + len : ny;
          if (boundsW > 0 && maxX > boundsW - growPad) {
            setCanvasSize((s) => ({ w: s.w + growStep, h: s.h }));
          }
          if (boundsH > 0 && maxY > boundsH - growPad) {
            setCanvasSize((s) => ({ w: s.w, h: s.h + growStep }));
          }
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

    function onUp() {
      if (!isEditing) return;
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
              const len = it.lineType === "h-black" ? cardHeight * 2 : cardHeight;
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
        const trash = trashRef.current?.getBoundingClientRect();
        const last = lastMouseRef.current;
        if (trash && last) {
          const inside =
            last.x >= trash.left &&
            last.x <= trash.right &&
            last.y >= trash.top &&
            last.y <= trash.bottom;
          if (inside) {
            const removeId = dragRef.current.id;
            setItems((prev) => prev.filter((it) => it.id !== removeId));
            setSelectedItems((s) => {
              const next = new Set(s);
              next.delete(removeId);
              return next;
            });
            setActiveLineId(null);
          }
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
    }

    function onKeyDown(e: KeyboardEvent) {
      if (!isEditing) return;
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (selectedItems.size === 0) return;
      setItems((prev) => prev.filter((it) => !selectedItems.has(it.id)));
      setSelectedItems(new Set());
      setActiveLineId(null);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [selectedItems, isEditing]);

  function startDragPerson(id: string, e: React.MouseEvent) {
    if (!isEditing) return;
    if (e.button === 2) return;
    e.stopPropagation();
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
  }

  function startDragLine(id: string, e: React.MouseEvent, mode: "move") {
    if (!isEditing) return;
    if (e.button === 2) return;
    e.stopPropagation();
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
  }

  function startDragHeart(id: string, e: React.MouseEvent) {
    if (!isEditing) return;
    if (e.button === 2) return;
    e.stopPropagation();
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
  }

  function addLine(lineType: LineType) {
    const id = `line_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const length = lineType === "h-black" ? cardHeight * 2 : cardHeight;
    setItems((prev) => [
      ...prev,
      { id, kind: "line", lineType, x: 0, y: 0, length },
    ]);
    setActiveLineId(id);
  }

  function addHeart() {
    const id = `heart_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setItems((prev) => [...prev, { id, kind: "heart", x: 0, y: 0 }]);
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
        const len = it.lineType === "h-black" ? cardHeight * 2 : cardHeight;
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
    setCanvasSize((s) => ({
      w: Math.max(s.w, neededW),
      h: Math.max(s.h, neededH),
    }));

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

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ marginTop: 0 }}>Tree</h1>
      {err ? (
        <pre style={{ background: "#fee2e2", padding: 12, borderRadius: 10, color: "#991b1b" }}>
          {err}
        </pre>
      ) : null}

      {isEditing ? (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
          <button onClick={() => addLine("v-black")} style={{ fontSize: 12 }}>Add vertical black line</button>
          <button onClick={() => addLine("h-black")} style={{ fontSize: 12 }}>Add horizontal black line</button>
          <button onClick={() => addLine("h-blue")} style={{ fontSize: 12 }}>Add horizontal blue line</button>
          <span
            style={{
              fontSize: 12,
              padding: "4px 8px",
              borderRadius: 999,
              background:
                saveStatus === "saved"
                  ? "#dcfce7"
                  : saveStatus === "saving"
                  ? "#dbeafe"
                  : saveStatus === "error"
                  ? "#fee2e2"
                  : "#e5e7eb",
              color:
                saveStatus === "saved"
                  ? "#166534"
                  : saveStatus === "saving"
                  ? "#1d4ed8"
                  : saveStatus === "error"
                  ? "#991b1b"
                  : "#374151",
            }}
            title={saveStatus === "error" ? saveError : undefined}
          >
            {saveStatus === "saved"
              ? "Saved"
              : saveStatus === "saving"
              ? "Saving…"
              : saveStatus === "error"
              ? "Save failed"
              : "Saved"}
          </span>
        </div>
      ) : null}

      <div
        ref={containerRef}
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
        onContextMenu={(e) => {
          e.preventDefault();
        }}
        onClick={() => {
          setActiveLineId(null);
          setSelectedPeople(new Set());
          setSelectedItems(new Set());
        }}
        onMouseDown={(e) => {
          if (!isEditing) return;
          const target = e.target as HTMLElement;
          if (target.closest("[data-draggable='true']") && !e.shiftKey && e.button !== 2) return;
          const rect = containerRef.current?.getBoundingClientRect();
          if (!rect) return;
          const x = e.clientX - rect.left + (containerRef.current?.scrollLeft || 0);
          const y = e.clientY - rect.top + (containerRef.current?.scrollTop || 0);
          selectRef.current = { startX: x, startY: y, active: true };
          setSelectionRect({ x, y, w: 0, h: 0, active: true });
        }}
      >
        {isEditing ? (
          <div
            ref={trashRef}
            style={{
              position: "absolute",
              left: 16,
              top: 16,
              width: 64,
              height: 64,
              borderRadius: 12,
              border: "2px dashed #94a3b8",
              background: "#f1f5f9",
              color: "#64748b",
              display: "grid",
              placeItems: "center",
              fontSize: 22,
              zIndex: 6,
              userSelect: "none",
            }}
          >
            🗑️
          </div>
        ) : null}
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
                onMouseDown={(e) => startDragHeart(it.id, e)}
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "absolute",
                  left: it.x,
                  top: it.y,
                  fontSize: 18,
                  color: "#2563eb",
                  cursor: isEditing ? "move" : "default",
                  userSelect: "none",
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
          const fixedLen = it.lineType === "h-black" ? cardHeight * 2 : cardHeight;
          const isBlue = it.lineType === "h-blue";
          const thickness = lineThickness;
          const color = isBlue ? "#2563eb" : "#111827";
          const isActive = activeLineId === it.id;
          const len = fixedLen;
          return (
            <div
              key={it.id}
              style={{
                position: "absolute",
                left: it.x,
                top: it.y,
                width: isVertical ? thickness : len,
                height: isVertical ? len : thickness,
                minWidth: isVertical ? thickness : undefined,
                minHeight: isVertical ? undefined : thickness,
                background: color,
                cursor: isEditing ? "move" : "default",
                outline: selectedItems.has(it.id) ? "2px solid #3b82f6" : "none",
              }}
              onMouseDown={(e) => startDragLine(it.id, e, "move")}
              onClick={(e) => {
                e.stopPropagation();
                if (isEditing) setActiveLineId(it.id);
              }}
              data-draggable="true"
            >
              {/* Resize handles removed */}
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
              onMouseDown={(e) => startDragPerson(p.id, e)}
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
                background: "#fff",
                cursor: isEditing ? "move" : "pointer",
                boxSizing: "border-box",
                outline: selectedPeople.has(p.id) ? "2px solid #3b82f6" : "none",
              }}
              data-draggable="true"
              onMouseUp={() => {
                if (!isEditing) router.push(`/family-tree/${p.id}`);
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: cardSize - 40,
                  background: "#ffffff",
                  border: "2px solid #dbeafe",
                  borderRadius: 10,
                  overflow: "hidden",
                  marginBottom: 6,
                  userSelect: "none",
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
                  fontSize: 13,
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
    </main>
  );
}
