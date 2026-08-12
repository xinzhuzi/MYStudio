// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-larger. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import type { MetadataOverlay } from "@/types/artifacts";

/**
 * Maximum lengths for editable metadata fields
 */
export const MAX_NAME_LENGTH = 200;
export const MAX_NOTES_LENGTH = 2000;
export const MAX_TAGS_COUNT = 20;
export const MAX_TAG_LENGTH = 50;

/**
 * Validate metadata overlay before applying
 */
export function validateMetadataOverlay(
  overlay: Partial<MetadataOverlay>,
  _existingName?: string
): { valid: boolean; errors: string[]; normalized: Partial<MetadataOverlay> } {
  const errors: string[] = [];
  const normalized: Partial<MetadataOverlay> = {};

  // Validate name
  if ("name" in overlay && overlay.name !== undefined) {
    if (overlay.name.length === 0) {
      errors.push("Name cannot be empty");
    } else if (overlay.name.length > MAX_NAME_LENGTH) {
      errors.push(`Name exceeds maximum length of ${MAX_NAME_LENGTH} characters`);
    } else {
      normalized.name = overlay.name.trim();
    }
  }

  // Validate tags
  if ("tags" in overlay && overlay.tags !== undefined) {
    if (!Array.isArray(overlay.tags)) {
      errors.push("Tags must be an array");
    } else if (overlay.tags.length > MAX_TAGS_COUNT) {
      errors.push(`Tags exceed maximum count of ${MAX_TAGS_COUNT}`);
    } else {
      const normalizedTags: string[] = [];
      overlay.tags.forEach((tag, idx) => {
        if (typeof tag !== "string") {
          errors.push(`Tag at index ${idx} is not a string`);
        } else if (tag.trim().length === 0) {
          errors.push(`Tag at index ${idx} is empty`);
        } else if (tag.length > MAX_TAG_LENGTH) {
          errors.push(`Tag at index ${idx} exceeds maximum length of ${MAX_TAG_LENGTH} characters`);
        } else {
          normalizedTags.push(tag.trim());
        }
      });
      if (errors.length === 0 || !normalizedTags.some(t => t.length === 0)) {
        normalized.tags = normalizedTags;
      }
    }
  }

  // Validate notes
  if ("notes" in overlay && overlay.notes !== undefined) {
    const input = overlay.notes;

    if (typeof input === "string") {
      // Check length BEFORE normalization (critical: length check must come first)
      if (input.length > MAX_NOTES_LENGTH) {
        errors.push(`Notes exceeds maximum length of ${MAX_NOTES_LENGTH} characters`);
      } else {
        // Only normalize if under length limit
        const normalizedNotes = normalizeNotesForValidation(input);
        if (normalizedNotes !== undefined) {
          normalized.notes = normalizedNotes;
        }
      }
    } else if (input === null || input === "") {
      normalized.notes = undefined;
    } else {
      errors.push("Notes must be a string or null");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    normalized,
  };
}

/**
 * Project-scoped validation: ensure metadata update belongs to the project
 */
export function validateProjectScope(
  artifactId: string,
  projectId: string,
  requestedProjectId?: string
): { valid: boolean; error?: string } {
  // If no explicit project ID provided, use default scope
  if (!requestedProjectId) {
    return { valid: true };
  }

  // Verify project match
  if (requestedProjectId !== projectId) {
    return {
      valid: false,
      error: `Artifact ${artifactId} belongs to project ${projectId}, but update request specifies project ${requestedProjectId}`,
    };
  }

  return { valid: true };
}

/**
 * Clamp values to bounds
 */
export function clampName(name: string): string {
  return name.slice(0, MAX_NAME_LENGTH).trim();
}

export function clampNotes(notes: string | null): string | undefined {
  if (!notes) return undefined;
  return notes.slice(0, MAX_NOTES_LENGTH).trim();
}

export function normalizeNotesForValidation(notes: string | null | undefined): string | undefined {
  /**
   * Normalize notes for validation:
   * - null -> undefined
   * - "" (empty string) -> undefined
   * - valid string -> trimmed string
   * - undefined -> undefined
   */
  if (notes === null || notes === "") return undefined;
  if (typeof notes !== "string") return undefined;
  return notes.trim();
}

export function clampTags(tags: string[]): string[] {
  return tags
    .slice(0, MAX_TAGS_COUNT)
    .filter((t) => typeof t === "string" && t.trim().length > 0)
    .map((t) => t.trim().slice(0, MAX_TAG_LENGTH));
}

/**
 * Create a valid metadata overlay from partial input
 */
export function createValidOverlay(
  input: Partial<MetadataOverlay>,
  artifactId: string
): Partial<MetadataOverlay> {
  const result: Partial<MetadataOverlay> = {};

  if ("name" in input && input.name !== undefined) {
    result.name = clampName(input.name);
  }

  if ("tags" in input && input.tags !== undefined) {
    result.tags = clampTags(input.tags);
  }

  if ("notes" in input && input.notes !== undefined) {
    result.notes = normalizeNotesForValidation(input.notes);
  }

  result.updatedAt = Date.now();

  return { ...result, artifactId };
}
