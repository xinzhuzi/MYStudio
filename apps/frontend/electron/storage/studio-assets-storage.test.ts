import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  addAsset,
  addAssetImage,
  batchMatchAssets,
  buildAssetWhere,
  deleteAsset,
  getAsset,
  getAssetByName,
  importFromToonflow,
  initAssetsStorage,
  listAssets,
  removeAssetImage,
  replaceAssetMainImage,
  resolveAssetManagedPath,
  shouldCreateAssetThumbnail,
  updateAsset,
} from "./studio-assets-storage";
import { getDbPath, getFilesDir, resolveSqliteCli, runSqliteJsonSync } from "./assets-sqlite";
import { getAssetSync } from "./assets-queries";

let tempAssetRoot: string | undefined;

function initTempAssetsStorage() {
  tempAssetRoot = mkdtempSync(join(tmpdir(), "mystudio-assets-test-"));
  initAssetsStorage(tempAssetRoot);
}

afterEach(() => {
  if (tempAssetRoot) {
    // 10-25 门禁红修复:缩略图 sips 子进程是 fire-and-forget(assets-sqlite.ts
    // enqueueThumb / studio-assets-storage.ts promoteMainIfDeleted),断言完成后
    // 仍会向临时目录回填缩略图文件,rmSync 递归删撞上并发写入即抛 ENOTEMPTY。
    // Node 对 ENOTEMPTY 有内置 maxRetries 线性退避(本机 Node 26 实测可扛住
    // 持续回填的写入方),加重试参数即可让清理等迟到的 sips 收尾。
    rmSync(tempAssetRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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

  it("rejects an audio asset whose source file no longer exists", async () => {
    initTempAssetsStorage();
    const missingSource = join(tempAssetRoot!, "missing.wav");

    expect(() => addAsset({
      type: "audio",
      name: "失效音频",
      sourceFilePath: missingSource,
    })).toThrow("音频文件不存在或无法读取");

    const assets = await listAssets("audio", "失效音频", 0, 10);
    expect(assets.items).toHaveLength(0);
    expect(assets.total).toBe(0);
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
      join(tempAssetRoot!, "assets.db"),
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
      join(tempAssetRoot!, "assets.db"),
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
    // 语义迁移(10-19 用户裁定「必须是并存」):旧主图收编 images[] 历史版本,文件保留不删
    expect(existsSync(oldStoredPath)).toBe(true);
    expect(updated?.images ?? []).toEqual(expect.arrayContaining([
      expect.objectContaining({ filePath: asset.filePath }),
    ]));
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

describe("资产名分夹落盘(R1:role/scene/tool 名夹层,clip/audio 平铺回归锁)", () => {
  it("addAsset(带图)落 files/<type>/<安全名>/ 名夹层", () => {
    initTempAssetsStorage();
    const source = join(tempAssetRoot!, "hero.png");
    writeFileSync(source, "fake image");
    const asset = addAsset({ type: "role", name: "晏燎", sourceFilePath: source });

    expect(asset.filePath).toMatch(/^role\/晏燎\/[0-9a-f-]{36}\.png$/);
    expect(existsSync(join(tempAssetRoot!, "files", "role", "晏燎", basename(asset.filePath!)))).toBe(true);
  });

  it("addAsset 非法字符名经 sanitizeAssetFolderName 落安全名夹", () => {
    initTempAssetsStorage();
    const source = join(tempAssetRoot!, "scene.png");
    writeFileSync(source, "fake image");
    const asset = addAsset({ type: "scene", name: 'a/b\\c:d*e?f"g<h>i|j', sourceFilePath: source });

    expect(asset.filePath).toMatch(/^scene\/a_b_c_d_e_f_g_h_i_j\/[0-9a-f-]{36}\.png$/);
    expect(existsSync(join(tempAssetRoot!, "files", "scene", "a_b_c_d_e_f_g_h_i_j", basename(asset.filePath!)))).toBe(true);
  });

  it("importFromToonflow 新行落 files/<type>/<安全名>/ 名夹层", async () => {
    initTempAssetsStorage();
    const sourceFile = join(tempAssetRoot!, "toonflow-new.png");
    writeFileSync(sourceFile, "fake image");

    const changed = importFromToonflow([{
      id: "toonflow-db:9527",
      source: "toonflow-runtime",
      type: "tool",
      name: "替死蛊",
      sourcePath: sourceFile,
    }]);

    expect(changed).toBe(1);
    const created = await getAssetByName("tool", "替死蛊");
    expect(created?.filePath).toMatch(/^tool\/替死蛊\/[0-9a-f-]{36}\.png$/);
    expect(existsSync(join(tempAssetRoot!, "files", "tool", "替死蛊", basename(created!.filePath!)))).toBe(true);
  });

  it("replaceAssetMainImage 落 files/<type>/<安全名>/ 且 thumbs 同构", () => {
    initTempAssetsStorage();
    const firstSource = join(tempAssetRoot!, "old.png");
    const nextSource = join(tempAssetRoot!, "next.png");
    writeFileSync(firstSource, "old image");
    writeFileSync(nextSource, "next image");
    const asset = addAsset({ type: "role", name: "晏燎", sourceFilePath: firstSource });

    // 1020 追令(10-19 命名裁定存储层绝根):换主图落盘名禁时间戳,缺省=资产名_中文日期
    const updated = replaceAssetMainImage(asset.id, nextSource);

    expect(updated?.filePath).toMatch(/^role\/晏燎\/晏燎_\d{4}年\d{2}月\d{2}日\.png$/);
    expect(existsSync(join(tempAssetRoot!, "files", "role", "晏燎", basename(updated!.filePath!)))).toBe(true);
    // thumbs 镜像同构:缩略图目录与 files 同相对路径(mkdirSync 同步在场;sips 内容生成不阻塞断言)
    expect(existsSync(join(tempAssetRoot!, "thumbs", "role", "晏燎"))).toBe(true);
  });

  it("replaceAssetMainImage 带 imageName 透传落盘(图生图=原图名_中文日期,10-19 裁定)", () => {
    initTempAssetsStorage();
    const src = join(tempAssetRoot!, "styled.png");
    const seed = join(tempAssetRoot!, "seed.png");
    writeFileSync(src, "styled");
    writeFileSync(seed, "seed");
    const asset = addAsset({ type: "role", name: "晏燎", sourceFilePath: seed });

    // 已含资产名前缀 → 原样落盘(禁双前缀,同 addAssetImage 契约)
    const updated = replaceAssetMainImage(asset.id, src, "晏燎_练气期_正视图_v1_2026年10月20日");
    expect(updated?.filePath).toBe("role/晏燎/晏燎_练气期_正视图_v1_2026年10月20日.png");

    // 不含前缀 → 自动拼资产名前缀
    const updated2 = replaceAssetMainImage(asset.id, src, "特写");
    expect(updated2?.filePath).toBe("role/晏燎/晏燎_特写.png");
  });

  it("replaceAssetMainImage 同名撞车数字后缀去重(禁时间戳回潮)", () => {
    initTempAssetsStorage();
    const src = join(tempAssetRoot!, "dup.png");
    const seed = join(tempAssetRoot!, "seed2.png");
    writeFileSync(src, "dup");
    writeFileSync(seed, "seed2");
    const asset = addAsset({ type: "role", name: "撞名回归", sourceFilePath: seed });

    const first = replaceAssetMainImage(asset.id, src, "撞名回归_定妆图");
    const second = replaceAssetMainImage(asset.id, src, "撞名回归_定妆图");

    expect(first?.filePath).toBe("role/撞名回归/撞名回归_定妆图.png");
    expect(second?.filePath).toBe("role/撞名回归/撞名回归_定妆图_2.png");
  });

  it("换主图=旧主图收编 images[] 作历史版本,永不物理删除(10-19 用户裁定:必须是并存)", () => {
    initTempAssetsStorage();
    const srcV1 = join(tempAssetRoot!, "coexist-v1.png");
    const srcV2 = join(tempAssetRoot!, "coexist-v2.png");
    const srcV3 = join(tempAssetRoot!, "coexist-v3.png");
    writeFileSync(srcV1, "v1");
    writeFileSync(srcV2, "v2");
    writeFileSync(srcV3, "v3");
    const asset = addAsset({ type: "role", name: "并存回归", sourceFilePath: srcV1 });
    const v1Path = asset.filePath ?? "";

    // 第一次换主图:v1 收编为历史版本(存档名=原文件名基,6dd91185 废「主图」名号裁定),
    // 文件仍在盘上
    const v1Base = basename(v1Path).replace(/\.[^.]+$/, "");
    const after1 = replaceAssetMainImage(asset.id, srcV2);
    expect(after1?.images ?? []).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: v1Base, filePath: v1Path }),
    ]));
    expect(existsSync(join(getFilesDir(), v1Path))).toBe(true);

    // 第二次换主图:v2 也收编,历史版本递增命名不撞名,新旧文件全在
    const v2Path = after1?.filePath ?? "";
    const v2Base = basename(v2Path).replace(/\.[^.]+$/, "");
    const after2 = replaceAssetMainImage(asset.id, srcV3);
    const names = (after2?.images ?? []).map((i) => i.name);
    expect(names).toContain(v1Base);
    expect(names).toContain(v2Base);
    expect(existsSync(join(getFilesDir(), v1Path))).toBe(true);
    expect(existsSync(join(getFilesDir(), v2Path))).toBe(true);
    expect((after2?.images ?? []).length).toBe(2);
  });

  it("旧主图已在 images[](导入型资产)→ 换主图不重复收编", () => {
    initTempAssetsStorage();
    const srcA = join(tempAssetRoot!, "already-a.png");
    const srcB = join(tempAssetRoot!, "already-b.png");
    writeFileSync(srcA, "a");
    writeFileSync(srcB, "b");
    const asset = addAsset({ type: "role", name: "导入型回归", sourceFilePath: srcA });
    // 真导入态:直写 db 把行级主图路径同步进 images[](同路径并存)
    execFileSync("python3", [
      "-c",
      "import sqlite3, sys; con=sqlite3.connect(sys.argv[1]); con.execute(\"UPDATE assets SET images=? WHERE id=?\", (sys.argv[2], sys.argv[3])); con.commit()",
      join(tempAssetRoot!, "assets.db"),
      JSON.stringify([{ name: "导入即列", filePath: asset.filePath }]),
      asset.id,
    ]);
    const after = replaceAssetMainImage(asset.id, srcB);
    const entriesForOld = (after?.images ?? []).filter((i) => i.filePath === asset.filePath);
    expect(entriesForOld.length).toBe(1);
  });

  it("addAssetImage 落 files/<type>/<安全名>/ 名夹层", () => {
    initTempAssetsStorage();
    const mainSource = join(tempAssetRoot!, "main.png");
    const detailSource = join(tempAssetRoot!, "detail.png");
    writeFileSync(mainSource, "main image");
    writeFileSync(detailSource, "detail image");
    const asset = addAsset({ type: "tool", name: "替死蛊", sourceFilePath: mainSource });

    const updated = addAssetImage(asset.id, "变异", detailSource);

    const image = updated?.images?.[0];
    expect(image?.filePath).toBe("tool/替死蛊/替死蛊_变异.png");
    expect(existsSync(join(tempAssetRoot!, "files", "tool", "替死蛊", "替死蛊_变异.png"))).toBe(true);
  });

  it("addAssetImage 图名已含资产名前缀时不重复拼接(禁双名前缀,10-19 用户令)", () => {
    initTempAssetsStorage();
    const mainSource = join(tempAssetRoot!, "main.png");
    const detailSource = join(tempAssetRoot!, "detail.png");
    writeFileSync(mainSource, "main image");
    writeFileSync(detailSource, "detail image");
    const asset = addAsset({ type: "role", name: "晏燎", sourceFilePath: mainSource });

    const prefixed = addAssetImage(asset.id, "晏燎_化神期_海报_v1", detailSource);
    expect(prefixed?.images?.[0]?.filePath).toBe("role/晏燎/晏燎_化神期_海报_v1.png");

    const bare = addAssetImage(asset.id, "共主期_三视图_v1", detailSource);
    expect(bare?.images?.[1]?.filePath).toBe("role/晏燎/晏燎_共主期_三视图_v1.png");
  });

  // 10-24 图片展示规范批2:kind 写路落值(PRD Round 2 A——kind 住 images[] JSON
  // 条目内,addImage IPC 增可选参;返回值经 rowToSummary 投影断言透传链一体成立)
  it("addAssetImage 带 kind 落 images[] 条目并经读投影透传", () => {
    initTempAssetsStorage();
    const mainSource = join(tempAssetRoot!, "main.png");
    const detailSource = join(tempAssetRoot!, "detail.png");
    writeFileSync(mainSource, "main image");
    writeFileSync(detailSource, "detail image");
    const asset = addAsset({ type: "role", name: "晏燎", sourceFilePath: mainSource });

    const updated = addAssetImage(asset.id, "晏燎_练气期_三视图_v1", detailSource, "人物多视图");
    const typed = updated?.images?.find((image) => image.filePath.includes("三视图"));
    expect(typed?.kind).toBe("人物多视图");

    // 盘上 JSON 真身断言(持久值住 images[] 条目内,非视图层临时态)
    const rows = runSqliteJsonSync<Array<{ images: string }>>(
      getDbPath(),
      `SELECT images FROM assets WHERE id='${asset.id}' LIMIT 1;`,
    );
    const stored = JSON.parse(rows[0].images) as Array<{ name: string; kind?: string }>;
    expect(stored.find((image) => image.name === "晏燎_练气期_三视图_v1")?.kind).toBe("人物多视图");
  });

  it("addAssetImage 缺省 kind 保持旧条目形态(零迁移成本)", () => {
    initTempAssetsStorage();
    const mainSource = join(tempAssetRoot!, "main.png");
    const detailSource = join(tempAssetRoot!, "detail.png");
    writeFileSync(mainSource, "main image");
    writeFileSync(detailSource, "detail image");
    const asset = addAsset({ type: "role", name: "晏燎", sourceFilePath: mainSource });

    const updated = addAssetImage(asset.id, "随手添加的旧图", detailSource);
    const entry = updated?.images?.[0];
    expect(entry?.name).toBe("随手添加的旧图");
    expect(entry?.kind).toBeUndefined();
  });

  it("clip/audio 落盘保持平铺无名夹层(回归锁)", () => {
    initTempAssetsStorage();
    const clipSource = join(tempAssetRoot!, "clip.mp4");
    const audioSource = join(tempAssetRoot!, "voice.wav");
    writeFileSync(clipSource, "fake clip");
    writeFileSync(audioSource, "fake wav");

    const clip = addAsset({ type: "clip", name: "过场片段", sourceFilePath: clipSource });
    expect(clip.filePath).toMatch(/^clip\/[^/]+\.mp4$/);
    expect(existsSync(join(tempAssetRoot!, "files", "clip", basename(clip.filePath!)))).toBe(true);

    const audio = addAsset({ type: "audio", name: "晏燎配音", sourceFilePath: audioSource });
    expect(audio.filePath).toMatch(/^audio\/[^/]+\.wav$/);
    expect(existsSync(join(tempAssetRoot!, "files", "audio", basename(audio.filePath!)))).toBe(true);
  });
});

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

  it("matches assets by comma-separated secondary names (中英文逗号/分号都认)", async () => {
    initTempAssetsStorage();
    const englishComma = addAsset({
      type: "role",
      name: "李先生,管事",
      description: "塾馆教书先生兼管事",
    });
    const chineseComma = addAsset({
      type: "role",
      name: "赵四，监工",
      description: "码头监工",
    });

    await expect(getAssetByName("role", "管事")).resolves.toMatchObject({ id: englishComma.id });
    await expect(getAssetByName("role", "监工")).resolves.toMatchObject({ id: chineseComma.id });

    const matches = await batchMatchAssets("role", ["李先生", "赵四", "教书先生"]);
    expect(matches.get("李先生")?.id).toBe(englishComma.id);
    expect(matches.get("赵四")?.id).toBe(chineseComma.id);
    expect(matches.has("教书先生")).toBe(false);
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
    expect(updated?.filePath).toMatch(/^tool\/铜钱\//);
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
    expect(refreshed?.filePath).toMatch(/^tool\/灵矿藤筐\//);
    expect(refreshed?.sourcePath).toBeTruthy();

    const assets = await listAssets("tool", "灵矿藤筐", 0, 10);
    expect(assets.items.filter((item) => item.name === "灵矿藤筐")).toHaveLength(1);
  });
});

describe("SQLite CLI resolution (Windows bundled sqlite3)", () => {
  it("prefers the bundled sqlite3.exe on packaged Windows", () => {
    const resources = "C:\\App\\resources";
    // path.join 在非 Windows 主机的单测环境使用 "/",故按 endsWith 断言,
    // 生产(win32 主进程)path.join 使用 "\",两种情形均指向 resources/sqlite3/sqlite3.exe。
    const exists = (p: string) => p.replace(/[\\/]/g, "/").endsWith("resources/sqlite3/sqlite3.exe");
    const resolved = resolveSqliteCli({ platform: "win32", resourcesPath: resources, fileExists: exists });
    expect(resolved).not.toBe("sqlite3");
    expect(resolved.replace(/[\\/]/g, "/")).toContain("resources/sqlite3/sqlite3.exe");
  });

  it("falls back to PATH sqlite3 when the bundled binary is missing", () => {
    expect(resolveSqliteCli({
      platform: "win32",
      resourcesPath: "C:\\App\\resources",
      fileExists: () => false,
    })).toBe("sqlite3");
  });

  // D4(10-30):fetch-sqlite3.mjs:26 实捆落位为 bin/win-x64 嵌套布局
  // (electron-builder.yml from:frontend/assets/sqlite3→to:sqlite3 平移),
  // 旧代码只探测 flat 布局,装机后资产库 ENOENT——两用例锁定 nested 候选。
  it("resolves the nested bin/win-x64 bundled sqlite3.exe when the flat layout is missing", () => {
    const resources = "C:\\App\\resources";
    // path.join 在非 Windows 主机的单测环境使用 "/",故按规范化后 endsWith 断言,
    // 生产(win32 主进程)path.join 使用 "\",两种情形均指向
    // resources/sqlite3/bin/win-x64/sqlite3.exe。
    const nested = "resources/sqlite3/bin/win-x64/sqlite3.exe";
    const exists = (p: string) => p.replace(/[\\/]/g, "/").endsWith(nested);
    const resolved = resolveSqliteCli({ platform: "win32", resourcesPath: resources, fileExists: exists });
    expect(resolved).not.toBe("sqlite3");
    expect(resolved.replace(/[\\/]/g, "/")).toContain(nested);
  });

  it("keeps the flat sqlite3/sqlite3.exe candidate first when both layouts are present", () => {
    const resources = "C:\\App\\resources";
    const flat = "resources/sqlite3/sqlite3.exe";
    const nested = "resources/sqlite3/bin/win-x64/sqlite3.exe";
    const exists = (p: string) => {
      const normalized = p.replace(/[\\/]/g, "/");
      return normalized.endsWith(flat) || normalized.endsWith(nested);
    };
    const resolved = resolveSqliteCli({ platform: "win32", resourcesPath: resources, fileExists: exists });
    expect(resolved).not.toBe("sqlite3");
    expect(resolved.replace(/[\\/]/g, "/")).toContain(flat);
    expect(resolved.replace(/[\\/]/g, "/")).not.toContain("bin/win-x64");
  });

  it("keeps using the system sqlite3 on non-Windows platforms", () => {
    expect(resolveSqliteCli({ platform: "linux", resourcesPath: "/opt/app/resources" })).toBe("sqlite3");
    expect(resolveSqliteCli({ platform: "darwin", resourcesPath: "/opt/app/resources" })).toBe("sqlite3");
  });

  it("uses PATH sqlite3 when resourcesPath is unavailable (dev/node)", () => {
    expect(resolveSqliteCli({ platform: "win32", resourcesPath: undefined })).toBe("sqlite3");
  });
});

describe("改名联动(R5:文件级挪动+DB 改写+thumbs 镜像+兄弟隔离+引用定向改写)", () => {
  let projectTmp: string | undefined;

  afterEach(() => {
    if (projectTmp) {
      rmSync(projectTmp, { recursive: true, force: true });
      projectTmp = undefined;
    }
  });

  /** 项目级布局:<tmp>/proj/store/assets(资产根)+ <tmp>/proj/store/studio-workflow(分片)。 */
  function initProjectAssetsStorage() {
    projectTmp = mkdtempSync(join(tmpdir(), "mystudio-assets-rename-test-"));
    initAssetsStorage(join(projectTmp, "proj", "store", "assets"));
    return projectTmp;
  }

  function assetRoot() {
    return join(projectTmp!, "proj", "store", "assets");
  }

  function writeImageWorkflowShards(refs: { shared: string[]; chapter: string[] }) {
    const shardDir = join(projectTmp!, "proj", "store", "studio-workflow");
    const shared = "image-workflows-shared-001-abc12345.json";
    const chapter = "chapters/chapter-001/image-workflows-001-def67890.json";
    mkdirSync(dirname(join(shardDir, chapter)), { recursive: true });
    const envelope = (list: string[]) => JSON.stringify({
      state: { imageWorkflows: list.map((ref, index) => ({ id: `wf-${index}`, imageUrl: ref })) },
      version: 1,
    });
    writeFileSync(join(shardDir, shared), envelope(refs.shared), "utf-8");
    writeFileSync(join(shardDir, chapter), envelope(refs.chapter), "utf-8");
    writeFileSync(join(shardDir, "manifest.json"), JSON.stringify({
      layout: "studio-workflow-shards-v1",
      version: 1,
      shards: [shared, chapter],
    }, null, 2), "utf-8");
    return { sharedPath: join(shardDir, shared), chapterPath: join(shardDir, chapter) };
  }

  /** 绕过 addAsset 的 (type,name) 合并键,直插同名兄弟行(携盘上文件)。 */
  function insertSiblingRow(row: { id: string; type: string; name: string; filePath: string }) {
    const file = join(assetRoot(), "files", row.filePath);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `sibling-${row.id}`);
    execFileSync("python3", [
      "-c",
      [
        "import sqlite3, sys",
        "conn = sqlite3.connect(sys.argv[1])",
        "conn.execute('INSERT INTO assets (id,type,name,filePath,images,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)', (sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], '[]', '2026-10-19T00:00:00Z', '2026-10-19T00:00:00Z'))",
        "conn.commit()",
        "conn.close()",
      ].join("; "),
      join(assetRoot(), "assets.db"),
      row.id, row.type, row.name, row.filePath,
    ]);
  }

  it("改名把 filePath 与 images[] 全部文件挪入新名夹(files+thumbs),DB 同步改写", () => {
    initProjectAssetsStorage();
    const mainSource = join(assetRoot(), "main.png");
    const detailSource = join(assetRoot(), "detail.png");
    writeFileSync(mainSource, "main image");
    writeFileSync(detailSource, "detail image");
    const asset = addAsset({ type: "role", name: "晏燎", sourceFilePath: mainSource });
    addAssetImage(asset.id, "练气期", detailSource);
    const before = getAssetSync(asset.id)!;
    // thumbs 造在场(联动须镜像挪动)
    for (const rel of [before.filePath!, before.images![0]!.filePath]) {
      const thumb = join(assetRoot(), "thumbs", rel);
      mkdirSync(dirname(thumb), { recursive: true });
      writeFileSync(thumb, `thumb-${basename(rel)}`);
    }

    const updated = updateAsset(asset.id, { name: "晏燎·离火境" });

    expect(updated?.name).toBe("晏燎·离火境");
    expect(updated?.filePath).toBe(`role/晏燎·离火境/${basename(before.filePath!)}`);
    expect(updated?.images![0]!.filePath).toBe(`role/晏燎·离火境/${basename(before.images![0]!.filePath)}`);
    // files+thumbs 双树挪动,旧位置无残留
    for (const rel of [updated!.filePath!, updated!.images![0]!.filePath]) {
      expect(existsSync(join(assetRoot(), "files", rel))).toBe(true);
      expect(existsSync(join(assetRoot(), "thumbs", rel))).toBe(true);
    }
    expect(existsSync(join(assetRoot(), "files", before.filePath!))).toBe(false);
    expect(existsSync(join(assetRoot(), "thumbs", before.filePath!))).toBe(false);
    expect(existsSync(join(assetRoot(), "files", before.images![0]!.filePath))).toBe(false);
  });

  it("同名兄弟资产不受扰(文件级挪动,只动本行引用的文件)", () => {
    initProjectAssetsStorage();
    const source = join(assetRoot(), "hero.png");
    writeFileSync(source, "hero image");
    const asset = addAsset({ type: "role", name: "晏燎", sourceFilePath: source });
    insertSiblingRow({ id: "sibling-1", type: "role", name: "晏燎", filePath: "role/晏燎/sibling.png" });

    updateAsset(asset.id, { name: "晏燎·离火境" });

    // 兄弟行文件原地,DB 未被改名
    expect(existsSync(join(assetRoot(), "files", "role", "晏燎", "sibling.png"))).toBe(true);
    expect(getAssetSync("sibling-1")!.filePath).toBe("role/晏燎/sibling.png");
    // 本行已挪走
    expect(existsSync(join(assetRoot(), "files", "role", "晏燎", basename(asset.filePath!)))).toBe(false);
  });

  it("改名触发 image-workflows 分片内持久化引用定向改写(raw 与编码双形态)", () => {
    initProjectAssetsStorage();
    const source = join(assetRoot(), "hero.png");
    writeFileSync(source, "hero image");
    const asset = addAsset({ type: "role", name: "晏燎", sourceFilePath: source });
    const oldRel = asset.filePath!;
    const encodedOldRel = oldRel.split("/").map(encodeURIComponent).join("/");
    const shards = writeImageWorkflowShards({
      shared: [`asset-file://${oldRel}`, "asset-file://role/别家_9.png"],
      chapter: [`asset-file://${encodedOldRel}?thumb=1`, "asset-file://scene/别家.png"],
    });

    updateAsset(asset.id, { name: "晏燎·离火境" });

    const newUrl = `asset-file://role/${encodeURIComponent("晏燎·离火境")}/${encodeURIComponent(basename(oldRel))}`;
    const sharedText = readFileSync(shards.sharedPath, "utf-8");
    expect(sharedText).toContain(newUrl);
    expect(sharedText).toContain("asset-file://role/别家_9.png"); // 映射外不动
    expect(sharedText).not.toContain(`asset-file://${oldRel}`); // 旧形态引用清零(本资产)
    const chapterText = readFileSync(shards.chapterPath, "utf-8");
    expect(chapterText).toContain(`${newUrl}?thumb=1`); // query 保留
    expect(chapterText).toContain("asset-file://scene/别家.png");
  });

  it("clip/audio 改名不触发挪动(平铺域)", () => {
    initProjectAssetsStorage();
    const source = join(assetRoot(), "voice.wav");
    writeFileSync(source, "voice");
    const asset = addAsset({ type: "audio", name: "晏燎配音", sourceFilePath: source });

    const updated = updateAsset(asset.id, { name: "晏燎配音·新版" });

    expect(updated?.name).toBe("晏燎配音·新版");
    expect(updated?.filePath).toBe(asset.filePath);
    expect(existsSync(join(assetRoot(), "files", asset.filePath!))).toBe(true);
  });

  it("新旧名家键相同(如 晏燎_1/2 → 晏燎_12)→ 跳过挪动只改名", () => {
    initProjectAssetsStorage();
    const source = join(assetRoot(), "tool.png");
    writeFileSync(source, "tool image");
    const asset = addAsset({ type: "tool", name: "晏燎_1/2", sourceFilePath: source });
    // 家键=首段「晏燎」;首文件名带原非法字符的整名安全形
    expect(asset.filePath).toBe(`tool/晏燎/${(asset.filePath ?? "").split("/").pop()}`);

    const updated = updateAsset(asset.id, { name: "晏燎_12" });

    expect(updated?.name).toBe("晏燎_12");
    expect(updated?.filePath).toBe(asset.filePath); // 家键同族,零挪动
    expect(existsSync(join(assetRoot(), "files", asset.filePath!))).toBe(true);
  });

  it("改名后旧名夹遗留的无关文件不被清理(非整夹 rename 语义)", () => {
    initProjectAssetsStorage();
    const source = join(assetRoot(), "hero.png");
    writeFileSync(source, "hero image");
    const asset = addAsset({ type: "role", name: "晏燎", sourceFilePath: source });
    // 旧夹遗留无关件(非本行引用)
    const stray = join(assetRoot(), "files", "role", "晏燎", "stray.png");
    writeFileSync(stray, "stray");

    updateAsset(asset.id, { name: "晏燎·离火境" });

    expect(existsSync(stray)).toBe(true); // 文件级挪动:只动本行文件,遗留件不动
  });

  // === 删除守卫(R6,10-20 独孤剑尘悬空案:被持久化引用的文件不物理删,留孤儿+warn 留痕)===

  it("删除守卫:主图被画布引用(编码态+query)→deleteAsset 仅删 DB 行,文件与缩略图保盘+warn 留痕", () => {
    initProjectAssetsStorage();
    const source = join(assetRoot(), "guard-hero.png");
    writeFileSync(source, "guard hero");
    const asset = addAsset({ type: "role", name: "守卫甲", sourceFilePath: source });
    const rel = asset.filePath!;
    const encodedRel = rel.split("/").map(encodeURIComponent).join("/");
    writeImageWorkflowShards({ shared: [`asset-file://${encodedRel}?thumb=1`], chapter: [] });
    const thumb = join(assetRoot(), "thumbs", rel);
    mkdirSync(dirname(thumb), { recursive: true });
    writeFileSync(thumb, "thumb-guard");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(deleteAsset(asset.id)).toBe(true);
      expect(getAssetSync(asset.id) ?? null).toBeNull(); // DB 行已删
      expect(existsSync(join(assetRoot(), "files", rel))).toBe(true); // 文件保盘(孤儿)
      expect(existsSync(thumb)).toBe(true); // 缩略图同保(?thumb=1 引用可达)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("保盘不物理删"));
    } finally {
      warn.mockRestore();
    }
  });

  it("删除守卫:无引用→deleteAsset 照删文件不误伤(基线行为锁)", () => {
    initProjectAssetsStorage();
    const source = join(assetRoot(), "plain-hero.png");
    writeFileSync(source, "plain hero");
    const asset = addAsset({ type: "role", name: "守卫乙", sourceFilePath: source });
    const rel = asset.filePath!;
    writeImageWorkflowShards({ shared: ["asset-file://role/别家_1.png"], chapter: [] }); // 只引用别家

    expect(deleteAsset(asset.id)).toBe(true);
    expect(existsSync(join(assetRoot(), "files", rel))).toBe(false); // 无引用照删
  });

  it("删除守卫:主图可删补刀遇引用→文件保盘,行级指针仍按序清空/晋升(DB 层照删)", () => {
    initProjectAssetsStorage();
    const source = join(assetRoot(), "poke-main.png");
    writeFileSync(source, "poke main");
    const asset = addAsset({ type: "role", name: "守卫丙", sourceFilePath: source });
    const rel = asset.filePath!;
    writeImageWorkflowShards({ shared: [`asset-file://${rel}`], chapter: [] }); // raw 形态

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const after = removeAssetImage(asset.id, rel);
      expect(after?.filePath ?? "").toBe(""); // 行级指针照清(无 images[] 可晋)
      expect(existsSync(join(assetRoot(), "files", rel))).toBe(true); // 实体保盘
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("保盘不物理删"));
    } finally {
      warn.mockRestore();
    }
  });

  it("删除守卫:images[] 条目删除遇引用→DB 条目照删,实体文件保盘", () => {
    initProjectAssetsStorage();
    const source = join(assetRoot(), "img-main.png");
    const variant = join(assetRoot(), "img-variant.png");
    writeFileSync(source, "img main");
    writeFileSync(variant, "img variant");
    const asset = addAsset({ type: "role", name: "守卫丁", sourceFilePath: source });
    const withVariant = addAssetImage(asset.id, "变体", variant);
    const variantRel = withVariant?.images?.[0]?.filePath ?? "";
    expect(variantRel).not.toBe("");
    writeImageWorkflowShards({ shared: [`asset-file://${variantRel}`], chapter: [] });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const after = removeAssetImage(asset.id, variantRel);
      expect((after?.images ?? []).some((i) => i.filePath === variantRel)).toBe(false); // DB 条目已删
      expect(existsSync(join(assetRoot(), "files", variantRel))).toBe(true); // 实体保盘
    } finally {
      warn.mockRestore();
    }
  });
});

describe("removeAssetImage 行级主图回退删除(10-19 主图可删补刀)", () => {
  it("replaceAssetMainImage 写回的主图(不在 images[])可删:清行级指针+删实体", () => {
    initTempAssetsStorage();
    const asset = addAsset({ type: "role", name: "主图回退删除回归" });
    const src = join(tempAssetRoot!, "src-main.png");
    writeFileSync(src, Buffer.from("89504e470d0a1a0a", "hex"));
    const updated = replaceAssetMainImage(asset.id, src);
    const mainPath = updated?.filePath ?? "";
    expect(mainPath).not.toBe("");
    const after = removeAssetImage(asset.id, mainPath);
    expect(after).not.toBeNull();
    expect(after?.filePath ?? "").toBe("");
    expect(existsSync(join(getFilesDir(), mainPath))).toBe(false);
  });

  it("既不在 images[] 也非行级主图 → 仍返回 null(未命中语义不变)", () => {
    initTempAssetsStorage();
    const asset = addAsset({ type: "role", name: "未命中回归" });
    expect(removeAssetImage(asset.id, "role/不存在/x.png")).toBeNull();
  });

  it("删主图后行级指针顺位晋 images[0](缩略图不落占位,10-19 用户报障善后)", () => {
    initTempAssetsStorage();
    const srcA = join(tempAssetRoot!, "promote-a.png");
    const srcB = join(tempAssetRoot!, "promote-b.png");
    writeFileSync(srcA, Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000050001a5f645400000000049454e44ae426082", "hex"));
    writeFileSync(srcB, Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000050001a5f645400000000049454e44ae426082", "hex"));
    const asset = addAsset({ type: "role", name: "晋主回归", sourceFilePath: srcA });
    const withB = addAssetImage(asset.id, "变体B", srcB);
    // 断链态主图删除 → 行级应晋 images[0](=变体B),不再清空落占位
    const after = removeAssetImage(asset.id, asset.filePath ?? "");
    expect(after?.filePath ?? "").not.toBe("");
    expect(after?.filePath).toBe(withB?.images?.[0]?.filePath);
    expect(existsSync(join(getFilesDir(), after?.filePath ?? "/不存在"))).toBe(true);
  });

  it("images[] 命中路径删的恰是行级主图 → 同款顺位晋升(悬空指针善后)", () => {
    initTempAssetsStorage();
    const srcA = join(tempAssetRoot!, "promote2-a.png");
    const srcB = join(tempAssetRoot!, "promote2-b.png");
    writeFileSync(srcA, Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000050001a5f645400000000049454e44ae426082", "hex"));
    writeFileSync(srcB, Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000050001a5f645400000000049454e44ae426082", "hex"));
    const asset = addAsset({ type: "role", name: "晋主回归二", sourceFilePath: srcA });
    const withB = addAssetImage(asset.id, "变体B2", srcB);
    const bPath = withB?.images?.[0]?.filePath ?? "";
    // 删 images[] 里的主图路径(images[] 命中路径)——行级同指它 → 晋变体B2
    const after = removeAssetImage(asset.id, asset.filePath ?? "");
    expect(after?.filePath).toBe(bPath);
    expect((after?.images ?? []).some((i) => i.filePath === asset.filePath)).toBe(false);
  });
});


describe("Phase C 按型主体句槽(10-25 追加令):updateAsset/getAsset round-trip", () => {
  it("update 写 promptOverrides(Record)→getAsset 读回 promptOverrides(JSON 串)", () => {
    initTempAssetsStorage();
    const added = addAsset({ type: "role", name: "槽位测试角色", description: "描述" });
    const overrides = { 设定卡: "海报构图专用句", 美宣: "美宣主体句" };
    const updated = updateAsset(added.id, { promptOverrides: overrides });
    expect(updated).not.toBeNull();
    const fetched = getAssetSync(added.id);
    expect(fetched?.promptOverrides).toBeTruthy();
    expect(JSON.parse(fetched!.promptOverrides!)).toEqual(overrides);
    // 二次写(改槽)幂等
    updateAsset(added.id, { promptOverrides: { 设定卡: "改过的句" } });
    expect(JSON.parse(getAssetSync(added.id)!.promptOverrides!)).toEqual({ 设定卡: "改过的句" });
  });
});