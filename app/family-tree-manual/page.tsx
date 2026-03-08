// app/family-tree-manual/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useEditingMode } from "../providers";
import { useRouter } from "next/navigation";

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
    mode?: "move" | "resize-start" | "resize-end";
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
  const selectRef = useRef<{ startX: number; startY: number; active: boolean }>({
    startX: 0,
    startY: 0,
    active: false,
  });

  useEffect(() => {
    let didSet = false;
    fetch("/api/manual-layout", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok && typeof j?.data === "string" && j.data) {
          const parsed = JSON.parse(j.data);
          if (parsed?.positions) setPositions(parsed.positions);
          if (Array.isArray(parsed?.items)) setItems(parsed.items);
          didSet = true;
        }
      })
      .catch(() => {
        // ignore
      })
      .finally(() => {
        if (didSet) return;
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
          } catch {
            // ignore
          }
        }
      });
  }, []);

  async function saveNow(payload?: { positions: Record<string, { x: number; y: number }>; items: Item[] }) {
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
      window.setTimeout(() => setSaveStatus("idle"), 1500);
    } catch {
      setSaveStatus("error");
      setSaveError("Save failed. Check console/network.");
    }
  }

  useEffect(() => {
    const payload = { positions, items };
    latestPayloadRef.current = payload;
    window.localStorage.setItem("photoTreeManualState", JSON.stringify(payload));
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    setSaveStatus("saving");
    saveTimerRef.current = window.setTimeout(() => {
      saveNow(payload);
    }, 400);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [positions, items]);

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
      const colW = 280;
      const rowH = 320;
      list.forEach((p: Person, idx) => {
        const col = idx % 3;
        const row = Math.floor(idx / 3);
        next[p.id] = { x: col * colW, y: row * rowH };
      });
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
    loadPeople();
  }, []);

  useEffect(() => {
    if (people.length === 0) return;
    people.forEach((p) => {
      if (!photosByPerson[p.id]) loadPhotos(p.id);
    });
    setPositions((prev) => {
      const next = { ...prev };
      const colW = 280;
      const rowH = 320;
      let idx = 0;
      people.forEach((p) => {
        if (next[p.id]) return;
        const col = idx % 3;
        const row = Math.floor(idx / 3);
        next[p.id] = { x: col * colW, y: row * rowH };
        idx += 1;
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
      const id = dragRef.current.id;

      if (dragRef.current.kind === "person") {
        if (dragRef.current.groupPeople) {
          setPositions((m) => {
            const next = { ...m };
            Object.entries(dragRef.current.groupPeople || {}).forEach(([pid, pos]) => {
              next[pid] = { x: pos.x + dx, y: pos.y + dy };
            });
            return next;
          });
        } else {
          setPositions((m) => ({
            ...m,
            [id]: { x: dragRef.current.originX + dx, y: dragRef.current.originY + dy },
          }));
        }
        if (dragRef.current.groupItems) {
          setItems((prev) =>
            prev.map((it) => {
              const base = dragRef.current.groupItems?.[it.id];
              if (!base) return it;
              if (it.kind === "line") return { ...it, x: base.x + dx, y: base.y + dy };
              if (it.kind === "heart") return { ...it, x: base.x + dx, y: base.y + dy };
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
              if (it.kind === "heart") return { ...it, x: base.x + dx, y: base.y + dy };
              if (it.kind === "line") return { ...it, x: base.x + dx, y: base.y + dy };
              return it;
            })
          );
        } else {
          setItems((prev) =>
            prev.map((it) =>
              it.id === id && it.kind === "heart"
                ? { ...it, x: dragRef.current.originX + dx, y: dragRef.current.originY + dy }
                : it
            )
          );
        }
        if (dragRef.current.groupPeople) {
          setPositions((m) => {
            const next = { ...m };
            Object.entries(dragRef.current.groupPeople || {}).forEach(([pid, pos]) => {
              next[pid] = { x: pos.x + dx, y: pos.y + dy };
            });
            return next;
          });
        }
        return;
      }

      if (dragRef.current.kind === "line") {
        const snapThreshold = 10;
        const endpoints = (it: Item) => {
          if (it.kind !== "line") return [];
          const isVertical = it.lineType === "v-black";
          if (isVertical) {
            return [
              { x: it.x, y: it.y },
              { x: it.x, y: it.y + it.length },
            ];
          }
          return [
            { x: it.x, y: it.y },
            { x: it.x + it.length, y: it.y },
          ];
        };
        const allEndpoints = items.flatMap((it) => (it.id === id ? [] : endpoints(it)));

        setItems((prev) => {
          if (dragRef.current.groupItems && dragRef.current.mode === "move") {
            return prev.map((it) => {
              const base = dragRef.current.groupItems?.[it.id];
              if (!base) return it;
              if (it.kind === "line") return { ...it, x: base.x + dx, y: base.y + dy };
              if (it.kind === "heart") return { ...it, x: base.x + dx, y: base.y + dy };
              return it;
            });
          }
          return prev.map((it) => {
            if (it.id !== id || it.kind !== "line") return it;
            const isVertical = it.lineType === "v-black";
            const mode = dragRef.current.mode || "move";
            if (mode === "move") {
              let nx = dragRef.current.originX + dx;
              let ny = dragRef.current.originY + dy;
              // snap moved line by matching endpoints
              const moved = { ...it, x: nx, y: ny };
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
              return { ...it, x: nx, y: ny };
            }
            if (mode === "resize-start") {
              if (isVertical) {
                const newY = dragRef.current.originY + dy;
                const newLen = (dragRef.current.originLength || it.length) - dy;
                let ny = newY;
                let nlen = Math.max(30, newLen);
                const start = { x: it.x, y: ny };
                const hit = allEndpoints.find(
                  (p) => Math.abs(p.x - start.x) <= snapThreshold && Math.abs(p.y - start.y) <= snapThreshold
                );
                if (hit) {
                  nlen = nlen + (ny - hit.y);
                  ny = hit.y;
                }
                return { ...it, y: ny, length: Math.max(30, nlen) };
              }
              const newX = dragRef.current.originX + dx;
              const newLen = (dragRef.current.originLength || it.length) - dx;
              let nx = newX;
              let nlen = Math.max(30, newLen);
              const start = { x: nx, y: it.y };
              const hit = allEndpoints.find(
                (p) => Math.abs(p.x - start.x) <= snapThreshold && Math.abs(p.y - start.y) <= snapThreshold
              );
              if (hit) {
                nlen = nlen + (nx - hit.x);
                nx = hit.x;
              }
              return { ...it, x: nx, length: Math.max(30, nlen) };
            }
            if (mode === "resize-end") {
              if (isVertical) {
                const newLen = (dragRef.current.originLength || it.length) + dy;
                let nlen = Math.max(30, newLen);
                const end = { x: it.x, y: it.y + nlen };
                const hit = allEndpoints.find(
                  (p) => Math.abs(p.x - end.x) <= snapThreshold && Math.abs(p.y - end.y) <= snapThreshold
                );
                if (hit) {
                  nlen = Math.max(30, hit.y - it.y);
                }
                return { ...it, length: nlen };
              }
              const newLen = (dragRef.current.originLength || it.length) + dx;
              let nlen = Math.max(30, newLen);
              const end = { x: it.x + nlen, y: it.y };
              const hit = allEndpoints.find(
                (p) => Math.abs(p.x - end.x) <= snapThreshold && Math.abs(p.y - end.y) <= snapThreshold
              );
              if (hit) {
                nlen = Math.max(30, hit.x - it.x);
              }
              return { ...it, length: nlen };
            }
            return it;
          });
        });
        if (dragRef.current.groupPeople && dragRef.current.mode === "move") {
          setPositions((m) => {
            const next = { ...m };
            Object.entries(dragRef.current.groupPeople || {}).forEach(([pid, pos]) => {
              next[pid] = { x: pos.x + dx, y: pos.y + dy };
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
            const bh = cardSize + 70;
            if (inRect(pos.x, pos.y, bw, bh)) nextPeople.add(p.id);
          });
          items.forEach((it) => {
            if (it.kind === "heart") {
              if (inRect(it.x, it.y, 18, 18)) nextItems.add(it.id);
            } else {
              const isVertical = it.lineType === "v-black";
              const bw = isVertical ? 6 : it.length;
              const bh = isVertical ? it.length : 6;
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

  function startDragLine(id: string, e: React.MouseEvent, mode: "move" | "resize-start" | "resize-end") {
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
    const baseLen = 160;
    const defaultLen = Math.round(baseLen * 1.5);
    const length = lineType === "h-black" ? defaultLen * 2 : defaultLen;
    setItems((prev) => [
      ...prev,
      { id, kind: "line", lineType, x: 100, y: 100, length },
    ]);
    setActiveLineId(id);
  }

  function addHeart() {
    const id = `heart_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setItems((prev) => [...prev, { id, kind: "heart", x: 140, y: 140 }]);
  }

  function resetLayoutGrid() {
    const next: Record<string, { x: number; y: number }> = {};
    const colW = 280;
    const rowH = 320;
    people.forEach((p, idx) => {
      const col = idx % 3;
      const row = Math.floor(idx / 3);
      next[p.id] = { x: col * colW, y: row * rowH };
    });
    setPositions(next);
  }

  const cardSize = 220;
  const [activeLineId, setActiveLineId] = useState<string | null>(null);

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
          <button onClick={addHeart} style={{ fontSize: 12 }}>Add blue heart</button>
          <button onClick={() => saveNow()} style={{ fontSize: 12 }}>Save now</button>
          <button
            onClick={() => {
              const stored = window.localStorage.getItem("photoTreeManualState");
              if (!stored) return;
              try {
                const parsed = JSON.parse(stored);
                const payload = {
                  positions: parsed?.positions || {},
                  items: Array.isArray(parsed?.items) ? parsed.items : [],
                };
                setPositions(payload.positions);
                setItems(payload.items);
                void saveNow(payload);
              } catch {
                // ignore
              }
            }}
            style={{ fontSize: 12 }}
          >
            Restore from browser cache
          </button>
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
          minHeight: "160vh",
          minWidth: "160vw",
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
          const isBlue = it.lineType === "h-blue";
          const thickness = 4;
          const color = isBlue ? "#2563eb" : "#111827";
          const isActive = activeLineId === it.id;
          return (
            <div
              key={it.id}
              style={{
                position: "absolute",
                left: it.x,
                top: it.y,
                width: isVertical ? thickness : it.length,
                height: isVertical ? it.length : thickness,
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
              {/* Resize handles (only when active) */}
              {isActive && isEditing ? (
                <>
                  <div
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      startDragLine(it.id, e, "resize-start");
                    }}
                    style={{
                      position: "absolute",
                      left: isVertical ? -4 : -6,
                      top: isVertical ? -6 : -4,
                      width: 10,
                      height: 10,
                      background: "#fff",
                      border: `2px solid ${color}`,
                      borderRadius: 2,
                      cursor: "nwse-resize",
                    }}
                  />
                  <div
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      startDragLine(it.id, e, "resize-end");
                    }}
                    style={{
                      position: "absolute",
                      right: isVertical ? -4 : -6,
                      bottom: isVertical ? -6 : -4,
                      width: 10,
                      height: 10,
                      background: "#fff",
                      border: `2px solid ${color}`,
                      borderRadius: 2,
                      cursor: "nwse-resize",
                    }}
                  />
                </>
              ) : null}
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
            ? profile.localPath
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
                height: cardSize + 70,
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
                  aspectRatio: "1 / 1",
                  background: "#fafafa",
                  border: "2px solid #dbeafe",
                  borderRadius: 10,
                  overflow: "hidden",
                  marginBottom: 8,
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
                      objectFit: "cover",
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
              <div style={{ fontWeight: 700, fontSize: 15, textAlign: "right", color: "#3b82f6" }}>
                {displayName(p)}
              </div>
              <div style={{ fontSize: 13, color: "#555", textAlign: "right", fontWeight: 700 }}>
                Born {p.birthYear ?? "—"}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
