import { describe, expect, it } from "vitest";
import { createPartiallyDeletedBundle, createTestBundle } from "../fixtures/deletion-plans";

describe("deletion transaction fixtures", () => {
  it("keeps the fixture chapters contiguous before a transaction", () => {
    const bundle = createTestBundle();
    expect(bundle.chapters.map((chapter) => chapter.id)).toEqual(["chapter-001", "chapter-002", "chapter-003"]);
  });

  it("represents deleted and retained chapters explicitly", () => {
    const bundle = createPartiallyDeletedBundle();
    expect(bundle.chapters.filter((chapter) => chapter.deleted)).toHaveLength(2);
    expect(bundle.chapters.filter((chapter) => !chapter.deleted)).toHaveLength(2);
  });

  it("does not mutate a captured journal snapshot", () => {
    const snapshot = createTestBundle();
    const journal = structuredClone(snapshot);
    journal.chapters.shift();
    expect(snapshot.chapters).toHaveLength(3);
    expect(journal.chapters).toHaveLength(2);
  });
});
