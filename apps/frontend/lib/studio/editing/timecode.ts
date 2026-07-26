// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

export type TimeCode = "HH:MM:SS:FF" | "MM:SS" | "SS";

function pad(value: number, length: number = 2): string {
  return String(Math.max(0, value)).padStart(length, "0");
}

export function formatTimeCode(seconds: number, format: TimeCode = "HH:MM:SS:FF", fps: number = 30): string {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const totalFrames = Math.floor(safeSeconds * fps);
  const frames = totalFrames % fps;
  const totalWholeSeconds = Math.floor(totalFrames / fps);
  const ss = totalWholeSeconds % 60;
  const mm = Math.floor(totalWholeSeconds / 60) % 60;
  const hh = Math.floor(totalWholeSeconds / 3600);

  if (format === "SS") return String(totalWholeSeconds);
  if (format === "MM:SS") return `${pad(mm)}:${pad(ss)}`;
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(frames)}`;
}

export function parseTimeCode(value: string, format: TimeCode = "HH:MM:SS:FF", fps: number = 30): number | null {
  const text = value.trim();
  if (!text) return null;

  if (format === "SS") {
    const seconds = Number(text);
    return Number.isFinite(seconds) ? Math.max(0, seconds) : null;
  }

  if (format === "MM:SS") {
    const parts = text.split(":").map(Number);
    if (parts.length !== 2 || parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
    const [mm, ss] = parts;
    return mm * 60 + ss;
  }

  const parts = text.split(":").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  const [hh, mm, ss, ff] = parts;
  if (ff >= fps) return null;
  return hh * 3600 + mm * 60 + ss + ff / fps;
}

