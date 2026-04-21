"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface DotShape {
  id: string;
  type: "dot";
  x: number;
  y: number;
  color: string;
  size: number;
  version: number;
  versionNonce: number;
  deleted?: boolean;
}

type PendingOp = { type: "draw"; shape: DotShape };
type SyncStatus = "local" | "connecting" | "syncing" | "live";

const SHAPES_STORAGE_KEY = "hybrid-board:shapes";
const PENDING_STORAGE_KEY = "hybrid-board:pending";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNewer(a: DotShape, b: DotShape): boolean {
  if (a.version !== b.version) {
    return a.version > b.version;
  }

  return a.versionNonce > b.versionNonce;
}

function parseDotShape(value: unknown): DotShape | null {
  if (!isRecord(value) || value.type !== "dot") {
    return null;
  }

  const id = typeof value.id === "string" ? value.id : null;
  const x = typeof value.x === "number" ? value.x : null;
  const y = typeof value.y === "number" ? value.y : null;
  const color = typeof value.color === "string" ? value.color : "#2563eb";
  const size = typeof value.size === "number" ? value.size : 10;
  const version = typeof value.version === "number" ? value.version : null;
  const versionNonce = typeof value.versionNonce === "number" ? value.versionNonce : null;
  const deleted = typeof value.deleted === "boolean" ? value.deleted : false;

  if (!id || x === null || y === null || version === null || versionNonce === null) {
    return null;
  }

  return {
    id,
    type: "dot",
    x,
    y,
    color,
    size,
    version,
    versionNonce,
    deleted,
  };
}

function mergeShapes(localShapes: DotShape[], serverShapes: DotShape[]): DotShape[] {
  const byId = new Map<string, DotShape>();

  for (const shape of serverShapes) {
    byId.set(shape.id, shape);
  }

  for (const shape of localShapes) {
    const existing = byId.get(shape.id);
    if (!existing || isNewer(shape, existing)) {
      byId.set(shape.id, shape);
    }
  }

  return Array.from(byId.values());
}

function upsertShape(shapes: DotShape[], incoming: DotShape): DotShape[] {
  const index = shapes.findIndex((shape) => shape.id === incoming.id);
  if (index === -1) {
    return [...shapes, incoming];
  }

  const existing = shapes[index];
  if (!existing || !isNewer(incoming, existing)) {
    return shapes;
  }

  const next = [...shapes];
  next[index] = incoming;
  return next;
}

function makeNonce(): number {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}

export function useHybridBoard(params: { token: string; userId: string; wsUrl?: string }) {
  const { token, userId, wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8081" } = params;

  const [shapes, setShapes] = useState<DotShape[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("local");
  const [lastError, setLastError] = useState("");
  const [pendingCount, setPendingCount] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const shapesRef = useRef<DotShape[]>([]);
  const pendingRef = useRef<PendingOp[]>([]);

  const setAndPersistShapes = useCallback((next: DotShape[]) => {
    shapesRef.current = next;
    setShapes(next);
    localStorage.setItem(SHAPES_STORAGE_KEY, JSON.stringify(next));
  }, []);

  const persistPending = useCallback(() => {
    localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(pendingRef.current));
    setPendingCount(pendingRef.current.length);
  }, []);

  const flushPending = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    for (const op of pendingRef.current) {
      ws.send(JSON.stringify(op));
    }

    pendingRef.current = [];
    persistPending();
  }, [persistPending]);

  const connect = useCallback(() => {
    if (!token || !userId) {
      setSyncStatus("local");
      return;
    }

    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const roomId = `private-${userId}`;

    setSyncStatus("connecting");
    setLastError("");

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setSyncStatus("syncing");
      ws.send(JSON.stringify({ type: "join_room", roomId, token }));
    };

    ws.onmessage = (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data as string);
      } catch {
        return;
      }

      if (!isRecord(parsed) || typeof parsed.type !== "string") {
        return;
      }

      if (parsed.type === "error") {
        setLastError(typeof parsed.message === "string" ? parsed.message : "Unknown error");
        return;
      }

      if (parsed.type === "room_joined") {
        const rawShapes = Array.isArray(parsed.shapes) ? parsed.shapes : [];
        const serverShapes = rawShapes
          .map((value) => parseDotShape(value))
          .filter((shape): shape is DotShape => shape !== null);

        const merged = mergeShapes(shapesRef.current, serverShapes);
        setAndPersistShapes(merged);
        flushPending();
        setSyncStatus("live");
        return;
      }

      if (parsed.type === "draw") {
        const incoming = parseDotShape(parsed.shape);
        if (!incoming) {
          return;
        }

        const next = upsertShape(shapesRef.current, incoming);
        setAndPersistShapes(next);
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      setSyncStatus("local");

      if (reconnectTimerRef.current !== null) {
        return;
      }

      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, 2000);
    };

    ws.onerror = () => {
      setSyncStatus("local");
      ws.close();
    };
  }, [flushPending, setAndPersistShapes, token, userId, wsUrl]);

  useEffect(() => {
    const rawShapes = localStorage.getItem(SHAPES_STORAGE_KEY);
    if (rawShapes) {
      try {
        const parsed = JSON.parse(rawShapes) as unknown;
        const rawArray = Array.isArray(parsed) ? parsed : [];
        const restored = rawArray
          .map((value) => parseDotShape(value))
          .filter((shape): shape is DotShape => shape !== null);
        setAndPersistShapes(restored);
      } catch {
        setAndPersistShapes([]);
      }
    }

    const rawPending = localStorage.getItem(PENDING_STORAGE_KEY);
    if (rawPending) {
      try {
        const parsed = JSON.parse(rawPending) as unknown;
        const rawArray = Array.isArray(parsed) ? parsed : [];
        pendingRef.current = rawArray
          .map((value) => {
            if (!isRecord(value) || value.type !== "draw") {
              return null;
            }

            const shape = parseDotShape(value.shape);
            return shape ? ({ type: "draw", shape } as PendingOp) : null;
          })
          .filter((op): op is PendingOp => op !== null);
      } catch {
        pendingRef.current = [];
      }
    }

    persistPending();
    connect();

    return () => {
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
      }
      wsRef.current?.close();
    };
  }, [connect, persistPending, setAndPersistShapes]);

  const addDot = useCallback(
    (x: number, y: number) => {
      const newDot: DotShape = {
        id: crypto.randomUUID(),
        type: "dot",
        x,
        y,
        color: "#2563eb",
        size: 10,
        version: 1,
        versionNonce: makeNonce(),
        deleted: false,
      };

      const next = [...shapesRef.current, newDot];
      setAndPersistShapes(next);

      const op: PendingOp = { type: "draw", shape: newDot };
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN && syncStatus === "live") {
        ws.send(JSON.stringify(op));
        return;
      }

      pendingRef.current.push(op);
      persistPending();
    },
    [persistPending, setAndPersistShapes, syncStatus]
  );

  const clearLocalBoard = useCallback(() => {
    setAndPersistShapes([]);
    pendingRef.current = [];
    persistPending();
  }, [persistPending, setAndPersistShapes]);

  return {
    shapes,
    addDot,
    clearLocalBoard,
    syncStatus,
    lastError,
    pendingCount,
  };
}
