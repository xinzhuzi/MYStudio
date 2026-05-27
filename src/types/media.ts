// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
export type MediaType = "image" | "video" | "audio";

export type MediaSource = 'upload' | 'ai-image' | 'ai-video';

// Predefined system folder categories
export type MediaFolderCategory = 'ai-image' | 'ai-video' | 'upload' | 'custom';

// Folder for organizing media files
export interface MediaFolder {
  id: string;
  name: string;
  parentId: string | null; // null = root
  projectId?: string; // Associated project (optional)
  isAutoCreated?: boolean;
  isSystem?: boolean; // System folders are always visible regardless of sharing settings
  category?: MediaFolderCategory; // Predefined category type
  createdAt: number;
}

// What's stored in media library
export interface MediaFile {
  id: string;
  name: string;
  type: MediaType;
  file?: File | null; // Optional for URL-based media
  url?: string; // Object URL for preview or external URL
  thumbnailUrl?: string; // For video thumbnails
  duration?: number; // For video/audio duration
  width?: number; // For video/image width
  height?: number; // For video/image height
  fps?: number; // For video frame rate
  // Ephemeral items are used by timeline directly and should not appear in the media library or be persisted
  ephemeral?: boolean;
  // Folder organization
  folderId?: string | null; // null = root folder
  // Source tracking for AI-generated content
  source?: MediaSource;
  // Project association (for isolation)
  projectId?: string;
}
