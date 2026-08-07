export type ManualLayoutPosition = { x: number; y: number };

export type ManualLayoutItem =
  | {
      id: string;
      kind: "line";
      lineType: "v-black" | "h-black" | "h-blue";
      x: number;
      y: number;
      length: number;
    }
  | { id: string; kind: "heart"; x: number; y: number };

export type ManualLayoutSnapshot = {
  positions: Record<string, ManualLayoutPosition>;
  items: ManualLayoutItem[];
};

type LayoutHistoryEntry = {
  revision: number;
  savedAt: string;
  snapshot: ManualLayoutSnapshot;
};

export type StoredManualLayout = {
  revision: number;
  current: ManualLayoutSnapshot;
  history: LayoutHistoryEntry[];
};

const STORAGE_FORMAT = "phototree-manual-layout-v2";
const MAX_HISTORY = 10;

function isLineType(value: string): value is "v-black" | "h-black" | "h-blue" {
  return value === "v-black" || value === "h-black" || value === "h-blue";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function parseManualLayoutSnapshot(value: unknown): ManualLayoutSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as { positions?: unknown; items?: unknown };
  if (!candidate.positions || typeof candidate.positions !== "object" || Array.isArray(candidate.positions)) {
    return null;
  }
  if (!Array.isArray(candidate.items)) return null;

  const positions: Record<string, ManualLayoutPosition> = {};
  for (const [id, rawPosition] of Object.entries(candidate.positions)) {
    if (!id || !rawPosition || typeof rawPosition !== "object" || Array.isArray(rawPosition)) return null;
    const position = rawPosition as { x?: unknown; y?: unknown };
    if (!isFiniteNumber(position.x) || !isFiniteNumber(position.y)) return null;
    positions[id] = { x: position.x, y: position.y };
  }

  const items: ManualLayoutItem[] = [];
  for (const rawItem of candidate.items) {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) return null;
    const item = rawItem as {
      id?: unknown;
      kind?: unknown;
      lineType?: unknown;
      x?: unknown;
      y?: unknown;
      length?: unknown;
    };
    if (typeof item.id !== "string" || !item.id || !isFiniteNumber(item.x) || !isFiniteNumber(item.y)) {
      return null;
    }
    if (item.kind === "heart") {
      items.push({ id: item.id, kind: "heart", x: item.x, y: item.y });
      continue;
    }
    if (
      item.kind !== "line" ||
      typeof item.lineType !== "string" ||
      !isLineType(item.lineType) ||
      !isFiniteNumber(item.length) ||
      item.length <= 0
    ) {
      return null;
    }
    items.push({
      id: item.id,
      kind: "line",
      lineType: item.lineType,
      x: item.x,
      y: item.y,
      length: item.length,
    });
  }

  return { positions, items };
}

export function decodeStoredManualLayout(data: string): StoredManualLayout | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const envelope = parsed as {
      format?: unknown;
      revision?: unknown;
      current?: unknown;
      history?: unknown;
    };
    if (envelope.format === STORAGE_FORMAT) {
      const current = parseManualLayoutSnapshot(envelope.current);
      if (!current) return null;
      const revision =
        typeof envelope.revision === "number" && Number.isInteger(envelope.revision) && envelope.revision > 0
          ? envelope.revision
          : 1;
      const history = Array.isArray(envelope.history)
        ? envelope.history.flatMap((rawEntry): LayoutHistoryEntry[] => {
            if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) return [];
            const entry = rawEntry as { revision?: unknown; savedAt?: unknown; snapshot?: unknown };
            const snapshot = parseManualLayoutSnapshot(entry.snapshot);
            if (
              !snapshot ||
              typeof entry.revision !== "number" ||
              !Number.isInteger(entry.revision) ||
              typeof entry.savedAt !== "string"
            ) {
              return [];
            }
            return [{ revision: entry.revision, savedAt: entry.savedAt, snapshot }];
          })
        : [];
      return { revision, current, history: history.slice(0, MAX_HISTORY) };
    }
  }

  const legacySnapshot = parseManualLayoutSnapshot(parsed);
  return legacySnapshot ? { revision: 1, current: legacySnapshot, history: [] } : null;
}

export function encodeStoredManualLayout(
  next: ManualLayoutSnapshot,
  existing: StoredManualLayout | null,
  existingSavedAt?: string
) {
  const revision = existing ? existing.revision + 1 : 1;
  const history = existing
    ? [
        {
          revision: existing.revision,
          savedAt: existingSavedAt || new Date().toISOString(),
          snapshot: existing.current,
        },
        ...existing.history,
      ].slice(0, MAX_HISTORY)
    : [];

  return {
    revision,
    data: JSON.stringify({ format: STORAGE_FORMAT, revision, current: next, history }),
  };
}

export function serializeManualLayoutSnapshot(snapshot: ManualLayoutSnapshot) {
  return JSON.stringify(snapshot);
}

export function isCollapsedManualLayout(snapshot: ManualLayoutSnapshot, personIds: string[]) {
  if (personIds.length < 2) return false;
  const coordinates = new Set(
    personIds.flatMap((id) => {
      const position = snapshot.positions[id];
      return position ? [`${position.x}:${position.y}`] : [];
    })
  );
  return coordinates.size < personIds.length;
}
