// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
export interface UpdateManifest {
  version: string;
  releaseNotes?: string;
  notes?: string;
  publishedAt?: string;
  githubUrl?: string;
  baiduUrl?: string;
  baiduCode?: string;
}

export interface AvailableUpdateInfo {
  currentVersion: string;
  latestVersion: string;
  releaseNotes?: string;
  publishedAt?: string;
  githubUrl?: string;
  baiduUrl?: string;
  baiduCode?: string;
}

export type UpdateCheckResult =
  | {
      success: true;
      currentVersion: string;
      hasUpdate: boolean;
      update: AvailableUpdateInfo | null;
    }
  | {
      success: false;
      currentVersion: string;
      error: string;
    };

export type OpenExternalResult =
  | {
      success: true;
    }
  | {
      success: false;
      error: string;
    };
