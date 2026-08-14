import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CHROMIUM_DATA_DIR_NAME,
  CHROMIUM_OWNED_ENTRIES,
  ensureChromiumDataDir,
} from "./chromium-data-dir";

const roots: string[] = [];
afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

function makeUserDataRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-chromium-dir-"));
  roots.push(root);
  return root;
}

describe("ensureChromiumDataDir", () => {
  it("claims app-managed roots are never part of the migration manifest", () => {
    const appManagedRoots = [
      "projects",
      "media",
      "assets",
      "skills",
      "python",
      "TTS",
      "DeepModel",
      "logs",
      "self-media",
      "hyperframes-profile",
      "remotion-runtime",
      "remotion-studio",
      "storage-config.json",
      "exports",
    ];
    expect(CHROMIUM_OWNED_ENTRIES).not.toContain(CHROMIUM_DATA_DIR_NAME);
    for (const name of appManagedRoots) {
      expect(CHROMIUM_OWNED_ENTRIES, `manifest must not claim app-managed entry: ${name}`).not.toContain(name);
    }
  });

  it("initializes the Chromium root on a fresh install without touching app data", () => {
    const root = makeUserDataRoot();
    fs.mkdirSync(path.join(root, "projects"), { recursive: true });

    const result = ensureChromiumDataDir({ userDataPath: root });

    expect(result).toBe(path.join(root, CHROMIUM_DATA_DIR_NAME));
    expect(fs.existsSync(path.join(root, CHROMIUM_DATA_DIR_NAME, ".mystudio-chromium-root"))).toBe(true);
    expect(fs.existsSync(path.join(root, "projects"))).toBe(true);
  });

  it("moves every Chromium-owned entry and leaves app-managed data in place", () => {
    const root = makeUserDataRoot();
    for (const name of ["Cache", "Code Cache", "GPUCache", "Local Storage", "IndexedDB", "File System"]) {
      fs.mkdirSync(path.join(root, name), { recursive: true });
    }
    for (const name of ["Cookies", "Cookies-journal", "Local State", "Preferences", "Trust Tokens-journal", "DIPS-wal"]) {
      fs.writeFileSync(path.join(root, name), "state");
    }
    fs.mkdirSync(path.join(root, "projects", "chapter-001"), { recursive: true });
    fs.writeFileSync(path.join(root, "storage-config.json"), "{}");

    const result = ensureChromiumDataDir({ userDataPath: root });
    const chromiumRoot = path.join(root, CHROMIUM_DATA_DIR_NAME);

    expect(result).toBe(chromiumRoot);
    for (const name of ["Cache", "Code Cache", "GPUCache", "Local Storage", "IndexedDB", "File System"]) {
      expect(fs.existsSync(path.join(root, name)), `${name} must leave the legacy root`).toBe(false);
      expect(fs.existsSync(path.join(chromiumRoot, name)), `${name} must land under Chromium/`).toBe(true);
    }
    for (const name of ["Cookies", "Cookies-journal", "Local State", "Preferences", "Trust Tokens-journal", "DIPS-wal"]) {
      expect(fs.existsSync(path.join(chromiumRoot, name))).toBe(true);
    }
    expect(fs.existsSync(path.join(root, "projects", "chapter-001"))).toBe(true);
    expect(fs.existsSync(path.join(root, "storage-config.json"))).toBe(true);
    expect(fs.existsSync(path.join(chromiumRoot, ".mystudio-chromium-root"))).toBe(true);
  });

  it("removes stale singleton markers from the legacy root", () => {
    const root = makeUserDataRoot();
    fs.writeFileSync(path.join(root, "DevToolsActivePort"), "9222\n");
    fs.writeFileSync(path.join(root, "SingletonLock"), "stale");

    ensureChromiumDataDir({ userDataPath: root });

    expect(fs.existsSync(path.join(root, "DevToolsActivePort"))).toBe(false);
    expect(fs.existsSync(path.join(root, "SingletonLock"))).toBe(false);
  });

  it("is idempotent — the second run is a no-op after the marker exists", () => {
    const root = makeUserDataRoot();
    fs.mkdirSync(path.join(root, "Cache"), { recursive: true });

    const first = ensureChromiumDataDir({ userDataPath: root });
    expect(first).toBe(path.join(root, CHROMIUM_DATA_DIR_NAME));
    expect(fs.existsSync(path.join(root, "Cache"))).toBe(false);

    // Reintroduce a stray Chromium entry at the root: with the marker present the
    // migration must NOT run again, so the stray stays where it is.
    fs.mkdirSync(path.join(root, "Code Cache"), { recursive: true });
    const second = ensureChromiumDataDir({ userDataPath: root });
    expect(second).toBe(first);
    expect(fs.existsSync(path.join(root, "Code Cache"))).toBe(true);
  });

  it("resumes safely after a partial migration (target entry already exists)", () => {
    const root = makeUserDataRoot();
    const chromiumRoot = path.join(root, CHROMIUM_DATA_DIR_NAME);
    fs.mkdirSync(path.join(root, "Cache"), { recursive: true });
    fs.mkdirSync(path.join(root, "Local Storage"), { recursive: true });
    // Simulate a crash after "Cache" was moved but before the marker was written.
    fs.mkdirSync(chromiumRoot, { recursive: true });
    fs.renameSync(path.join(root, "Cache"), path.join(chromiumRoot, "Cache"));

    const result = ensureChromiumDataDir({ userDataPath: root });

    expect(result).toBe(chromiumRoot);
    expect(fs.existsSync(path.join(chromiumRoot, "Cache"))).toBe(true);
    expect(fs.existsSync(path.join(chromiumRoot, "Local Storage"))).toBe(true);
    expect(fs.existsSync(path.join(root, "Local Storage"))).toBe(false);
  });

  it("rolls back moved entries and returns null when a rename fails", () => {
    const root = makeUserDataRoot();
    fs.mkdirSync(path.join(root, "Cache"), { recursive: true });
    fs.mkdirSync(path.join(root, "IndexedDB"), { recursive: true });
    const failingRename = ((from: string, to: string) => {
      if (from.endsWith("IndexedDB")) throw new Error("EPERM: rename failed");
      return fs.renameSync(from, to);
    }) as typeof fs.renameSync;

    const result = ensureChromiumDataDir({ userDataPath: root, fileOps: { renameSync: failingRename } });

    expect(result).toBeNull();
    expect(fs.existsSync(path.join(root, "Cache")), "rolled-back entry must return to the legacy root").toBe(true);
    expect(fs.existsSync(path.join(root, CHROMIUM_DATA_DIR_NAME, "Cache"))).toBe(false);
    expect(fs.existsSync(path.join(root, "IndexedDB"))).toBe(true);
    expect(fs.existsSync(path.join(root, CHROMIUM_DATA_DIR_NAME, ".mystudio-chromium-root"))).toBe(false);
  });
});
