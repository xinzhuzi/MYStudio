// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { create } from "zustand";

interface PlaybackState {
  isPlaying: boolean;
  currentTime: number;
  volume: number;
  speed: number;
  muted: boolean;
  setIsPlaying: (isPlaying: boolean) => void;
  setCurrentTime: (currentTime: number) => void;
  setVolume: (volume: number) => void;
  setSpeed: (speed: number) => void;
  setMuted: (muted: boolean) => void;
}

export const usePlaybackStore = create<PlaybackState>((set) => ({
  isPlaying: false,
  currentTime: 0,
  volume: 1,
  speed: 1,
  muted: false,
  setIsPlaying: (isPlaying) => set({ isPlaying }),
  setCurrentTime: (currentTime) => set({ currentTime }),
  setVolume: (volume) => set({ volume }),
  setSpeed: (speed) => set({ speed }),
  setMuted: (muted) => set({ muted }),
}));

