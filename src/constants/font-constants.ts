// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

export type FontFamily =
  | "Inter, sans-serif"
  | "Arial, sans-serif"
  | "'Times New Roman', serif"
  | "'Courier New', monospace";

export const FONT_OPTIONS: Array<{ label: string; value: FontFamily }> = [
  { label: "Inter", value: "Inter, sans-serif" },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Times New Roman", value: "'Times New Roman', serif" },
  { label: "Courier New", value: "'Courier New', monospace" },
];

