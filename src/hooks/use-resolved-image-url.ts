// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * useResolvedImageUrl — Resolve image URLs for display in <img> tags.
 *
 * Handles URL formats:
 * - `https://...` / `http://...` → pass through
 * - `data:image/...` → pass through (legacy base64)
 * - `local-image://...` → pass through (Electron custom protocol handles directly)
 * - `null/undefined/''` → null
 *
 * Note: `local-image://` is registered as a privileged Electron protocol
 * (bypassCSP, secure) with a handler in main process, so it can be used
 * directly in <img src> without converting to file:// URLs.
 */

import { useMemo } from 'react';

/**
 * React hook to resolve an image URL for rendering.
 * All supported URL formats are returned synchronously.
 */
export function useResolvedImageUrl(rawUrl: string | null | undefined): string | null {
  return useMemo(() => {
    if (!rawUrl) return null;
    // All supported formats pass through directly:
    // - http:// / https://  → remote URLs
    // - data:               → inline base64
    // - local-image://      → Electron custom protocol (handled by protocol.handle)
    return rawUrl;
  }, [rawUrl]);
}
