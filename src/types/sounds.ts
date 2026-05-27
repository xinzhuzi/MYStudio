// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

export interface SoundEffect {
  id: number;
  name: string;
  username?: string;
  previewUrl: string;
  downloadUrl?: string;
  duration?: number;
  tags?: string[];
  license?: string;
}

export interface SavedSound {
  id: number;
  name: string;
  username?: string;
  previewUrl: string;
  downloadUrl?: string;
  duration?: number;
  tags?: string[];
  license?: string;
  savedAt: string;
}

export interface SavedSoundsData {
  sounds: SavedSound[];
  lastModified: string;
}

