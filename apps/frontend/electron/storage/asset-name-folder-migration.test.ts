import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ASSET_NAME_FOLDERS_MARKER,
  applyAssetFileRefRewrite,
  rewriteAssetFileRefs,
  runAssetNameFolderMigration,
} from "./asset-name-folder-migration";

/**
 * 资产按名分夹存量迁移例程测试(10-19-asset-name-folders L2 步6/7)。
 * 文件搬移=真实临时目录(files/thumbs 双树逐文件 rename);sqlite 访问=注入 fake
 * (语义化 io,不解析 SQL——先例 asset-store-migration.test.ts 同款)。
 * 锚:design §5 P0-P6 相位 + §6 改写器 + §8 测试矩阵五分支(已迁 noop/正常迁/
 * 异源同名 anomalies/中断续跑/P5 核账红不落 marker)。
 */

type FakeDb = { tables: Record<string, Array<Record<string, unknown>>> };
type FakeSqliteIo = {
  tableExists: (dbPath: string, table: string) => Promise<boolean>;
  readTable: (dbPath: string, table: string) => Promise<Array<Record<string, unknown>>>;
  updateRows: (
    dbPath: string,
    table: string,
    updates: Array<{ rowid: number; column: string; value: string | null }>,
  ) => Promise<void>;
};

function fakeSqliteIo(dbs: Record<string, FakeDb>): FakeSqliteIo {
  return {
    tableExists: async (dbPath, table) => Boolean(dbs[dbPath]?.tables?.[table]),
    readTable: async (dbPath, table) => (dbs[dbPath]?.tables?.[table] ?? []).map((row) => ({ ...row })),
    updateRows: async (dbPath, table, updates) => {
      const rows = dbs[dbPath]?.tables?.[table];
      if (!rows) throw new Error(`no table ${table}`);
      for (const update of updates) {
        const row = rows.find((candidate) => candidate.__rowid__ === update.rowid);
        if (row) row[update.column] = update.value;
      }
    },
  };
}

interface FixtureRow {
  rowid: number;
  id: string;
  type: string;
  name: string;
  filePath?: string;
  images?: string;
}

type Fixture = {
  tmp: string;
  projectRoot: string;
  assetRoot: string;
  storeDir: string;
  shardDir: string;
  dbPath: string;
  dbs: Record<string, FakeDb>;
  sharedShard: string;
  chapterShard: string;
  writeShards: (refs: Record<string, string[]>) => void;
  run: (overrides?: {
    updateRowsNoOp?: boolean;
    renameFailOn?: string;
  }) => Promise<Awaited<ReturnType<typeof runAssetNameFolderMigration>>>;
  ledgerOf: (run: { roots: Array<{ ledgerDir: string | null }> }) => Record<string, unknown>;
};

/**
 * fixture 布局(复刻生产形态):
 * proj/store/assets/{files,thumbs,assets.db} + proj/store/studio-workflow 分片
 * (manifest 在场索引;image-workflows 分片持 asset-file:// 引用,raw 与 URL 编码双形态)。
 */
function createFixture(rows: FixtureRow[]): Fixture {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-asset-name-folders-"));
  const projectRoot = path.join(tmp, "proj");
  const assetRoot = path.join(projectRoot, "store", "assets");
  const storeDir = path.join(projectRoot, "store");
  const shardDir = path.join(projectRoot, "store", "studio-workflow");
  const dbPath = path.join(assetRoot, "assets.db");

  for (const zone of ["role", "scene", "tool", "clip", "audio"]) {
    fs.mkdirSync(path.join(assetRoot, "files", zone), { recursive: true });
  }
  fs.mkdirSync(path.join(assetRoot, "thumbs", "role"), { recursive: true });
  fs.writeFileSync(dbPath, "asset-db-original");

  // 盘上文件:逐行落平铺文件+thumbs 镜像(filePath 与 images[] 元素都造;个别用例自行删除断链件)
  for (const row of rows) {
    const relPaths: string[] = [];
    if (row.filePath) relPaths.push(row.filePath);
    if (row.images) {
      try {
        for (const img of JSON.parse(row.images)) relPaths.push(img.filePath);
      } catch {}
    }
    for (const rel of relPaths) {
      const p = path.join(assetRoot, "files", rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, `content-${row.id}-${path.basename(rel)}`);
      const t = path.join(assetRoot, "thumbs", rel);
      fs.mkdirSync(path.dirname(t), { recursive: true });
      fs.writeFileSync(t, `thumb-${row.id}-${path.basename(rel)}`);
    }
  }

  const dbs: Record<string, FakeDb> = {
    [dbPath]: {
      tables: {
        assets: rows.map((row) => ({ __rowid__: row.rowid, ...row })),
      },
    },
  };

  const sharedShard = path.join(shardDir, "image-workflows-shared-001-abc12345.json");
  const chapterShard = path.join(shardDir, "chapters", "chapter-001", "image-workflows-001-def67890.json");

  const writeShards = (refs: Record<string, string[]>) => {
    const shards = [path.basename(sharedShard), "chapters/chapter-001/image-workflows-001-def67890.json"];
    fs.mkdirSync(path.dirname(chapterShard), { recursive: true });
    for (const shard of shards) {
      const list = refs[shard] ?? [];
      fs.writeFileSync(
        path.join(shardDir, shard),
        JSON.stringify({ state: { imageWorkflows: list.map((ref, index) => ({ id: `wf-${index}`, imageUrl: ref })) }, version: 1 }),
        "utf-8",
      );
    }
    fs.writeFileSync(
      path.join(shardDir, "manifest.json"),
      JSON.stringify({ layout: "studio-workflow-shards-v1", version: 1, shards }, null, 2),
      "utf-8",
    );
  };

  const run = (overrides?: { updateRowsNoOp?: boolean; renameFailOn?: string }) => {
    const base = fakeSqliteIo(dbs);
    const sqliteIo: FakeSqliteIo = overrides?.updateRowsNoOp
      ? {
          tableExists: base.tableExists,
          readTable: base.readTable,
          updateRows: async () => undefined, // 静默吞掉 DB 改写(核账红注入)
        }
      : base;
    const io = overrides?.renameFailOn
      ? {
          renameSync: (from: string, to: string) => {
            if (from.includes(overrides.renameFailOn!)) throw new Error("disk full");
            fs.renameSync(from, to);
          },
        }
      : undefined;
    return runAssetNameFolderMigration({
      assetRoots: () => [assetRoot],
      sqliteIo,
      io,
      log: () => undefined,
    });
  };

  const ledgerOf = (runResult: { roots: Array<{ ledgerDir: string | null }> }) => {
    const ledgerDir = runResult.roots[0]?.ledgerDir;
    expect(ledgerDir).toBeTruthy();
    return JSON.parse(fs.readFileSync(path.join(ledgerDir!, "migration-ledger.json"), "utf-8")) as Record<string, unknown>;
  };

  return {
    tmp, projectRoot, assetRoot, storeDir, shardDir, dbPath, dbs, sharedShard, chapterShard,
    writeShards, run, ledgerOf,
  };
}

const LONG_NAME = "王也2-成年人的崩溃，常常是无声的。".repeat(12); // >80 字符 → 截断必发

function defaultRows(): FixtureRow[] {
  return [
    { rowid: 1, id: "r1", type: "role", name: "晏燎", filePath: "role/晏燎_1784950037178.png" },
    { rowid: 2, id: "r2", type: "role", name: "独孤剑尘", filePath: "role/独孤剑尘_1787541551488.png", images: JSON.stringify([{ name: "练气期", filePath: "role/独孤剑尘_练气期_1.png" }]) },
    { rowid: 3, id: "s1", type: "scene", name: "金水塾馆", filePath: "scene/金水塾馆干净版_1787981493497.png" },
    { rowid: 4, id: "t1", type: "tool", name: "替死蛊", filePath: "tool/uuid-tool-1.png" },
    { rowid: 5, id: "a1", type: "audio", name: "晏燎配音", filePath: "audio/voice-1.wav" },
    { rowid: 6, id: "c1", type: "clip", name: "过场", filePath: "clip/clip-1.mp4" },
  ];
}

describe("rewriteAssetFileRefs 改写器(design §6 纯函数)", () => {
  it("旧形态 asset-file://<type>/<file> 按映射表改写", () => {
    const mapping = new Map([["role/晏燎_1.png", "role/晏燎/晏燎_1.png"]]);
    const { text, hits } = rewriteAssetFileRefs(
      '{"imageUrl":"asset-file://role/晏燎_1.png"}',
      mapping,
    );
    expect(hits).toBe(1);
    expect(text).toBe('{"imageUrl":"asset-file://role/%E6%99%8F%E7%87%8E/%E6%99%8F%E7%87%8E_1.png"}');
  });

  it("URL 编码路径(%E6%99%8F%E7%87%8E 形态)改写", () => {
    const mapping = new Map([["role/晏燎_1.png", "role/晏燎/晏燎_1.png"]]);
    const { text, hits } = rewriteAssetFileRefs(
      "asset-file://role/%E6%99%8F%E7%87%8E_1.png",
      mapping,
    );
    expect(hits).toBe(1);
    expect(text).toBe("asset-file://role/%E6%99%8F%E7%87%8E/%E6%99%8F%E7%87%8E_1.png");
  });

  it("新形态幂等:已带名夹层的引用不再命中", () => {
    const mapping = new Map([["role/晏燎_1.png", "role/晏燎/晏燎_1.png"]]);
    const source = "asset-file://role/%E6%99%8F%E7%87%8E/%E6%99%8F%E7%87%8E_1.png";
    const { text, hits } = rewriteAssetFileRefs(source, mapping);
    expect(hits).toBe(0);
    expect(text).toBe(source);
  });

  it("映射表外引用不动(其它资产文件/scene 域)", () => {
    const mapping = new Map([["role/晏燎_1.png", "role/晏燎/晏燎_1.png"]]);
    const source = '["asset-file://role/别家_9.png","asset-file://scene/s_1.png"]';
    const { text, hits } = rewriteAssetFileRefs(source, mapping);
    expect(hits).toBe(0);
    expect(text).toBe(source);
  });

  it("audio/clip 域零命中(audio 不在改造域)", () => {
    const mapping = new Map([["role/晏燎_1.png", "role/晏燎/晏燎_1.png"]]);
    const source = '["asset-file://audio/voice.wav","asset-file://clip/clip.mp4"]';
    const { text, hits } = rewriteAssetFileRefs(source, mapping);
    expect(hits).toBe(0);
    expect(text).toBe(source);
  });

  it("非资产 URL(project-file:// 等)不动", () => {
    const mapping = new Map([["role/晏燎_1.png", "role/晏燎/晏燎_1.png"]]);
    const source = '["project-file://_p/x/role/晏燎_1.png","local-image://ai-image/a.png"]';
    const { text, hits } = rewriteAssetFileRefs(source, mapping);
    expect(hits).toBe(0);
    expect(text).toBe(source);
  });

  it("?thumb=1 变体改写且保留 query", () => {
    const mapping = new Map([["role/晏燎_1.png", "role/晏燎/晏燎_1.png"]]);
    const { text, hits } = rewriteAssetFileRefs("asset-file://role/晏燎_1.png?thumb=1", mapping);
    expect(hits).toBe(1);
    expect(text).toBe("asset-file://role/%E6%99%8F%E7%87%8E/%E6%99%8F%E7%87%8E_1.png?thumb=1");
  });

  it("同一文本多次命中全部改写并计数", () => {
    const mapping = new Map([["role/晏燎_1.png", "role/晏燎/晏燎_1.png"]]);
    const { text, hits } = rewriteAssetFileRefs(
      '["asset-file://role/晏燎_1.png","asset-file://role/%E6%99%8F%E7%87%8E_1.png?thumb=1"]',
      mapping,
    );
    expect(hits).toBe(2);
    expect(text).not.toContain("role/%E6%99%8F%E7%87%8E_1.png");
    expect(text).not.toContain("role/晏燎_1.png");
  });

  it("applyAssetFileRefRewrite 文件级应用器:有命中才写盘", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-ref-apply-"));
    const target = path.join(tmp, "shard.json");
    fs.writeFileSync(target, '{"ref":"asset-file://role/晏燎_1.png"}', "utf-8");
    const mapping = new Map([["role/晏燎_1.png", "role/晏燎/晏燎_1.png"]]);

    expect(applyAssetFileRefRewrite(target, mapping)).toBe(1);
    expect(fs.readFileSync(target, "utf-8")).toContain("role/%E6%99%8F%E7%87%8E/");

    // 二次应用幂等零命中,不写盘(mtime 不变验证略,靠 hits=0 断言)
    expect(applyAssetFileRefRewrite(target, mapping)).toBe(0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe("runAssetNameFolderMigration 迁移状态机(design §5 P0-P6)", () => {
  it("正常迁:双树挪动+DB filePath/images 改写+引用改写(raw 与编码双形态)+marker 落资产根", async () => {
    const fixture = createFixture(defaultRows());
    fixture.writeShards({
      "image-workflows-shared-001-abc12345.json": [
        "asset-file://scene/金水塾馆干净版_1787981493497.png",
        "asset-file://role/%E6%99%8F%E7%87%8E_1784950037178.png",
      ],
      "chapters/chapter-001/image-workflows-001-def67890.json": [
        "asset-file://role/%E7%8B%AC%E5%AD%A4%E5%89%91%E5%B0%98_1787541551488.png",
      ],
    });

    const result = await fixture.run();
    const root = result.roots[0]!;
    expect(result.status).toBe("migrated");
    expect(root.status).toBe("migrated");

    // 双树挪动:files+thumbs 平铺件消失,名夹层在场
    expect(fs.existsSync(path.join(fixture.assetRoot, "files", "role", "晏燎", "晏燎_1784950037178.png"))).toBe(true);
    expect(fs.existsSync(path.join(fixture.assetRoot, "thumbs", "role", "晏燎", "晏燎_1784950037178.png"))).toBe(true);
    expect(fs.existsSync(path.join(fixture.assetRoot, "files", "role", "晏燎_1784950037178.png"))).toBe(false);
    expect(fs.existsSync(path.join(fixture.assetRoot, "files", "scene", "金水塾馆", "金水塾馆干净版_1787981493497.png"))).toBe(true);
    // 多图 images[] 同步挪动
    expect(fs.existsSync(path.join(fixture.assetRoot, "files", "role", "独孤剑尘", "独孤剑尘_练气期_1.png"))).toBe(true);
    // clip/audio 平铺不动
    expect(fs.existsSync(path.join(fixture.assetRoot, "files", "audio", "voice-1.wav"))).toBe(true);
    expect(fs.existsSync(path.join(fixture.assetRoot, "files", "clip", "clip-1.mp4"))).toBe(true);

    // DB 改写:filePath 与 images[] 全量新形态
    const rows = fixture.dbs[fixture.dbPath]!.tables.assets!;
    expect(rows.find((r) => r.id === "r1")!.filePath).toBe("role/晏燎/晏燎_1784950037178.png");
    expect(rows.find((r) => r.id === "r2")!.filePath).toBe("role/独孤剑尘/独孤剑尘_1787541551488.png");
    expect(JSON.parse(String(rows.find((r) => r.id === "r2")!.images))[0].filePath).toBe("role/独孤剑尘/独孤剑尘_练气期_1.png");
    expect(rows.find((r) => r.id === "a1")!.filePath).toBe("audio/voice-1.wav");

    // 引用改写:raw 与编码形态都改写,非映射引用不动
    const shared = fs.readFileSync(fixture.sharedShard, "utf-8");
    expect(shared).toContain("asset-file://scene/%E9%87%91%E6%B0%B4%E5%A1%BE%E9%A6%86/%E9%87%91%E6%B0%B4%E5%A1%BE%E9%A6%86%E5%B9%B2%E5%87%80%E7%89%88_1787981493497.png");
    expect(shared).toContain("asset-file://role/%E6%99%8F%E7%87%8E/%E6%99%8F%E7%87%8E_1784950037178.png");
    const chapter = fs.readFileSync(fixture.chapterShard, "utf-8");
    expect(chapter).toContain("asset-file://role/%E7%8B%AC%E5%AD%A4%E5%89%91%E5%B0%98/%E7%8B%AC%E5%AD%A4%E5%89%91%E5%B0%98_1787541551488.png");

    // marker 落资产根(与 assets.db 同层),不在 files/ 内
    const markerPath = path.join(fixture.assetRoot, ASSET_NAME_FOLDERS_MARKER);
    expect(fs.existsSync(markerPath)).toBe(true);
    expect(fs.existsSync(path.join(fixture.assetRoot, "files", ASSET_NAME_FOLDERS_MARKER))).toBe(false);
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf-8")) as { version: number };
    expect(marker.version).toBe(1);

    // 台账:db 原件+manifest+README+move-map 落项目根 backups(根目录铁令)
    expect(root.ledgerDir).toContain(path.join(fixture.projectRoot, "backups", "asset-name-folders-"));
    expect(fs.existsSync(path.join(root.ledgerDir!, "assets.db.orig"))).toBe(true);
    expect(fs.existsSync(path.join(root.ledgerDir!, "files-manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(root.ledgerDir!, "README.md"))).toBe(true);
    const moveMap = JSON.parse(fs.readFileSync(path.join(root.ledgerDir!, "move-map.json"), "utf-8")) as Record<string, string>;
    expect(moveMap["role/晏燎_1784950037178.png"]).toBe("role/晏燎/晏燎_1784950037178.png");

    // 引用改写计数对账(P5 同款语义留台账)
    const ledger = fixture.ledgerOf(result);
    expect((ledger.refs as { rewritten: number }).rewritten).toBe(3);
  });

  it("幂等:二跑 no-op 零台账", async () => {
    const fixture = createFixture(defaultRows());
    fixture.writeShards({
      "image-workflows-shared-001-abc12345.json": ["asset-file://role/%E6%99%8F%E7%87%8E_1784950037178.png"],
      "chapters/chapter-001/image-workflows-001-def67890.json": [],
    });
    const first = await fixture.run();
    expect(first.status).toBe("migrated");

    const second = await fixture.run();
    expect(second.status).toBe("noop");
    expect(second.roots[0]!.status).toBe("noop");
    expect(second.roots[0]!.ledgerDir).toBeNull();
  });

  it("超长名截断落 anomalies 台账(design §2 第5条)", async () => {
    const rows = defaultRows();
    rows.push({ rowid: 7, id: "r7", type: "role", name: LONG_NAME, filePath: "role/wangye_1.png" });
    const fixture = createFixture(rows);

    const result = await fixture.run();
    expect(result.status).toBe("migrated");
    const ledger = fixture.ledgerOf(result);
    const anomalies = ledger.anomalies as string[];
    expect(anomalies.some((entry) => entry.includes("截断"))).toBe(true);
    // 落盘夹名 ≤80 字符
    const folder = fs.readdirSync(path.join(fixture.assetRoot, "files", "role")).find((n) => n.startsWith("王也"));
    expect(folder!.length).toBeLessThanOrEqual(80);
    expect(folder!.length).toBeGreaterThan(0);
  });

  it("异源同名冲突:目标已存在的文件不挪、DB 不改、anomalies 留痕,迁移整体仍收敛", async () => {
    const fixture = createFixture(defaultRows());
    // 预置异源同名件占位 role/晏燎/ 晏燎_1784950037178.png(L1 新写入或人工遗留)
    const squatter = path.join(fixture.assetRoot, "files", "role", "晏燎", "晏燎_1784950037178.png");
    fs.mkdirSync(path.dirname(squatter), { recursive: true });
    fs.writeFileSync(squatter, "different-origin");

    const result = await fixture.run();
    expect(result.status).toBe("migrated");

    // 冲突件原地保留,平铺件不挪
    expect(fs.readFileSync(squatter, "utf-8")).toBe("different-origin");
    expect(fs.existsSync(path.join(fixture.assetRoot, "files", "role", "晏燎_1784950037178.png"))).toBe(true);
    // DB 该行保持旧路径(可解析);其它行照迁
    const rows = fixture.dbs[fixture.dbPath]!.tables.assets!;
    expect(rows.find((r) => r.id === "r1")!.filePath).toBe("role/晏燎_1784950037178.png");
    expect(rows.find((r) => r.id === "s1")!.filePath).toBe("scene/金水塾馆/金水塾馆干净版_1787981493497.png");
    // anomalies 留痕
    const ledger = fixture.ledgerOf(result);
    expect((ledger.anomalies as string[]).some((entry) => entry.includes("异源"))).toBe(true);
    // marker 仍落(P5 通过:文件计数不变/DB 可解析/无新断链)
    expect(fs.existsSync(path.join(fixture.assetRoot, ASSET_NAME_FOLDERS_MARKER))).toBe(true);
  });

  it("多行共享同一平铺路径:整 rel 排除不挪不映射,DB/引用保持平铺可解析,二跑 no-op(修复映射键静默覆盖→重跑蒙蔽)", async () => {
    // 前置:两行(role/甲 与 role/乙)引用同一平铺件 role/shared-file.png。
    // 修复前:mapping.set 后写覆盖先写→文件挪进 role/甲/ 而 DB 全改写 role/乙/,
    // 首跑 P5③ 拦截(interrupted 不落 marker)但 DB 已损,重跑以已损 DB 重算
    // dbBroken 基线被蒙蔽→migrated+marker,两行永久指向不存在的 role/乙/。
    const rows = defaultRows();
    rows.push({ rowid: 9, id: "share-a", type: "role", name: "甲", filePath: "role/shared-file.png" });
    rows.push({ rowid: 10, id: "share-b", type: "role", name: "乙", filePath: "role/shared-file.png" });
    const fixture = createFixture(rows);

    const first = await fixture.run();
    expect(first.status).toBe("migrated");

    // 共享 rel 两行 DB 均保持旧平铺路径(不被改写到任何一方名夹)
    const rowsNow = fixture.dbs[fixture.dbPath]!.tables.assets!;
    expect(rowsNow.find((r) => r.id === "share-a")!.filePath).toBe("role/shared-file.png");
    expect(rowsNow.find((r) => r.id === "share-b")!.filePath).toBe("role/shared-file.png");
    // 文件保持平铺在场,两行引用盘上可解析(无永久断链)
    expect(fs.existsSync(path.join(fixture.assetRoot, "files", "role", "shared-file.png"))).toBe(true);
    // 其它行照常迁移(排除面不扩散)
    expect(rowsNow.find((r) => r.id === "r1")!.filePath).toBe("role/晏燎/晏燎_1784950037178.png");
    expect(fs.existsSync(path.join(fixture.assetRoot, "files", "role", "晏燎", "晏燎_1784950037178.png"))).toBe(true);
    // anomalies 留痕(目标分歧入账,不落误导性「文件缺失」)
    const ledger = fixture.ledgerOf(first);
    const anomalies = ledger.anomalies as string[];
    expect(anomalies.some((entry) => entry.includes("多行共享平铺路径") && entry.includes("role/shared-file.png"))).toBe(true);
    expect((ledger.files as { missing: string[] }).missing).not.toContain("role/shared-file.png");
    // marker 落(P5 真绿:文件计数不变/DB 可解析/无新断链)
    expect(fs.existsSync(path.join(fixture.assetRoot, ASSET_NAME_FOLDERS_MARKER))).toBe(true);

    // 二跑 no-op(幂等闭环:排除态是稳定终态)
    const second = await fixture.run();
    expect(second.status).toBe("noop");
  });

  it("断链不新增:基线断链引用(role/missing.png)改写后按映射口径计入允许集,P5 通过", async () => {
    const rows = defaultRows();
    // 基线断链:引用在,文件不在;且 DB 行也指向缺失件(盘上不造件)
    rows.push({ rowid: 8, id: "r8", type: "role", name: "已失图", filePath: "role/missing.png" });
    const fixture = createFixture(rows);
    fs.rmSync(path.join(fixture.assetRoot, "files", "role", "missing.png"), { force: true });
    fs.rmSync(path.join(fixture.assetRoot, "thumbs", "role", "missing.png"), { force: true });
    fixture.writeShards({
      "image-workflows-shared-001-abc12345.json": ["asset-file://role/missing.png"],
      "chapters/chapter-001/image-workflows-001-def67890.json": [],
    });

    const result = await fixture.run();
    expect(result.status).toBe("migrated");
    // 断链引用按映射改写到名夹层路径(文件仍缺=断链保持,不新增不减少)
    const shared = fs.readFileSync(fixture.sharedShard, "utf-8");
    expect(shared).toContain("asset-file://role/%E5%B7%B2%E5%A4%B1%E5%9B%BE/missing.png");
    const rowsNow = fixture.dbs[fixture.dbPath]!.tables.assets!;
    expect(rowsNow.find((r) => r.id === "r8")!.filePath).toBe("role/已失图/missing.png");
    // anomalies 记文件缺失
    const ledger = fixture.ledgerOf(result);
    expect((ledger.anomalies as string[]).some((entry) => entry.includes("缺失"))).toBe(true);
    expect(fs.existsSync(path.join(fixture.assetRoot, ASSET_NAME_FOLDERS_MARKER))).toBe(true);
  });

  it("中断续跑:P2 半态(部分文件已挪+DB 未改写)重跑收敛", async () => {
    const fixture = createFixture(defaultRows());
    fixture.writeShards({
      "image-workflows-shared-001-abc12345.json": ["asset-file://role/%E6%99%8F%E7%87%8E_1784950037178.png"],
      "chapters/chapter-001/image-workflows-001-def67890.json": [],
    });
    // 直造 P2 半态:r1 的 files+thumbs 已挪(模拟中断后遗留),DB 仍平铺
    fs.mkdirSync(path.join(fixture.assetRoot, "files", "role", "晏燎"), { recursive: true });
    fs.renameSync(
      path.join(fixture.assetRoot, "files", "role", "晏燎_1784950037178.png"),
      path.join(fixture.assetRoot, "files", "role", "晏燎", "晏燎_1784950037178.png"),
    );
    fs.mkdirSync(path.join(fixture.assetRoot, "thumbs", "role", "晏燎"), { recursive: true });
    fs.renameSync(
      path.join(fixture.assetRoot, "thumbs", "role", "晏燎_1784950037178.png"),
      path.join(fixture.assetRoot, "thumbs", "role", "晏燎", "晏燎_1784950037178.png"),
    );

    const result = await fixture.run();
    expect(result.status).toBe("migrated");
    // 半态件不被重复挪(仍在),其余行补迁,DB 全量收敛
    expect(fs.existsSync(path.join(fixture.assetRoot, "files", "role", "晏燎", "晏燎_1784950037178.png"))).toBe(true);
    expect(fs.existsSync(path.join(fixture.assetRoot, "files", "role", "独孤剑尘", "独孤剑尘_1787541551488.png"))).toBe(true);
    const rows = fixture.dbs[fixture.dbPath]!.tables.assets!;
    expect(rows.find((r) => r.id === "r1")!.filePath).toBe("role/晏燎/晏燎_1784950037178.png");
    expect(rows.find((r) => r.id === "r2")!.filePath).toBe("role/独孤剑尘/独孤剑尘_1787541551488.png");
    // 引用照改写(P3 首跑即改)
    expect(fs.readFileSync(fixture.sharedShard, "utf-8")).toContain("role/%E6%99%8F%E7%87%8E/%E6%99%8F%E7%87%8E_1784950037178.png");
    expect(fs.existsSync(path.join(fixture.assetRoot, ASSET_NAME_FOLDERS_MARKER))).toBe(true);
  });

  it("P2 rename 中断(未过提交):台账 interrupted+不落 marker,重跑收敛", async () => {
    const fixture = createFixture(defaultRows());
    fixture.writeShards({
      "image-workflows-shared-001-abc12345.json": [],
      "chapters/chapter-001/image-workflows-001-def67890.json": [],
    });
    const first = await fixture.run({ renameFailOn: "独孤剑尘_1787541551488.png" });
    expect(first.status).toBe("interrupted");
    expect(first.roots[0]!.status).toBe("interrupted");
    expect(fs.existsSync(path.join(fixture.assetRoot, ASSET_NAME_FOLDERS_MARKER))).toBe(false);
    // 晏燎行已挪(逐文件可重入),独孤行原样
    expect(fs.existsSync(path.join(fixture.assetRoot, "files", "role", "晏燎", "晏燎_1784950037178.png"))).toBe(true);
    expect(fs.existsSync(path.join(fixture.assetRoot, "files", "role", "独孤剑尘_1787541551488.png"))).toBe(true);

    const second = await fixture.run();
    expect(second.status).toBe("migrated");
    expect(fs.existsSync(path.join(fixture.assetRoot, ASSET_NAME_FOLDERS_MARKER))).toBe(true);
  });

  it("P5 核账红(DB 改写被吞)→ interrupted+不落 marker(核账不通过不落 marker)", async () => {
    const fixture = createFixture(defaultRows());
    fixture.writeShards({
      "image-workflows-shared-001-abc12345.json": [],
      "chapters/chapter-001/image-workflows-001-def67890.json": [],
    });
    const result = await fixture.run({ updateRowsNoOp: true });
    expect(result.status).toBe("interrupted");
    expect(result.roots[0]!.status).toBe("interrupted");
    expect(fs.existsSync(path.join(fixture.assetRoot, ASSET_NAME_FOLDERS_MARKER))).toBe(false);
    // 台账留 error 痕
    const ledger = fixture.ledgerOf(result);
    expect(ledger.interrupted).toBe(true);
    expect(String(ledger.error)).toContain("filePath");
  });

  it("clip/audio-only 根与空根:正常迁零动作(平铺域不动)", async () => {
    const fixture = createFixture([
      { rowid: 1, id: "a1", type: "audio", name: "晏燎配音", filePath: "audio/voice-1.wav" },
      { rowid: 2, id: "c1", type: "clip", name: "过场", filePath: "clip/clip-1.mp4" },
    ]);
    const result = await fixture.run();
    expect(result.status).toBe("migrated");
    expect(fs.existsSync(path.join(fixture.assetRoot, "files", "audio", "voice-1.wav"))).toBe(true);
    expect(fs.existsSync(path.join(fixture.assetRoot, ASSET_NAME_FOLDERS_MARKER))).toBe(true);
  });

  it("资产根无 assets.db → noop", async () => {
    const fixture = createFixture([]);
    fs.rmSync(fixture.dbPath, { force: true });
    const result = await fixture.run();
    expect(result.status).toBe("noop");
    expect(result.roots[0]!.status).toBe("noop");
  });

  it("默认根枚举:内部 _p/* 与位置表外部位置去重后逐根执行", async () => {
    // 用真实默认枚举路径(不注入 assetRoots)验证 _p/* + locationStore 双源枚举
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-asset-name-folders-enum-"));
    const internalProject = path.join(tmp, "storage", "_p", "pid-internal");
    const externalProject = path.join(tmp, "external", "proj-a");
    for (const projectRoot of [internalProject, externalProject]) {
      const assetRoot = path.join(projectRoot, "store", "assets");
      fs.mkdirSync(path.join(assetRoot, "files", "role"), { recursive: true });
      fs.writeFileSync(path.join(assetRoot, "assets.db"), "db");
    }
    const result = await runAssetNameFolderMigration({
      getStorageBasePath: () => path.join(tmp, "storage"),
      locationStore: {
        get: () => undefined,
        set: () => undefined,
        delete: () => undefined,
        all: () => ({ "pid-external": externalProject }),
      },
      log: () => undefined,
    });
    // 两个根均无 assets 表(fake defaultSqliteIo 走 CLI 对假 db 内容查询失败→tableExists false→零行迁移落 marker)
    expect(result.roots.map((root) => path.dirname(path.dirname(root.root)))).toEqual(
      expect.arrayContaining([internalProject, externalProject]),
    );
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
