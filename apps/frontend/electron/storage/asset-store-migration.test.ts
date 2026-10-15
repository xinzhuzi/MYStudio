import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readAssetHomeMarker } from "./asset-home";
import { runAssetStoreMigration } from "./asset-store-migration";

/**
 * 资产二段归位迁移例程测试(1016:项目根 assets/ → store/assets/)。
 * 文件搬移=真实临时目录整树 rename;sqlite 访问=注入 fake(语义化 io,不解析 SQL);
 * 锚:计划 testPlan【新增】asset-store-migration.test.ts T2-T10 + migrationDesign 五分支全语义。
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

type RunOverrides = {
  sqliteIo?: FakeSqliteIo | undefined;
  renameSync?: ((from: string, to: string) => void) | undefined;
  statSync?: ((filePath: string) => { size: number; dev: number; isDirectory(): boolean }) | undefined;
  updateRowsFailAt?: string | undefined;
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

type Fixture = {
  tmp: string;
  userData: string;
  legacyBase: string;
  projectRoot: string;
  rootAssets: string;
  storeAssets: string;
  ttsRuntime: string;
  dbs: Record<string, FakeDb>;
  sqliteIo: FakeSqliteIo;
  writeMarker: (marker: Record<string, unknown> | "CORRUPT" | "NONE") => void;
  ledgerOf: (run: { ledgerDir: string | null }) => Record<string, unknown>;
  run: (overrides?: RunOverrides) => Promise<Awaited<ReturnType<typeof runAssetStoreMigration>>>;
};

function createFixture(): Fixture {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-asset-store-migration-"));
  const userData = path.join(tmp, "userData");
  const legacyBase = path.join(tmp, "legacy");
  const projectRoot = path.join(tmp, "MA");
  const rootAssets = path.join(projectRoot, "assets");
  const storeAssets = path.join(projectRoot, "store", "assets");
  const ttsRuntime = path.join(projectRoot, "TTS", "runtime");
  fs.mkdirSync(userData, { recursive: true });

  // 1015 一段已完成的落点:项目根 assets(三件:assets.db+files+thumbs)
  for (const zone of ["role", "scene", "tool", "clip", "audio"]) {
    fs.mkdirSync(path.join(rootAssets, "files", zone), { recursive: true });
  }
  fs.mkdirSync(path.join(rootAssets, "thumbs", "role"), { recursive: true });
  fs.writeFileSync(path.join(rootAssets, "files", "role", "a.png"), "role-a");
  fs.writeFileSync(path.join(rootAssets, "files", "role", "a.wav"), "role-a-audio");
  fs.writeFileSync(path.join(rootAssets, "files", "scene", "s.png"), "scene-s");
  fs.writeFileSync(path.join(rootAssets, "thumbs", "role", "a.png"), "thumb-a");
  fs.writeFileSync(path.join(rootAssets, "assets.db"), "asset-db-original");

  // 项目根 TTS(1015 留守形态):tts.sqlite profiles 引用绝对前缀 root/assets/files
  fs.mkdirSync(path.join(ttsRuntime, "audio"), { recursive: true });
  fs.writeFileSync(path.join(ttsRuntime, "tts.sqlite"), "tts-db-original");
  fs.writeFileSync(path.join(ttsRuntime, "config.json"), "{}");

  // 项目根 store json 引用(含 1 处基线断链 role/missing.png)
  fs.mkdirSync(path.join(projectRoot, "store"), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, "store", "main.json"),
    JSON.stringify({
      refs: ["asset-file://role/a.png", "asset-file://scene/s.png", "asset-file://role/missing.png"],
    }),
    "utf-8",
  );

  const locationTable: Record<string, string> = { "pid-1": projectRoot };
  const dbs: Record<string, FakeDb> = {};
  dbs[path.join(rootAssets, "assets.db")] = {
    tables: {
      assets: [
        { __rowid__: 1, id: "a1", type: "role", name: "甲", filePath: "role/a.png" },
        { __rowid__: 2, id: "a2", type: "scene", name: "乙", filePath: "scene/s.png" },
      ],
    },
  };
  dbs[path.join(ttsRuntime, "tts.sqlite")] = {
    tables: {
      profiles: [
        { __rowid__: 1, id: "p1", name: "音色1", reference_audio_path: `${rootAssets}/files/role/a.wav` },
      ],
      generations: [
        { __rowid__: 1, id: "g1", audio_path: "/elsewhere/keep.wav" },
      ],
    },
  };

  const sqliteIo = fakeSqliteIo(dbs);

  const writeMarker = (marker: Record<string, unknown> | "CORRUPT" | "NONE") => {
    const filePath = path.join(userData, "asset-home.json");
    if (marker === "NONE") {
      if (fs.existsSync(filePath)) fs.rmSync(filePath);
      return;
    }
    if (marker === "CORRUPT") {
      fs.writeFileSync(filePath, "{broken", "utf-8");
      return;
    }
    fs.writeFileSync(filePath, JSON.stringify(marker), "utf-8");
  };
  // 默认:v1 marker(1015 一段完成态=真机现状)
  writeMarker({
    version: 1,
    projectId: "pid-1",
    lastKnownLocation: projectRoot,
    ttsMigrated: true,
    ledgerDir: "/tmp/stage-one-ledger",
  });

  const ledgerOf = (run: { ledgerDir: string | null }) => {
    expect(run.ledgerDir).toBeTruthy();
    return JSON.parse(fs.readFileSync(path.join(run.ledgerDir!, "migration-ledger.json"), "utf-8")) as Record<string, unknown>;
  };

  const run = (overrides?: RunOverrides) => {
    const effectiveSqlite = overrides?.sqliteIo ?? sqliteIo;
    const wrappedSqlite: FakeSqliteIo = overrides?.updateRowsFailAt
      ? {
          tableExists: effectiveSqlite.tableExists,
          readTable: effectiveSqlite.readTable,
          updateRows: async (dbPath, table, _updates) => {
            if (table === overrides.updateRowsFailAt) throw new Error("sqlite write failed");
            return effectiveSqlite.updateRows(dbPath, table, _updates);
          },
        }
      : effectiveSqlite;
    // rename 时 fake 库 key 跟随文件/整树移动(模拟真实 sqlite 文件随 rename 迁家;
    // 二段 P2 是整目录 rename,键在目录前缀下的须一并平移)
    const dbsFollowingRename = (from: string, to: string) => {
      for (const key of Object.keys(dbs)) {
        if (key === from) {
          dbs[to] = dbs[key];
          delete dbs[key];
        } else if (key.startsWith(`${from}${path.sep}`)) {
          const next = `${to}${key.slice(from.length)}`;
          dbs[next] = dbs[key];
          delete dbs[key];
        }
      }
    };
    const injectedRename = overrides?.renameSync;
    const injectedStat = overrides?.statSync;
    const ioOverride: {
      renameSync: (from: string, to: string) => void;
      statSync?: (filePath: string) => { size: number; dev: number; isDirectory(): boolean };
    } = {
      renameSync: (from: string, to: string) => {
        dbsFollowingRename(from, to);
        if (injectedRename) injectedRename(from, to);
        else fs.renameSync(from, to);
      },
    };
    if (injectedStat) ioOverride.statSync = injectedStat;
    return runAssetStoreMigration({
      userDataPath: userData,
      getStorageBasePath: () => legacyBase,
      locationStore: {
        get: (projectId: string) => locationTable[projectId],
        set: (projectId: string, dir: string) => { locationTable[projectId] = dir; },
        delete: (projectId: string) => { delete locationTable[projectId]; },
        all: () => ({ ...locationTable }),
      },
      sqliteIo: wrappedSqlite,
      io: ioOverride,
      log: () => undefined,
    });
  };

  return { tmp, userData, legacyBase, projectRoot, rootAssets, storeAssets, ttsRuntime, dbs, sqliteIo, writeMarker, ledgerOf, run };
}

describe("runAssetStoreMigration 触发矩阵五分支", () => {
  it("T2a 已迁态(store db 在+root 缺+marker v2)→noop 零动作", async () => {
    const fixture = createFixture();
    fs.renameSync(fixture.rootAssets, fixture.storeAssets);
    fixture.dbs[path.join(fixture.storeAssets, "assets.db")] = fixture.dbs[path.join(fixture.rootAssets, "assets.db")]!;
    delete fixture.dbs[path.join(fixture.rootAssets, "assets.db")];
    fixture.writeMarker({ version: 2, projectId: "pid-1", lastKnownLocation: fixture.projectRoot, ttsMigrated: true, assetsStoreMigrated: true });

    const result = await fixture.run();
    expect(result.status).toBe("noop");
    expect(result.ledgerDir).toBeNull();
  });

  it("T2b 双库并存→选边 store/assets+anomalies 留痕+root/assets 原样保留不 throw", async () => {
    const fixture = createFixture();
    // store/assets 另立一库(不动 root/assets)
    fs.mkdirSync(fixture.storeAssets, { recursive: true });
    fs.writeFileSync(path.join(fixture.storeAssets, "assets.db"), "another-db");

    const result = await fixture.run();
    expect(result.status).toBe("noop");
    // marker 补写 v2
    expect(readAssetHomeMarker(fixture.userData)).toMatchObject({ version: 2, assetsStoreMigrated: true });
    // root/assets 整树原样保留(不 roll 不删)
    expect(fs.existsSync(path.join(fixture.rootAssets, "assets.db"))).toBe(true);
    expect(fs.existsSync(path.join(fixture.rootAssets, "files", "role", "a.png"))).toBe(true);
    // 台账留痕双库并存 anomaly
    const ledger = fixture.ledgerOf(result);
    const anomalies = ledger.anomalies as string[];
    expect(anomalies.some((entry) => entry.includes("双库并存"))).toBe(true);
  });

  it("T2c marker v1+root assets 在场→全量二段(真机即此态)", async () => {
    const fixture = createFixture();
    const result = await fixture.run();
    expect(result.status).toBe("migrated");
    expect(fs.existsSync(path.join(fixture.storeAssets, "assets.db"))).toBe(true);
    expect(fs.existsSync(fixture.rootAssets)).toBe(false);
  });

  it("T2d marker 缺+root assets 在场(一段 P6 后 P7 前断电遗留)→照常搬迁+写 v2 marker 补齐", async () => {
    const fixture = createFixture();
    fixture.writeMarker("NONE");
    const result = await fixture.run();
    expect(result.status).toBe("migrated");
    const marker = readAssetHomeMarker(fixture.userData);
    expect(marker).toMatchObject({ version: 2, projectId: "pid-1", assetsStoreMigrated: true, lastKnownLocation: fixture.projectRoot });
  });

  it("T2e 双缺→noop(一段域负责)", async () => {
    const fixture = createFixture();
    fs.rmSync(fixture.rootAssets, { recursive: true, force: true });
    const result = await fixture.run();
    expect(result.status).toBe("noop");
    expect(result.ledgerDir).toBeNull();
  });

  it("T2b-二跑 双库并存补写 marker v2 后→二跑早退 noop 零台账(不堆积台账目录)", async () => {
    const fixture = createFixture();
    fs.mkdirSync(fixture.storeAssets, { recursive: true });
    fs.writeFileSync(path.join(fixture.storeAssets, "assets.db"), "another-db");

    const first = await fixture.run();
    expect(first.status).toBe("noop");
    expect(readAssetHomeMarker(fixture.userData)?.assetsStoreMigrated).toBe(true);

    const second = await fixture.run();
    expect(second.status).toBe("noop");
    expect(second.ledgerDir).toBeNull();
  });
});

describe("runAssetStoreMigration 全量二段", () => {
  it("T3 整树搬移+文件计数核账+台账备份落 <root>/backups/asset-store-migration-*", async () => {
    const fixture = createFixture();
    const result = await fixture.run();
    expect(result.status).toBe("migrated");

    // 整树一次到位:内部结构零改(files 各区+thumbs+db)
    expect(fs.existsSync(path.join(fixture.storeAssets, "assets.db"))).toBe(true);
    expect(fs.existsSync(path.join(fixture.storeAssets, "files", "role", "a.png"))).toBe(true);
    expect(fs.existsSync(path.join(fixture.storeAssets, "files", "scene", "s.png"))).toBe(true);
    expect(fs.existsSync(path.join(fixture.storeAssets, "thumbs", "role", "a.png"))).toBe(true);
    // 计数核账:搬移前后文件数一致(5 件:3 资产文件+1 缩略图+db)
    const baseline = fixture.ledgerOf(result).baseline as { fileCount: number; dbRows: number };
    expect(baseline.fileCount).toBe(5);
    let count = 0;
    const visit = (dir: string) => {
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (fs.statSync(full).isDirectory()) visit(full);
        else count += 1;
      }
    };
    visit(fixture.storeAssets);
    expect(count).toBe(5);
    // 台账:db 原件+manifest+README 落项目根 backups(根目录铁令,严禁塞 store/)
    expect(result.ledgerDir).toContain(path.join(fixture.projectRoot, "backups", "asset-store-migration-"));
    expect(fs.existsSync(path.join(result.ledgerDir!, "assets.db.orig"))).toBe(true);
    expect(fs.existsSync(path.join(result.ledgerDir!, "files-manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(result.ledgerDir!, "README.md"))).toBe(true);
  });

  it("T4 TTS profiles 前缀改写(root/assets/files→store/assets/files),generations 不动", async () => {
    const fixture = createFixture();
    const result = await fixture.run();
    expect(result.status).toBe("migrated");
    const ttsDb = fixture.dbs[path.join(fixture.ttsRuntime, "tts.sqlite")]!;
    const profile = (ttsDb.tables.profiles ?? [])[0] as { reference_audio_path?: string };
    expect(profile.reference_audio_path).toBe(`${fixture.storeAssets}/files/role/a.wav`);
    const generation = (ttsDb.tables.generations ?? [])[0] as { audio_path?: string };
    expect(generation.audio_path).toBe("/elsewhere/keep.wav");
  });

  it("T5 M10 断链不新增:基线断链(role/missing.png)保持,可解析引用仍可解析", async () => {
    const fixture = createFixture();
    const result = await fixture.run();
    expect(result.status).toBe("migrated");
    expect(fs.existsSync(path.join(fixture.storeAssets, "files", "role", "missing.png"))).toBe(false);
    expect(fs.existsSync(path.join(fixture.storeAssets, "files", "role", "a.png"))).toBe(true);
    const baseline = fixture.ledgerOf(result).baseline as { brokenRefs: string[] };
    expect(baseline.brokenRefs).toContain("role/missing.png");
  });

  it("T6 P2 前中断(renameSync 抛)→旧根原样零提交", async () => {
    const fixture = createFixture();
    const result = await fixture.run({
      renameSync: (from) => {
        if (from === fixture.rootAssets) throw new Error("disk full");
      },
    });
    expect(result.status).toBe("interrupted");
    expect(result.storeCommitted).toBe(false);
    expect(fs.existsSync(path.join(fixture.rootAssets, "assets.db"))).toBe(true);
    expect(fs.existsSync(path.join(fixture.rootAssets, "files", "role", "a.png"))).toBe(true);
    expect(fs.existsSync(fixture.storeAssets)).toBe(false);
  });

  it("T7 P2 后中断(updateRows 抛)→续跑补改写幂等自愈", async () => {
    const fixture = createFixture();
    const first = await fixture.run({ updateRowsFailAt: "profiles" });
    expect(first.status).toBe("interrupted");
    expect(first.storeCommitted).toBe(true);
    // 树已迁,marker 未升级
    expect(fs.existsSync(path.join(fixture.storeAssets, "assets.db"))).toBe(true);
    expect(readAssetHomeMarker(fixture.userData)?.assetsStoreMigrated).not.toBe(true);
    // TTS 前缀悬空(P3 未完成)
    const ttsDbBefore = fixture.dbs[path.join(fixture.ttsRuntime, "tts.sqlite")]!;
    expect(((ttsDbBefore.tables.profiles ?? [])[0] as { reference_audio_path?: string }).reference_audio_path)
      .toBe(`${fixture.rootAssets}/files/role/a.wav`);

    const second = await fixture.run();
    expect(second.status).toBe("migrated");
    expect(readAssetHomeMarker(fixture.userData)).toMatchObject({ version: 2, assetsStoreMigrated: true });
    const ttsDb = fixture.dbs[path.join(fixture.ttsRuntime, "tts.sqlite")]!;
    expect(((ttsDb.tables.profiles ?? [])[0] as { reference_audio_path?: string }).reference_audio_path)
      .toBe(`${fixture.storeAssets}/files/role/a.wav`);
  });

  it("T7b【补刀·heal 链可重入】连续两次中断(P3 主路径失败→heal 再失败)→第三跑 heal 收敛→第四跑终态 noop(二跑幂等全链)", async () => {
    const fixture = createFixture();
    // run1:主路径 P3 改写失败(P2 已过=store 已提交)
    const run1 = await fixture.run({ updateRowsFailAt: "profiles" });
    expect(run1.status).toBe("interrupted");
    expect(run1.storeCommitted).toBe(true);
    // run2:a' 分支 heal 的 rewrite 再失败(可重入验证)
    const run2 = await fixture.run({ updateRowsFailAt: "profiles" });
    expect(run2.status).toBe("interrupted");
    expect(run2.storeCommitted).toBe(true);
    // run3:heal 收敛
    const run3 = await fixture.run();
    expect(run3.status).toBe("migrated");
    expect(readAssetHomeMarker(fixture.userData)).toMatchObject({ version: 2, assetsStoreMigrated: true });
    const ttsDb = fixture.dbs[path.join(fixture.ttsRuntime, "tts.sqlite")]!;
    expect(((ttsDb.tables.profiles ?? [])[0] as { reference_audio_path?: string }).reference_audio_path)
      .toBe(`${fixture.storeAssets}/files/role/a.wav`);
    // run4:终态幂等(a 分支 marker v2 早退,零台账)
    const run4 = await fixture.run();
    expect(run4.status).toBe("noop");
    expect(run4.ledgerDir).toBeNull();
  });

  it("T7c【补刀·URL 改写批内 crash 半态】TTS profiles 半改写(一行旧前缀+一行已新前缀)→heal 收敛:旧归零+全量新前缀+marker v2(heal 不做新前缀==基线复核=批内半态宽容设计)", async () => {
    const fixture = createFixture();
    // 直造 P2 已过+P3 批内 crash 半态:整树已迁+marker 仍 v1+profiles 一行已改一行未改
    fs.renameSync(fixture.rootAssets, fixture.storeAssets);
    fixture.dbs[path.join(fixture.storeAssets, "assets.db")] = fixture.dbs[path.join(fixture.rootAssets, "assets.db")]!;
    delete fixture.dbs[path.join(fixture.rootAssets, "assets.db")];
    fixture.dbs[path.join(fixture.ttsRuntime, "tts.sqlite")] = {
      tables: {
        profiles: [
          { __rowid__: 1, id: "p1", reference_audio_path: `${fixture.rootAssets}/files/role/a.wav` },
          { __rowid__: 2, id: "p2", reference_audio_path: `${fixture.storeAssets}/files/role/b.wav` },
        ],
        generations: [],
      },
    };

    const result = await fixture.run();
    expect(result.status).toBe("migrated");
    expect(result.reason).toContain("续迁");
    const profiles = fixture.dbs[path.join(fixture.ttsRuntime, "tts.sqlite")]!.tables.profiles!;
    expect((profiles[0] as { reference_audio_path?: string }).reference_audio_path)
      .toBe(`${fixture.storeAssets}/files/role/a.wav`);
    expect((profiles[1] as { reference_audio_path?: string }).reference_audio_path)
      .toBe(`${fixture.storeAssets}/files/role/b.wav`);
    expect(readAssetHomeMarker(fixture.userData)).toMatchObject({ version: 2, assetsStoreMigrated: true });
  });

  it("T7d【补刀·c 分支防御核账】未迁移态但 TTS 已含 store 前缀行(异态)→P5『新前缀计数失守』fail-closed interrupted+storeCommitted:true(不哑过)", async () => {
    const fixture = createFixture();
    // c 分支=root assets 在场;TTS 一行已 store 前缀(人工/异态)→基线旧前缀=1,
    // P3 改写后新前缀=2≠基线 1 → 核账炸(主路径严格复核与 heal 宽容相对)。
    fixture.dbs[path.join(fixture.ttsRuntime, "tts.sqlite")] = {
      tables: {
        profiles: [
          { __rowid__: 1, id: "p1", reference_audio_path: `${fixture.rootAssets}/files/role/a.wav` },
          { __rowid__: 2, id: "p2", reference_audio_path: `${fixture.storeAssets}/files/role/b.wav` },
        ],
        generations: [],
      },
    };

    const result = await fixture.run();
    expect(result.status).toBe("interrupted");
    expect(result.storeCommitted).toBe(true);
    expect(String(result.reason)).toContain("新前缀计数失守");
    // 树已迁不回滚(P2 后语义)
    expect(fs.existsSync(path.join(fixture.storeAssets, "assets.db"))).toBe(true);
  });

  it("T8 二次启动 noop(终态幂等)", async () => {
    const fixture = createFixture();
    const first = await fixture.run();
    expect(first.status).toBe("migrated");
    const second = await fixture.run();
    expect(second.status).toBe("noop");
    expect(second.ledgerDir).toBeNull();
  });

  it("T9 marker v1→v2 字段保全(ttsMigrated/projectId/lastKnownLocation 不丢,ledgerDir 指二段台账)", async () => {
    const fixture = createFixture();
    const result = await fixture.run();
    expect(result.status).toBe("migrated");
    const marker = readAssetHomeMarker(fixture.userData);
    expect(marker).toMatchObject({
      version: 2,
      projectId: "pid-1",
      lastKnownLocation: fixture.projectRoot,
      ttsMigrated: true,
      assetsStoreMigrated: true,
    });
    expect(marker?.ledgerDir).toBe(result.ledgerDir);
  });

  it("T10 异卷拒迁(dev 不等 fail-closed,零提交)", async () => {
    const fixture = createFixture();
    const result = await fixture.run({
      statSync: (filePath) => (
        filePath === fixture.rootAssets
          ? { size: 1, dev: 111, isDirectory: () => true }
          : { size: 1, dev: 222, isDirectory: () => true }
      ),
    });
    expect(result.status).toBe("interrupted");
    expect(result.storeCommitted).toBe(false);
    expect(fs.existsSync(path.join(fixture.rootAssets, "assets.db"))).toBe(true);
    expect(fs.existsSync(fixture.storeAssets)).toBe(false);
  });

  it("P8 善后:旧家 App 家 MIGRATED-README.txt 在场才追加新根指引(append 不重写)", async () => {
    const fixture = createFixture();
    const legacyReadme = path.join(fixture.legacyBase, "assets", "MIGRATED-README.txt");
    fs.mkdirSync(path.dirname(legacyReadme), { recursive: true });
    fs.writeFileSync(legacyReadme, "资产库已于 1015 迁至旧根\n", "utf-8");

    const first = await fixture.run();
    expect(first.status).toBe("migrated");
    const appended = fs.readFileSync(legacyReadme, "utf-8");
    expect(appended).toContain("1015 迁至旧根");
    expect(appended).toContain(fixture.storeAssets);

    // 二次启动不重复追加(内容幂等)
    await fixture.run();
    expect(fs.readFileSync(legacyReadme, "utf-8")).toBe(appended);
  });
});
