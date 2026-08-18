import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createBlessedPathRegistry, isPathInsideAnyRoot } from "./managed-paths";

describe("isPathInsideAnyRoot", () => {
  it("accepts a target inside one of the roots", () => {
    const root = path.resolve("/tmp/root-a");
    expect(isPathInsideAnyRoot([root], path.join(root, "sub", "file.png"))).toBe(true);
  });

  it("rejects a target outside every root", () => {
    const root = path.resolve("/tmp/root-a");
    expect(isPathInsideAnyRoot([root], path.resolve("/tmp/root-b/file.png"))).toBe(false);
  });

  it("rejects lexical-prefix escapes", () => {
    const root = path.resolve("/tmp/root-a");
    expect(isPathInsideAnyRoot([root], path.resolve("/tmp/root-abc/file.png"))).toBe(false);
  });

  it("rejects symlink escapes via realpath resolution", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "managed-paths-"));
    try {
      const inside = path.join(dir, "inside");
      const outside = path.join(dir, "outside");
      fs.mkdirSync(inside);
      fs.mkdirSync(outside);
      fs.symlinkSync(outside, path.join(inside, "link"));
      expect(isPathInsideAnyRoot([inside], path.join(inside, "link", "secret"))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns false when a root does not exist", () => {
    expect(isPathInsideAnyRoot([path.resolve("/tmp/definitely-missing-root")], path.resolve("/tmp/whatever"))).toBe(false);
  });
});

describe("createBlessedPathRegistry", () => {
  it("blesses and expires paths after the ttl", () => {
    let clock = 1_000;
    const registry = createBlessedPathRegistry({ ttlMs: 1_000, now: () => clock });
    registry.bless(["/Users/x/pick.png"]);
    expect(registry.has("/Users/x/pick.png")).toBe(true);
    clock += 1_001;
    expect(registry.has("/Users/x/pick.png")).toBe(false);
  });

  it("evicts the oldest entries beyond maxEntries", () => {
    let clock = 1_000;
    const registry = createBlessedPathRegistry({ ttlMs: 60_000, maxEntries: 2, now: () => clock });
    registry.bless(["/a.png"]);
    clock += 1;
    registry.bless(["/b.png"]);
    clock += 1;
    registry.bless(["/c.png"]);
    expect(registry.has("/a.png")).toBe(false);
    expect(registry.has("/b.png")).toBe(true);
    expect(registry.has("/c.png")).toBe(true);
  });

  it("ignores empty values", () => {
    const registry = createBlessedPathRegistry();
    registry.bless(["", "   "]);
    expect(registry.has("")).toBe(false);
  });
});
