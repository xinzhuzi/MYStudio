// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-larger. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, test, expect } from "vitest";
import { validateMetadataOverlay, createValidOverlay, clampName, clampNotes, clampTags, MAX_NAME_LENGTH, MAX_NOTES_LENGTH, MAX_TAGS_COUNT, MAX_TAG_LENGTH } from "./artifact-metadata";

describe("artifact-metadata", () => {
  describe("validateMetadataOverlay", () => {
    test("accepts valid minimal metadata", () => {
      const result = validateMetadataOverlay({});
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("rejects empty name", () => {
      const result = validateMetadataOverlay({ name: "" });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("empty"))).toBe(true);
    });

    test("rejects name exceeding max length", () => {
      const longName = "a".repeat(MAX_NAME_LENGTH + 1);
      const result = validateMetadataOverlay({ name: longName });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("exceeds maximum"))).toBe(true);
    });

    test("accepts name at max length", () => {
      const maxName = "a".repeat(MAX_NAME_LENGTH);
      const result = validateMetadataOverlay({ name: maxName });
      expect(result.valid).toBe(true);
      expect(result.normalized.name).toBe(maxName);
    });

    test("rejects empty tags", () => {
      const result = validateMetadataOverlay({ tags: ["", "valid"] });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("empty"))).toBe(true);
    });

    test("rejects tag count exceeding limit", () => {
      const tags = Array.from({ length: MAX_TAGS_COUNT + 1 }, (_, i) => `tag${i}`);
      const result = validateMetadataOverlay({ tags });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("exceed maximum count"))).toBe(true);
    });

    test("rejects tag exceeding max length", () => {
      const longTag = "a".repeat(MAX_TAG_LENGTH + 1);
      const result = validateMetadataOverlay({ tags: [longTag] });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("exceeds maximum length"))).toBe(true);
    });

    test("accepts notes at max length", () => {
      const maxNotes = "x".repeat(MAX_NOTES_LENGTH);
      const result = validateMetadataOverlay({ notes: maxNotes });
      expect(result.valid).toBe(true);
      expect(result.normalized.notes).toBe(maxNotes);
    });

    test("rejects notes exceeding max length", () => {
      const longNotes = "x".repeat(MAX_NOTES_LENGTH + 1);
      const result = validateMetadataOverlay({ notes: longNotes });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes("exceeds maximum length"))).toBe(true);
    });

    test("normalizes whitespace", () => {
      const result = validateMetadataOverlay({ name: "  trimmed  ", notes: "  spaced  " });
      expect(result.valid).toBe(true);
      expect(result.normalized.name).toBe("trimmed");
      expect(result.normalized.notes).toBe("spaced");
    });
  });

  describe("clamp functions", () => {
    test("clamps name to MAX_NAME_LENGTH", () => {
      const longName = "a".repeat(MAX_NAME_LENGTH + 100);
      const clamped = clampName(longName);
      expect(clamped.length).toBe(MAX_NAME_LENGTH);
      expect(clamped).toBe("a".repeat(MAX_NAME_LENGTH));
    });

    test("clamps notes to MAX_NOTES_LENGTH", () => {
      const longNotes = "x".repeat(MAX_NOTES_LENGTH + 100);
      const clamped = clampNotes(longNotes);
      expect(clamped?.length).toBe(MAX_NOTES_LENGTH);
    });

    test("clamps tags array size", () => {
      const tags = Array.from({ length: 100 }, (_, i) => `tag${i}`);
      const clamped = clampTags(tags);
      expect(clamped.length).toBe(MAX_TAGS_COUNT);
    });

    test("clamps individual tag length", () => {
      const longTag = "t".repeat(MAX_TAG_LENGTH + 100);
      const clamped = clampTags([longTag]);
      expect(clamped[0].length).toBe(MAX_TAG_LENGTH);
    });

    test("filters invalid tags", () => {
      const mixedTags = ["valid", "", "  ", 123 as any, null as any];
      const clamped = clampTags(mixedTags);
      expect(clamped).toEqual(["valid"]);
    });
  });

  describe("createValidOverlay", () => {
    test("creates normalized overlay with timestamp", () => {
      const input = { name: "Test Name", tags: ["tag1", "tag2"], notes: "Some notes" };
      const overlay = createValidOverlay(input, "artifact-123");

      expect(overlay.artifactId).toBe("artifact-123");
      expect(overlay.name).toBe("Test Name");
      expect(overlay.tags).toEqual(["tag1", "tag2"]);
      expect(overlay.notes).toBe("Some notes");
      expect(overlay.updatedAt).toBeDefined();
    });

    test("handles partial updates", () => {
      const input = { name: "Updated Name" };
      const overlay = createValidOverlay(input, "artifact-123");

      expect(overlay.name).toBe("Updated Name");
      expect(overlay.tags).toBeUndefined();
      expect(overlay.notes).toBeUndefined();
      expect(overlay.updatedAt).toBeDefined();
    });

    test("applies bounds even on creation", () => {
      const longName = "a".repeat(1000);
      const input = { name: longName };
      const overlay = createValidOverlay(input, "artifact-123");

      expect(overlay.name?.length).toBe(MAX_NAME_LENGTH);
    });
  });
});
