import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addAsset,
  batchMatchAssets,
  buildAssetWhere,
  getAsset,
  getAssetByName,
  importFromToonflow,
  initAssetsStorage,
  listAssets,
  replaceAssetMainImage,
  resolveAssetManagedPath,
  shouldCreateAssetThumbnail,
} from "./studio-assets-storage";

let tempAssetRoot: string | undefined;

function initTempAssetsStorage() {
  tempAssetRoot = mkdtempSync(join(tmpdir(), "mystudio-assets-test-"));
  initAssetsStorage(tempAssetRoot);
}

afterEach(() => {
  if (tempAssetRoot) {
    rmSync(tempAssetRoot, { recursive: true, force: true });
    tempAssetRoot = undefined;
  }
});

describe("buildAssetWhere", () => {
  it("只按类型过滤", () => {
    expect(buildAssetWhere("tool")).toBe("WHERE type='tool'");
  });

  it("按类型 + 分类标签过滤", () => {
    expect(buildAssetWhere("tool", undefined, "法宝")).toBe(`WHERE type='tool' AND tags LIKE '%"法宝"%'`);
  });

  it("分类标签带闭合引号，避免 丹药 误匹配 丹药配方", () => {
    const where = buildAssetWhere("tool", undefined, "丹药");
    // 模式必须是 "丹药"（含闭合引号），这样 ["丹药配方"] 不会被命中
    expect(where).toContain(`tags LIKE '%"丹药"%'`);
    const pattern = `"丹药"`;
    expect(`["丹药","人间界"]`.includes(pattern)).toBe(true);   // 丹药命中
    expect(`["丹药配方","人间界"]`.includes(pattern)).toBe(false); // 丹药配方不被误命中
  });

  it("同时按搜索 + 分类过滤", () => {
    const where = buildAssetWhere("tool", "剑", "法宝");
    expect(where).toBe(`WHERE type='tool' AND (name LIKE '%剑%' ESCAPE '\\' OR prompt LIKE '%剑%' ESCAPE '\\') AND tags LIKE '%"法宝"%'`);
  });

  it("转义单引号防注入", () => {
    expect(buildAssetWhere("tool", "a'b")).toContain("a''b");
  });
});

describe("asset file safety", () => {
  it("does not generate image thumbnails for audio assets", () => {
    expect(shouldCreateAssetThumbnail("audio")).toBe(false);
    expect(shouldCreateAssetThumbnail("role")).toBe(true);
  });

  it("rejects asset file paths that escape the managed asset root", () => {
    expect(() => resolveAssetManagedPath("/assets/files", "../outside.png")).toThrow("escapes");
    expect(resolveAssetManagedPath("/assets/files", "audio/voice.wav")).toBe("/assets/files/audio/voice.wav");
  });

  it("does not expose escaped database file paths as asset preview URLs", async () => {
    initTempAssetsStorage();
    const source = join(tempAssetRoot!, "source.png");
    writeFileSync(source, "image");
    const asset = addAsset({
      type: "role",
      name: "坏路径角色",
      sourceFilePath: source,
    });
    execFileSync("python3", [
      "-c",
      [
        "import sqlite3, sys, json",
        "conn = sqlite3.connect(sys.argv[1])",
        "conn.execute('UPDATE assets SET filePath=?, images=? WHERE id=?', ('../outside.png', json.dumps([{'name':'bad','filePath':'../outside-detail.png'}]), sys.argv[2]))",
        "conn.commit()",
        "conn.close()",
      ].join("; "),
      join(tempAssetRoot!, "assets", "assets.db"),
      asset.id,
    ]);

    const listed = await listAssets("role", "坏路径角色");
    expect(listed.items[0]?.previewUrl).toBeUndefined();
    expect(listed.items[0]?.sourcePath).toBeUndefined();

    const detail = await getAsset(asset.id);
    expect(detail?.previewUrl).toBeUndefined();
    expect(detail?.sourcePath).toBeUndefined();
    expect(detail?.images).toEqual([]);
  });

  it("retries replacing the main image while the asset database is briefly locked", async () => {
    initTempAssetsStorage();
    const firstSource = join(tempAssetRoot!, "old.png");
    const nextSource = join(tempAssetRoot!, "next.png");
    writeFileSync(firstSource, "old image");
    writeFileSync(nextSource, "next image");
    const asset = addAsset({
      type: "role",
      name: "锁测试角色",
      sourceFilePath: firstSource,
    });
    expect(asset.sourcePath).toBeTruthy();
    const oldStoredPath = asset.sourcePath!;

    const lockProcess = spawn("python3", [
      "-c",
      [
        "import sqlite3, sys, time",
        "conn = sqlite3.connect(sys.argv[1], timeout=5)",
        "conn.execute('BEGIN EXCLUSIVE')",
        "conn.execute('UPDATE assets SET updatedAt=updatedAt WHERE id=?', (sys.argv[2],))",
        "print('READY', flush=True)",
        "time.sleep(0.6)",
        "conn.commit()",
        "conn.close()",
      ].join("; "),
      join(tempAssetRoot!, "assets", "assets.db"),
      asset.id,
    ]);
    await waitForProcessOutput(lockProcess, "READY");

    const lockExit = waitForProcessExit(lockProcess);
    const updated = replaceAssetMainImage(asset.id, nextSource);
    const exitCode = await lockExit;

    expect(exitCode).toBe(0);
    expect(updated?.filePath).toBeTruthy();
    expect(updated?.sourcePath).toBeTruthy();
    expect(updated?.sourcePath).not.toBe(oldStoredPath);
    expect(existsSync(updated!.sourcePath!)).toBe(true);
    expect(existsSync(oldStoredPath)).toBe(false);
  });
});

function waitForProcessOutput(proc: ReturnType<typeof spawn>, text: string) {
  return new Promise<void>((resolve, reject) => {
    if (!proc.stdout || !proc.stderr) {
      reject(new Error("Process stdio is unavailable"));
      return;
    }
    let output = "";
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${text}. Output: ${output}`));
    }, 3000);
    proc.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.includes(text)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    proc.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    proc.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    proc.on("exit", (code) => {
      if (!output.includes(text)) {
        clearTimeout(timeout);
        reject(new Error(`Process exited before ${text}; code=${code}; output=${output}`));
      }
    });
  });
}

function waitForProcessExit(proc: ReturnType<typeof spawn>) {
  return new Promise<number | null>((resolve, reject) => {
    proc.on("error", reject);
    proc.on("exit", resolve);
  });
}

describe("asset alias matching", () => {
  it("matches assets by semicolon-separated secondary names", async () => {
    initTempAssetsStorage();
    const asset = addAsset({
      type: "tool",
      name: "铜钱;铜币;古钱",
      description: "圆形方孔钱",
    });

    await expect(getAssetByName("tool", "铜币")).resolves.toMatchObject({
      id: asset.id,
      name: "铜钱;铜币;古钱",
    });

    const matches = await batchMatchAssets("tool", ["古钱", "铜"]);

    expect(matches.get("古钱")?.id).toBe(asset.id);
    expect(matches.has("铜")).toBe(false);
  });

  it("prefers a populated alias match over an empty exact duplicate", async () => {
    initTempAssetsStorage();
    addAsset({
      type: "tool",
      name: "绿锈铜钱",
      description: "",
    });
    const sourceFile = join(tempAssetRoot!, "coin.png");
    writeFileSync(sourceFile, "fake image");
    const populated = addAsset({
      type: "tool",
      name: "铜钱;绿锈铜钱",
      description: "圆形方孔钱",
      prompt: "铜钱资源图",
      sourceFilePath: sourceFile,
    });

    const matches = await batchMatchAssets("tool", ["绿锈铜钱"]);

    expect(matches.get("绿锈铜钱")?.id).toBe(populated.id);
    expect(matches.get("绿锈铜钱")?.filePath).toBeTruthy();
  });

  it("does not treat an empty name-only shell row as an existing asset", async () => {
    initTempAssetsStorage();
    const shell = addAsset({
      type: "tool",
      name: "灵矿账册",
    });

    await expect(getAssetByName("tool", "灵矿账册")).resolves.toBeNull();
    await expect(getAsset(shell.id)).resolves.toMatchObject({
      id: shell.id,
      name: "灵矿账册",
    });

    const assets = await listAssets("tool", "灵矿账册", 0, 10);
    expect(assets.items).toHaveLength(0);
    expect(assets.total).toBe(0);

    const matches = await batchMatchAssets("tool", ["灵矿账册"]);

    expect(matches.has("灵矿账册")).toBe(false);
  });

  it("backfills missing fields for an exact Toonflow asset instead of skipping it", async () => {
    initTempAssetsStorage();
    const existing = addAsset({
      type: "tool",
      name: "铜钱",
    });
    const sourceFile = join(tempAssetRoot!, "toonflow-coin.png");
    writeFileSync(sourceFile, "fake image");

    const changed = importFromToonflow([{
      id: "toonflow-db:304",
      source: "toonflow-runtime",
      type: "tool",
      name: "铜钱",
      description: "凡间流通的货币",
      prompt: "# 铜钱\n- 类别：货币",
      setting: "货币/凡品",
      remark: "货币/凡品",
      tags: ["货币"],
      sourcePath: sourceFile,
    }]);

    expect(changed).toBe(1);
    await expect(getAsset(existing.id)).resolves.toMatchObject({
      id: existing.id,
      description: "凡间流通的货币",
      prompt: "# 铜钱\n- 类别：货币",
      setting: "货币/凡品",
      remark: "货币/凡品",
      tags: ["货币"],
    });
    const updated = await getAsset(existing.id);
    expect(updated?.filePath).toMatch(/^tool\//);
    expect(updated?.sourcePath).toBeTruthy();

    const assets = await listAssets("tool", "铜钱", 0, 10);
    expect(assets.items.filter((item) => item.name === "铜钱")).toHaveLength(1);
  });

  it("backfills an exact empty local asset shell instead of creating a duplicate", async () => {
    initTempAssetsStorage();
    const existing = addAsset({
      type: "tool",
      name: "灵矿藤筐",
    });
    const sourceFile = join(tempAssetRoot!, "basket.png");
    writeFileSync(sourceFile, "fake image");

    const updated = addAsset({
      type: "tool",
      name: "灵矿藤筐",
      description: "矿场藤筐",
      prompt: "水墨国风道具设定图",
      setting: "采矿道具",
      sourceFilePath: sourceFile,
    });

    expect(updated.id).toBe(existing.id);
    await expect(getAsset(existing.id)).resolves.toMatchObject({
      id: existing.id,
      description: "矿场藤筐",
      prompt: "水墨国风道具设定图",
      setting: "采矿道具",
    });
    const refreshed = await getAsset(existing.id);
    expect(refreshed?.filePath).toMatch(/^tool\//);
    expect(refreshed?.sourcePath).toBeTruthy();

    const assets = await listAssets("tool", "灵矿藤筐", 0, 10);
    expect(assets.items.filter((item) => item.name === "灵矿藤筐")).toHaveLength(1);
  });
});
