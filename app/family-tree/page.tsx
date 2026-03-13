"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useEditingMode } from "../providers";

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

type Relationship = {
  id: string;
  fromId: string;
  toId: string;
  type: string;
};

function proxyImgUrl(baseUrl: string, photoId: string, w = 400, h = 400) {
  return `/api/photos/image?src=${encodeURIComponent(baseUrl)}&photoId=${encodeURIComponent(
    photoId
  )}&w=${w}&h=${h}&cb=${Date.now()}`;
}

export default function FamilyTreePage() {
  const { mode } = useEditingMode();
  const isEditing = mode === "editing";
  const [people, setPeople] = useState<Person[]>([]);
  const [photosByPerson, setPhotosByPerson] = useState<Record<string, Photo[]>>({});
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState<Record<string, boolean>>({});
  const [pickerOpen, setPickerOpen] = useState<Record<string, boolean>>({});
  const [savingProfile, setSavingProfile] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState<string>("");
  const [nodeHeight, setNodeHeight] = useState<number>(220);
  const measureRef = useRef<HTMLDivElement | null>(null);

  const [rootId, setRootId] = useState<string>("");
  const [relMsg, setRelMsg] = useState<string>("");
  const [connectMode, setConnectMode] = useState<"parent" | "child" | "spouse" | "sibling" | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  function displayName(p: Person) {
    const full = `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim();
    return full || p.name;
  }

  async function loadPeople() {
    setErr("");
    const r = await fetch("/api/people", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setErr(JSON.stringify(j, null, 2));
      return;
    }
    const list = Array.isArray(j?.people) ? j.people : [];
    setPeople(list);
    if (!rootId && list.length > 0) setRootId(list[0].id);
  }

  async function loadRelationships() {
    const r = await fetch("/api/relationships", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return;
    setRelationships(Array.isArray(j?.relationships) ? j.relationships : []);
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

  async function setProfilePhoto(personId: string, photoId: string | null) {
    setSavingProfile((m) => ({ ...m, [personId]: true }));
    try {
      const r = await fetch(`/api/people/${personId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profilePhotoId: photoId,
          profileZoom: 1,
          profileX: 0,
          profileY: 0,
        }),
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
    } finally {
      setSavingProfile((m) => ({ ...m, [personId]: false }));
    }
  }

  async function addRelationship(fromId: string, toId: string, relType: "parent" | "child" | "spouse" | "sibling") {
    setRelMsg("");
    if (!fromId || !toId || fromId === toId) {
      setRelMsg("Choose two different people.");
      return;
    }
    let sendFrom = fromId;
    let sendTo = toId;
    let sendType = relType;
    if (relType === "child") {
      // If A is child of B, store parent relation B -> A
      sendFrom = toId;
      sendTo = fromId;
      sendType = "parent";
    }
    const r = await fetch("/api/relationships", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromId: sendFrom, toId: sendTo, type: sendType }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setRelMsg(j?.error ? String(j.error) : "Failed to add relationship");
      return;
    }
    const created = Array.isArray(j?.relationships) ? j.relationships : [];
    if (created.length > 0) {
      setRelationships((prev) => {
        const next = [...prev];
        const seen = new Set(prev.map((r) => r.id));
        created.forEach((r: Relationship) => {
          if (!seen.has(r.id)) next.push(r);
        });
        return next;
      });
    }
    setRelMsg("Relationship saved.");
    await loadRelationships();
    setSelectedIds([]);
    setConnectMode(null);
  }

  useEffect(() => {
    loadPeople();
    loadRelationships();
  }, []);

  useLayoutEffect(() => {
    if (!measureRef.current) return;
    const el = measureRef.current;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      if (rect.height > 0) setNodeHeight(Math.round(rect.height));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [people.length, photosByPerson]);

  // Dragging disabled; positions are relationship-driven only.

  useEffect(() => {
    if (people.length === 0) return;
    people.forEach((p) => {
      if (!photosByPerson[p.id]) {
        loadPhotos(p.id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people.length]);

  const tree = useMemo(() => {
    const levels: string[][] = [];
    const effectiveRoot = rootId;
    if (!effectiveRoot) {
      return { levels, positions: new Map<string, { x: number; y: number }>(), edges: [] as Relationship[] };
    }

    const byIdVisible = new Map(people.map((p) => [p.id, p]));
    if (!byIdVisible.has(effectiveRoot)) {
      return { levels, positions: new Map<string, { x: number; y: number }>(), edges: [] as Relationship[] };
    }

    const visiblePeople = people;
    const parentEdgesRaw = relationships.filter((r) => r.type === "parent");
    const spouseEdges = relationships.filter((r) => r.type === "spouse");
    const siblingEdges = relationships.filter((r) => r.type === "sibling");

    const parentEdges = parentEdgesRaw.map((r) => {
      const a = byIdVisible.get(r.fromId);
      const b = byIdVisible.get(r.toId);
      if (a?.birthYear && b?.birthYear && a.birthYear > b.birthYear) {
        return { ...r, fromId: r.toId, toId: r.fromId };
      }
      return r;
    });

    const parentsOf = new Map<string, string[]>();
    parentEdges.forEach((r) => {
      parentsOf.set(r.toId, [...(parentsOf.get(r.toId) || []), r.fromId]);
    });

    const inferredEdges: { fromId: string; toId: string; type: string }[] = [];
    siblingEdges.forEach((r) => {
      const sibA = r.fromId;
      const sibB = r.toId;
      const parentsA = parentsOf.get(sibA) || [];
      const parentsB = parentsOf.get(sibB) || [];
      parentsA.forEach((p) => {
        if (!parentsB.includes(p)) inferredEdges.push({ fromId: p, toId: sibB, type: "parent" });
      });
      parentsB.forEach((p) => {
        if (!parentsA.includes(p)) inferredEdges.push({ fromId: p, toId: sibA, type: "parent" });
      });
    });

    const spouseOf = new Map<string, string>();
    spouseEdges.forEach((e) => spouseOf.set(e.fromId, e.toId));
    parentEdges.forEach((r) => {
      const spouse = spouseOf.get(r.fromId);
      if (spouse) inferredEdges.push({ fromId: spouse, toId: r.toId, type: "parent" });
    });

    const allParentEdges = [...parentEdges, ...inferredEdges];
    const levelById = new Map<string, number>();
    visiblePeople.forEach((p) => {
      if (!(parentsOf.get(p.id) || []).length) levelById.set(p.id, 0);
    });

    let changed = true;
    let guard = 0;
    while (changed && guard < 1000) {
      changed = false;
      guard += 1;
      allParentEdges.forEach((r) => {
        const p = r.fromId;
        const c = r.toId;
        const lp = levelById.get(p);
        const lc = levelById.get(c);
        if (lp !== undefined && lc === undefined) {
          levelById.set(c, lp + 1);
          changed = true;
        } else if (lc !== undefined && lp === undefined) {
          levelById.set(p, lc - 1);
          changed = true;
        }
      });
      siblingEdges.forEach((r) => {
        const a = r.fromId;
        const b = r.toId;
        const la = levelById.get(a);
        const lb = levelById.get(b);
        if (la !== undefined && lb === undefined) {
          levelById.set(b, la);
          changed = true;
        } else if (lb !== undefined && la === undefined) {
          levelById.set(a, lb);
          changed = true;
        } else if (la !== undefined && lb !== undefined && la !== lb) {
          const max = Math.max(la, lb);
          levelById.set(a, max);
          levelById.set(b, max);
          changed = true;
        }
      });
      spouseEdges.forEach((r) => {
        const a = r.fromId;
        const b = r.toId;
        const la = levelById.get(a);
        const lb = levelById.get(b);
        if (la !== undefined && lb === undefined) {
          levelById.set(b, la);
          changed = true;
        } else if (lb !== undefined && la === undefined) {
          levelById.set(a, lb);
          changed = true;
        } else if (la !== undefined && lb !== undefined && la !== lb) {
          const max = Math.max(la, lb);
          levelById.set(a, max);
          levelById.set(b, max);
          changed = true;
        }
      });
    }

    visiblePeople.forEach((p) => {
      if (!levelById.has(p.id)) levelById.set(p.id, 0);
    });

    const minLevel = Math.min(...Array.from(levelById.values()));
    const maxLevel = Math.max(...Array.from(levelById.values()));
    const spouseMap = new Map<string, string>();
    spouseEdges.forEach((r) => spouseMap.set(r.fromId, r.toId));

    for (let lvl = minLevel; lvl <= maxLevel; lvl += 1) {
      const ids = Array.from(levelById.entries())
        .filter(([, l]) => l === lvl)
        .map(([id]) => id)
        .sort((a, b) => {
          const pa = byIdVisible.get(a);
          const pb = byIdVisible.get(b);
          return (pa ? displayName(pa) : a).localeCompare(pb ? displayName(pb) : b);
        });

      const ordered: string[] = [];
      const used = new Set<string>();
      ids.forEach((id) => {
        if (used.has(id)) return;
        const spouse = spouseMap.get(id);
        if (spouse && ids.includes(spouse) && !used.has(spouse)) {
          ordered.push(id, spouse);
          used.add(id);
          used.add(spouse);
        } else {
          ordered.push(id);
          used.add(id);
        }
      });
      levels.push(ordered);
    }

    const positions = new Map<string, { x: number; y: number }>();
    const nodeW = 220;
    const nodeH = nodeHeight || 220;
    const gapX = nodeW;
    const gapY = Math.max(12, Math.round(nodeH * 0.12));
    const rowStep = Math.max(220, Math.round(nodeH * 1.6));

    levels.forEach((level, row) => {
      level.forEach((id, col) => {
        const x = col * (nodeW + gapX);
        const y = row * rowStep;
        positions.set(id, { x, y });
      });
    });

    return {
      levels,
      positions,
      edges: relationships,
      nodeW,
      nodeH,
      parentEdges: allParentEdges,
      spouseEdges,
      gapY,
      rowStep,
      gapX,
    };
  }, [people, relationships, rootId, nodeHeight]);

  const nodeW = tree.nodeW ?? 220;
  const nodeH = tree.nodeH ?? 220;
  const gapX = tree.gapX ?? nodeW;
  const rowStep = tree.rowStep ?? Math.max(220, Math.round(nodeH * 1.6));

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      {(() => {
        const peopleById = new Map(people.map((p) => [p.id, p]));
        return (
          <>
      <h1 style={{ marginTop: 0 }}>Family Tree</h1>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }} />

      {err ? (
        <pre style={{ background: "#fee2e2", padding: 12, borderRadius: 10, color: "#991b1b" }}>
          {err}
        </pre>
      ) : null}

      <div style={{ display: "grid", gap: 10, marginBottom: 16, maxWidth: 900, minHeight: 40 }}>
        {isEditing ? (
          <>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {relMsg ? <span style={{ fontSize: 12, color: "#555" }}>{relMsg}</span> : null}
            </div>
            <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ marginLeft: "auto" }}>
                <button
                  onClick={() => {
                    setConnectMode((m) => (m ? null : "parent"));
                    setSelectedIds([]);
                    setRelMsg("");
                  }}
                  style={{ fontSize: 12 }}
                >
                  {connectMode ? "Cancel add relationship" : "Add relationship"}
                </button>
              </div>
              {connectMode ? (
                <>
                  <label style={{ fontSize: 12, color: "#444" }}>Type</label>
                  <select
                    value={connectMode}
                    onChange={(e) => setConnectMode(e.target.value as any)}
                    style={{ fontSize: 12 }}
                  >
                    <option value="parent">Parent → Child</option>
                    <option value="child">Child → Parent</option>
                    <option value="spouse">Spouse</option>
                    <option value="sibling">Sibling</option>
                  </select>
                  <span style={{ fontSize: 12, color: "#666" }}>Click two cards to connect</span>
                </>
              ) : null}
            </div>
          </>
        ) : (
          <div style={{ height: 34 }} />
        )}
      </div>

      {people.length === 0 ? (
        <div style={{ color: "#666" }}>No people yet. Add people on <Link href="/people">/people</Link>.</div>
      ) : tree.levels.length === 0 ? (
        <div style={{ color: "#666" }}>Select a root person to build the tree.</div>
      ) : (
        <div style={{ position: "relative", overflow: "auto", paddingBottom: 24, minHeight: "100vh" }}>
          <div style={{ position: "absolute", left: -9999, top: -9999, width: 180 }}>
            <div
              ref={measureRef}
              style={{
                border: "2px solid #cfe4ff",
                borderRadius: 12,
                padding: 10,
                background: "#fff",
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
                }}
              />
              <div style={{ fontWeight: 700, fontSize: 13 }}>Measure</div>
              <div style={{ fontSize: 11, color: "#555", marginBottom: 6 }}>Birth year: —</div>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 11, color: "#666" }}>No tagged photos.</div>
                <button style={{ fontSize: 11, width: "fit-content" }}>Choose profile</button>
              </div>
            </div>
          </div>
          {(() => {
            const getPos = (id: string) => tree.positions.get(id);
            return (
          <svg
            width={Math.max(600, tree.levels[0].length * 240)}
            height={(tree.levels.length - 1) * (tree.rowStep ?? 200) + (tree.nodeH ?? 220) + 80}
            style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1 }}
          >
            <defs>
              <marker id="arrow" markerWidth="10" markerHeight="10" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L6,3 z" fill="#111827" />
              </marker>
            </defs>
            {tree.spouseEdges?.map((e) => {
              const from = getPos(e.fromId);
              const to = getPos(e.toId);
              if (!from || !to) return null;
              const x1 = from.x + (tree.nodeW ?? 180) / 2;
              const y1 = from.y + (tree.nodeH ?? 220);
              const x2 = to.x + (tree.nodeW ?? 180) / 2;
              const y2 = to.y;
              const y = from.y + (tree.nodeH ?? 220) / 2;
              const x2s = to.x + (tree.nodeW ?? 180) / 2;
              const midX = (x1 + x2s) / 2;
              // const x1 = from.x + (tree.nodeW ?? 180) / 2;
              // const y1 = from.y + (tree.nodeH ?? 220);
              // const x2 = to.x + (tree.nodeW ?? 180) / 2;
              // const y2 = to.y;
              // const y = 515;
              // const x2s = to.x + (tree.nodeW ?? 180) / 2;
              // const midX = (x1 + x2s) / 2;
              return (
                <g key={e.id}>
                  <line
                    x1={x1}
                    y1={y}
                    x2={x2s}
                    y2={y}
                    stroke="#ef4444"
                    strokeWidth="2"
                  />
                  <text x={midX} y={y - 6} textAnchor="middle" fontSize="12" fill="#ef4444">❤</text>
                </g>
              );
            })}

            {(() => {
              const parentEdges = relationships.filter((r) => r.type === "parent");
              const spouseEdges = relationships.filter((r) => r.type === "spouse");
              const spouseOf = new Map<string, string>();
              spouseEdges.forEach((e) => spouseOf.set(e.fromId, e.toId));

              const childrenByParent = new Map<string, string[]>();
              parentEdges.forEach((e) => {
                const list = childrenByParent.get(e.fromId) || [];
                list.push(e.toId);
                childrenByParent.set(e.fromId, list);
              });

              const groups = new Map<string, { parents: string[]; children: string[] }>();
              childrenByParent.forEach((children, parentId) => {
                const spouseId = spouseOf.get(parentId);
                // Only treat spouse as a joint parent if spouse is ALSO an explicit parent of at least one child
                const spouseChildren = spouseId ? (childrenByParent.get(spouseId) || []) : [];
                const sharedChild = spouseChildren.some((c) => children.includes(c));
                const parents = spouseId && sharedChild ? [parentId, spouseId] : [parentId];
                const key = parents.slice().sort().join("|");
                const existing = groups.get(key);
                const mergedChildren = Array.from(new Set([...(existing?.children || []), ...children]));
                groups.set(key, { parents, children: mergedChildren });
              });

              const nodeW = tree.nodeW ?? 180;
              const nodeH = tree.nodeH ?? 220;

              return Array.from(groups.entries()).map(([key, group]) => {
                const parentPositions = group.parents
                  .map((id) => getPos(id))
                  .filter(Boolean) as { x: number; y: number }[];
                const childPositions = group.children
                  .map((id) => getPos(id))
                  .filter(Boolean) as { x: number; y: number }[];
                if (parentPositions.length === 0 || childPositions.length === 0) return null;

                const parentCenters = parentPositions.map((p) => p.x + nodeW / 2);
                const parentMidX = parentCenters.reduce((a, b) => a + b, 0) / parentCenters.length;
                const childCenters = childPositions.map((p) => p.x + nodeW / 2);
                const childTopY = Math.min(...childPositions.map((p) => p.y));

                const parentMidY = parentPositions.reduce((acc, p) => acc + (p.y + nodeH / 2), 0) / parentPositions.length;

                return (
                  <g key={key}>
                    {childCenters.length === 1 ? (
                      <line x1={childCenters[0]} y1={parentMidY} x2={childCenters[0]} y2={childTopY} stroke="#111827" strokeWidth="2" />
                    ) : (
                      (() => {
                        const junctionY = childTopY - 6;
                        const minX = Math.min(...childCenters);
                        const maxX = Math.max(...childCenters);
                        return (
                          <>
                            <line x1={parentMidX} y1={parentMidY} x2={parentMidX} y2={junctionY} stroke="#111827" strokeWidth="2" />
                            <line x1={minX} y1={junctionY} x2={maxX} y2={junctionY} stroke="#111827" strokeWidth="2" />
                            {childCenters.map((cx, idx) => (
                              <line key={`${key}-c-${idx}`} x1={cx} y1={junctionY} x2={cx} y2={childTopY} stroke="#111827" strokeWidth="2" />
                            ))}
                          </>
                        );
                      })()
                    )}
                  </g>
                );
              });
            })()}
          </svg>
            );
          })()}

          <div
            style={{
              position: "relative",
              width: Math.max(600, tree.levels[0].length * (nodeW + gapX)),
              height: Math.max(
                (tree.levels.length - 1) * rowStep + nodeH + 80,
                1200
              ),
              zIndex: 2,
            }}
          >
            {tree.levels.flat().map((id) => {
              const person = peopleById.get(id);
              if (!person) return null;
              const pos = tree.positions.get(id);
              if (!pos) return null;
              const photos = photosByPerson[id] || [];
              const profile =
                (person.profilePhotoId
                  ? photos.find((p) => p.id === person.profilePhotoId)
                  : null) || photos[0];
              const profileSrc = profile
                ? profile.storageUrl
                  ? profile.storageUrl
                  : profile.localPath
                  ? profile.localPath
                  : proxyImgUrl(profile.baseUrl, profile.id, 300, 300)
                : "";
              const isOpen = !!pickerOpen[id];

              return (
                <div
                  key={id}
                  style={{
                    position: "absolute",
                    left: pos.x,
                    top: pos.y,
                    width: nodeW,
                    height: nodeH,
                    border: "2px solid #cfe4ff",
                    borderRadius: 12,
                    padding: 10,
                    background: "#fff",
                    cursor: connectMode ? "pointer" : "default",
                    outline: selectedIds.includes(id) ? "2px solid #2563eb" : "none",
                    boxSizing: "border-box",
                  }}
                  onClick={(e) => {
                    if (!connectMode) return;
                    e.preventDefault();
                    const next = selectedIds.includes(id)
                      ? selectedIds.filter((x) => x !== id)
                      : [...selectedIds, id].slice(-2);
                    setSelectedIds(next);
                    if (next.length === 2) {
                      const [a, b] = next;
                      addRelationship(a, b, connectMode);
                    }
                  }}
                >
                  <Link
                    href={`/family-tree/${id}`}
                    style={{ textDecoration: "none", color: "inherit" }}
                    onClick={(e) => {
                      if (connectMode) e.preventDefault();
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
                      }}
                    >
                      {profileSrc ? (
                        <img
                          src={profileSrc}
                          alt={displayName(person)}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "contain",
                            display: "block",
                            transformOrigin: "center",
                            transform: `translate(${person.profileX ?? 0}%, ${person.profileY ?? 0}%) scale(${person.profileZoom ?? 1}) rotate(${profile?.rotation ?? 0}deg)`,
                          }}
                        />
                      ) : (
                        <div style={{ padding: 12, color: "#999", fontSize: 13 }}>No tagged photo</div>
                      )}
                    </div>
                  </Link>
                  <div style={{ fontWeight: 700, fontSize: 15, textAlign: "right" }}>
                    <Link href={`/family-tree/${id}`}>{displayName(person)}</Link>
                  </div>
                  <div style={{ fontSize: 13, color: "#555", marginBottom: 6, textAlign: "right", fontWeight: 700 }}>
                    Born {person.birthYear ?? "—"}
                  </div>

                  {loadingPhotos[id] ? (
                    <div style={{ fontSize: 12, color: "#666" }}>Loading photos…</div>
                  ) : photos.length === 0 ? (
                    <div style={{ fontSize: 12, color: "#666" }}>No tagged photos.</div>
                  ) : null}

                </div>
              );
            })}
          </div>
        </div>
      )}
          </>
        );
      })()}
    </main>
  );
}
