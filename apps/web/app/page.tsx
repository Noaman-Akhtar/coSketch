"use client";

import { useEffect, useMemo, useState } from "react";
import { useHybridBoard } from "./hooks/useHybridBoard";

const TOKEN_STORAGE_KEY = "hybrid-board:token";
const USER_STORAGE_KEY = "hybrid-board:userId";

function getStatusLabel(status: "local" | "connecting" | "syncing" | "live") {
  if (status === "local") return "Local mode";
  if (status === "connecting") return "Connecting";
  if (status === "syncing") return "Syncing";
  return "Live";
}

export default function Home() {
  const [token, setToken] = useState("");
  const [userId, setUserId] = useState("");

  useEffect(() => {
    const savedToken = localStorage.getItem(TOKEN_STORAGE_KEY) ?? "";
    const savedUserId = localStorage.getItem(USER_STORAGE_KEY) ?? `demo-${crypto.randomUUID().slice(0, 8)}`;

    setToken(savedToken);
    setUserId(savedUserId);

    localStorage.setItem(USER_STORAGE_KEY, savedUserId);
  }, []);

  const safeUserId = useMemo(() => userId.trim(), [userId]);
  const safeToken = useMemo(() => token.trim(), [token]);

  const { addDot, clearLocalBoard, lastError, pendingCount, shapes, syncStatus } = useHybridBoard({
    token: safeToken,
    userId: safeUserId,
  });

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 24, marginBottom: 12 }}>Hybrid board (local-first + private room)</h1>

      <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span>JWT token (required for live sync)</span>
          <input
            value={token}
            onChange={(event) => {
              const next = event.target.value;
              setToken(next);
              localStorage.setItem(TOKEN_STORAGE_KEY, next);
            }}
            placeholder="Paste token from sign-in"
            style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #d1d5db" }}
          />
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          <span>User id</span>
          <input
            value={userId}
            onChange={(event) => {
              const next = event.target.value;
              setUserId(next);
              localStorage.setItem(USER_STORAGE_KEY, next);
            }}
            placeholder="user id"
            style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #d1d5db" }}
          />
        </label>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <strong>Status:</strong>
        <span>{getStatusLabel(syncStatus)}</span>
        <span>Pending ops: {pendingCount}</span>
        {lastError ? <span style={{ color: "#dc2626" }}>Last error: {lastError}</span> : null}
        <button
          onClick={clearLocalBoard}
          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #d1d5db", background: "white" }}
        >
          Clear local board
        </button>
      </div>

      <div
        onClick={(event) => {
          const target = event.currentTarget;
          const rect = target.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const y = event.clientY - rect.top;
          addDot(x, y);
        }}
        style={{
          height: 520,
          border: "1px solid #d1d5db",
          borderRadius: 12,
          position: "relative",
          cursor: "crosshair",
          overflow: "hidden",
          background: "#ffffff",
        }}
      >
        {shapes.map((shape) => (
          <div
            key={shape.id}
            style={{
              width: shape.size,
              height: shape.size,
              position: "absolute",
              left: shape.x - shape.size / 2,
              top: shape.y - shape.size / 2,
              borderRadius: "9999px",
              background: shape.color,
            }}
          />
        ))}
      </div>
    </main>
  );
}
