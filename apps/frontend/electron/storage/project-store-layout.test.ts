import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureProjectStoreLayout,
  MOVABLE_STORE_SEGMENTS,
  resolveStoreFilePath,
  storeLayoutBase,
} from "./project-store-layout";

let root: string;

function makeProjectRoot(files: string[] = [], dirs: string[] = []) {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-store-layout-"));
  for (const file of files) fs.writeFileSync(path.join(root, file), "{}", "utf-8");
  for (const dir of dirs) fs.mkdirSync(path.join(root, dir), { recursive: true });
  return root;
}

beforeEach(() => {
  root = "";
});

afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe("ensureProjectStoreLayout", () => {
  it("moves whitelisted store files and the workflow shard dir into store/", () => {
    makeProjectRoot(
      ["script.json", "director.json", "tts.json", "novel-chapters.md", "unrelated.json"],
      ["studio-workflow", "novel", "exports"],
    );
    fs.writeFileSync(path.join(root, "studio-workflow", "manifest.json"), "{}");

    ensureProjectStoreLayout(root);

    expect(fs.existsSync(path.join(root, "store", "script.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, "store", "director.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, "store", "tts.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, "store", "studio-workflow", "manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, "store", "_store-layout-v1.json"))).toBe(true);
    // 旧位置不再有 store 文件
    expect(fs.existsSync(path.join(root, "script.json"))).toBe(false);
    expect(fs.existsSync(path.join(root, "studio-workflow"))).toBe(false);
    // 非 store 内容不动
    expect(fs.existsSync(path.join(root, "novel-chapters.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, "unrelated.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, "novel"))).toBe(true);
    expect(fs.existsSync(path.join(root, "exports"))).toBe(true);
  });

  it("is idempotent: second run does nothing and keeps .bak-* untouched", () => {
    makeProjectRoot(["script.json", "studio-workflow-store.json.bak-sharded-1"]);
    ensureProjectStoreLayout(root);
    const marker = path.join(root, "store", "_store-layout-v1.json");
    const markerStat = fs.statSync(marker);

    ensureProjectStoreLayout(root);

    expect(fs.statSync(marker).mtimeMs).toBe(markerStat.mtimeMs);
    expect(fs.readdirSync(root)).toContain("studio-workflow-store.json.bak-sharded-1");
    // 不会被再次搬迁
    expect(fs.existsSync(path.join(root, "store", "studio-workflow-store.json.bak-sharded-1"))).toBe(false);
  });

  it("skips silently when the project root does not exist (no dir side effects)", () => {
    expect(() => ensureProjectStoreLayout(path.join(os.tmpdir(), "mystudio-no-such-root-xyz"))).not.toThrow();
    expect(fs.existsSync(path.join(os.tmpdir(), "mystudio-no-such-root-xyz"))).toBe(false);
  });

  it("keeps conflict targets and quarantines the old file", () => {
    makeProjectRoot(["script.json"]);
    fs.mkdirSync(path.join(root, "store"), { recursive: true });
    fs.writeFileSync(path.join(root, "store", "script.json"), '{"new":1}', "utf-8");

    ensureProjectStoreLayout(root);

    expect(fs.readFileSync(path.join(root, "store", "script.json"), "utf-8")).toBe('{"new":1}');
    const leftovers = fs.readdirSync(root).filter((name) => name.startsWith("script.json.bak-layout-conflict"));
    expect(leftovers.length).toBe(1);
  });

  it("whitelists exactly the known store segments", () => {
    expect(MOVABLE_STORE_SEGMENTS).toContain("studio-workflow");
    expect(MOVABLE_STORE_SEGMENTS).toContain("studio-workflow-store");
    expect(MOVABLE_STORE_SEGMENTS).not.toContain("novel");
    expect(MOVABLE_STORE_SEGMENTS).not.toContain("source-memory");
  });
});

describe("storeLayoutBase / resolveStoreFilePath", () => {
  it("prefers store/ once it exists (read new, fallback old)", () => {
    makeProjectRoot([]);
    expect(storeLayoutBase(root)).toBe(root);
    expect(resolveStoreFilePath(root, "script.json")).toBe(path.join(root, "script.json"));

    fs.mkdirSync(path.join(root, "store"));
    expect(storeLayoutBase(root)).toBe(path.join(root, "store"));
    // 文件两边都不存在 → 旧位置（读探测语义，不凭空指向新位置）
    expect(resolveStoreFilePath(root, "script.json")).toBe(path.join(root, "script.json"));
    // 只在旧位置 → 旧路径;进了 store/ → 新路径
    fs.writeFileSync(path.join(root, "director.json"), "{}");
    expect(resolveStoreFilePath(root, "director.json")).toBe(path.join(root, "director.json"));
    fs.writeFileSync(path.join(root, "store", "director.json"), "{}");
    expect(resolveStoreFilePath(root, "director.json")).toBe(path.join(root, "store", "director.json"));
  });
});
