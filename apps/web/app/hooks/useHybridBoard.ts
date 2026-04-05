"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface DotShape {
  id: string;
  type: "dot";
  x: number;
  y: number;
  color: string;
  size: number;
  updatedAt: number;
}

type PendingOp = { type: "draw"; shape: DotShape };

type SyncStatus = "local" | "connecting" | "syncing" | "live";

const SHAPES_STORAGE_KEY = "hybrid-board:shapes";
const PENDING_STORAGE_KEY = "hybrid-board:pending";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseDotShape(value: unknown): DotShape | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Record<string, unknown>;
  if (raw.type !== "dot") {
    return null;
  }

  const id = typeof raw.id === "string" ? raw.id : null;
  const x = typeof raw.x === "number" ? raw.x : null;
  const y = typeof raw.y === "number" ? raw.y : null;
  const color = typeof raw.color === "string" ? raw.color : "#2563eb";
  const size = typeof raw.size === "number" ? raw.size : 10;
  const updatedAt = typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now();

  if (!id || x === null || y === null) {
    return null;
  }

  return {
    id,
    type: "dot",
    x,
    y,
    color,
    size,
    updatedAt,
  };
}

function mergeShapes(localShapes: DotShape[], serverShapes: DotShape[]): DotShape[] {
  const byId = new Map<string, DotShape>();

  for (const shape of serverShapes) {
    byId.set(shape.id, shape);
  }

  for (const shape of localShapes) {
    const existing = byId.get(shape.id);
    if (!existing || shape.updatedAt >= existing.updatedAt) {
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
  if (!existing) {
    return shapes;
  }
  if (existing.updatedAt > incoming.updatedAt) {
    return shapes;
  }

  const next = [...shapes];
  next[index] = incoming;
  return next;
}

export function useHybridBoard(params: {
  token: string;
  userId: string;
  wsUrl?: string;
}) {
  const { token, userId, wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8081" } = params;

  const [shapes, setShapes] = useState<DotShape[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("local");
  const [lastError, setLastError] = useState<string>("");

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

  const scheduleReconnect = useCallback(() => {
    if (!token || !userId) {
      return;
    }

    if (reconnectTimerRef.current !== null) {
      return;
    }

    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      connect();
    }, 2000);
  }, [token, userId]);

  const connect = useCallback(() => {
    if (!token || !userId) {
      setSyncStatus("local");
      return;
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      return;
    }

    setSyncStatus("connecting");
    setLastError("");

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setSyncStatus("syncing");
      ws.send(
        JSON.stringify({
          type: "join_room",
          roomId: `private-${userId}`,
          token,
        })
      );
    };

    ws.onmessage = (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data) as unknown;
      } catch {
        return;
      }

      if (!isRecord(parsed)) {
        return;
      }

      const messageType = parsed.type;
      if (typeof messageType !== "string") {
        return;
      }

      if (messageType === "error") {
        const message = typeof parsed.message === "string" ? parsed.message : "Unknown error";
        setLastError(message);
        return;
      }

      if (messageType === "room_joined") {
        const rawShapes = Array.isArray(parsed.shapes) ? parsed.shapes : [];
        const serverShapes = rawShapes
          .map((shape: unknown) => parseDotShape(shape))
          .filter((shape: DotShape | null): shape is DotShape => shape !== null);

        const merged = mergeShapes(shapesRef.current, serverShapes);
        setAndPersistShapes(merged);
        flushPending();
        setSyncStatus("live");
        return;
      }

      if (messageType === "draw") {
        const incoming = parseDotShape(parsed.shape);
        if (!incoming) {
          return;
        }

        const next = upsertShape(shapesRef.current, incoming);
        setAndPersistShapes(next);
      }
    };

    ws.onclose = () => {
      setSyncStatus("local");
      wsRef.current = null;
      scheduleReconnect();
    };

    ws.onerror = () => {
      setSyncStatus("local");
      ws.close();
    };
  }, [flushPending, scheduleReconnect, setAndPersistShapes, token, userId, wsUrl]);

  useEffect(() => {
    const rawShapes = localStorage.getItem(SHAPES_STORAGE_KEY);
    const rawPending = localStorage.getItem(PENDING_STORAGE_KEY);

    if (rawShapes) {
      try {
        const parsedShapes = JSON.parse(rawShapes) as unknown[];
        const restored = parsedShapes
          .map((shape) => parseDotShape(shape))
          .filter((shape): shape is DotShape => shape !== null);
        setAndPersistShapes(restored);
      } catch {
        setAndPersistShapes([]);
      }
    }

    if (rawPending) {
      try {
        const parsedPending = JSON.parse(rawPending) as unknown[];
        pendingRef.current = parsedPending.filter((op): op is PendingOp => {
          if (!op || typeof op !== "object") {
            return false;
          }

          const raw = op as Record<string, unknown>;
          return raw.type === "draw" && parseDotShape(raw.shape) !== null;
        }) as PendingOp[];
      } catch {
        pendingRef.current = [];
      }
    }

    connect();

    return () => {
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
      }

      wsRef.current?.close();
    };
  }, [connect, setAndPersistShapes]);

  useEffect(() => {
    connect();
  }, [connect]);

  const addDot = useCallback((x: number, y: number) => {
    const newDot: DotShape = {
      id: crypto.randomUUID(),
      type: "dot",
      x,
      y,
      color: "#2563eb",
      size: 10,
      updatedAt: Date.now(),
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
  }, [persistPending, setAndPersistShapes, syncStatus]);

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
    pendingCount: pendingRef.current.length,
  };
}
