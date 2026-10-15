import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readAssetHomeMarker } from "./asset-home";
import { defaultSqliteIoForTest, runAssetHomeMigration } from "./asset-home-migration";

/**
 * 资产归域启动期迁移例程测试(1015)。
 * 文件搬移=真实临时目录 rename;sqlite 访问=注入 fake(语义化 io,不解析 SQL);
 * 锚:计划 testPlan【新增】asset-home-migration.test.ts ①-⑰ + migrationDesign 全语义。
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
  legacyAssets: string;
  newAssets: string;
  legacyTtsRuntime: string;
  newTtsRuntime: string;
  dbs: Record<string, FakeDb>;
  sqliteIo: FakeSqliteIo;
  ledgerOf: (run: { ledgerDir: string | null }) => Record<string, unknown>;
  run: (overrides?: RunOverrides) => Promise<Awaited<ReturnType<typeof runAssetHomeMigration>>>;
};

function createFixture(options?: { legacyForm?: "flat" | "store" }): Fixture {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-asset-migration-"));
  const userData = path.join(tmp, "userData");
  const legacyBase = path.join(tmp, "legacy");
  const projectRoot = path.join(tmp, "MA");
  // 1016 双源探测:旧家 flat 形(≤1015 机器)优先,store 形(新装机未绑项目期
  // 经新 fallback 写入)兜底;新根一段落点=项目根 store/assets(一次到位)。
  const legacyAssets = options?.legacyForm === "store"
    ? path.join(legacyBase, "store", "assets")
    : path.join(legacyBase, "assets");
  const newAssets = path.join(projectRoot, "store", "assets");
  const legacyTtsRuntime = path.join(legacyBase, "TTS", "runtime");
  const newTtsRuntime = path.join(projectRoot, "TTS", "runtime");
  fs.mkdirSync(userData, { recursive: true });

  // 旧根资产树:files 五区 + thumbs + assets.db 占位
  for (const zone of ["role", "scene", "tool", "clip", "audio"]) {
    fs.mkdirSync(path.join(legacyAssets, "files", zone), { recursive: true });
  }
  fs.mkdirSync(path.join(legacyAssets, "thumbs", "role"), { recursive: true });
  fs.writeFileSync(path.join(legacyAssets, "files", "role", "a.png"), "role-a");
  fs.writeFileSync(path.join(legacyAssets, "files", "role", "b.png"), "role-b");
  fs.writeFileSync(path.join(legacyAssets, "files", "scene", "s.png"), "scene-s");
  fs.writeFileSync(path.join(legacyAssets, "files", "tool", "t.png"), "tool-t");
  fs.writeFileSync(path.join(legacyAssets, "files", "audio", "au.wav"), "audio-au");
  fs.writeFileSync(path.join(legacyAssets, "thumbs", "role", "a.png"), "thumb-a");
  fs.writeFileSync(path.join(legacyAssets, "assets.db"), "asset-db-original");

  // 旧家 TTS 三件
  fs.mkdirSync(path.join(legacyTtsRuntime, "audio"), { recursive: true });
  fs.writeFileSync(path.join(legacyTtsRuntime, "tts.sqlite"), "tts-db-original");
  fs.writeFileSync(path.join(legacyTtsRuntime, "config.json"), "{}");
  fs.writeFileSync(path.join(legacyTtsRuntime, "audio", "g1.wav"), "g1");
  fs.writeFileSync(path.join(legacyTtsRuntime, "audio", "g2.wav"), "g2");

  // 项目根:store 引用(含 1 处基线断链 role/missing.png)+ 新根孤品(在位 DB 零引用)
  fs.mkdirSync(path.join(projectRoot, "store"), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, "store", "main.json"),
    JSON.stringify({
      refs: ["asset-file://role/a.png", "asset-file://scene/s.png", "asset-file://role/missing.png"],
    }),
    "utf-8",
  );
  fs.mkdirSync(path.join(newAssets, "files", "role"), { recursive: true });
  fs.writeFileSync(path.join(newAssets, "files", "role", "orphan.png"), "orphan");

  const locationTable: Record<string, string> = { "pid-1": projectRoot };
  const dbs: Record<string, FakeDb> = {};
  dbs[path.join(legacyAssets, "assets.db")] = {
    tables: {
      assets: [
        { __rowid__: 1, id: "a1", type: "role", name: "甲", filePath: "role/a.png" },
        { __rowid__: 2, id: "a2", type: "scene", name: "乙", filePath: "scene/s.png" },
      ],
    },
  };
  dbs[path.join(legacyTtsRuntime, "tts.sqlite")] = {
    tables: {
      profiles: [
        { __rowid__: 1, id: "p1", name: "音色1" },
        { __rowid__: 2, id: "p2", name: "音色2" },
      ],
      generations: [
        { __rowid__: 1, id: "g1", audioPath: `${legacyTtsRuntime}/audio/g1.wav` },
        { __rowid__: 2, id: "g2", audioPath: `${legacyTtsRuntime}/audio/g2.wav` },
        { __rowid__: 3, id: "g3", audioPath: `${legacyBase}/tts-runtime/audio/g3.wav` },
      ],
    },
  };

  const sqliteIo = fakeSqliteIo(dbs);

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
          updateRows: async (dbPath, table, updates) => {
            if (table === overrides.updateRowsFailAt) throw new Error("sqlite write failed");
            return effectiveSqlite.updateRows(dbPath, table, updates);
          },
        }
      : effectiveSqlite;
    // rename 时 fake 库 key 跟随文件移动(模拟真实 sqlite 文件随 rename 迁家)
    const dbsFollowingRename = (from: string, to: string) => {
      if (dbs[from]) {
        dbs[to] = dbs[from];
        delete dbs[from];
      }
    };
    const injectedRename = overrides?.renameSync;
    const renameSync = (from: string, to: string) => {
      dbsFollowingRename(from, to);
      if (injectedRename) injectedRename(from, to);
      else fs.renameSync(from, to);
    };
    return runAssetHomeMigration({
      userDataPath: userData,
      getStorageBasePath: () => legacyBase,
      locationStore: {
        get: (projectId: string) => locationTable[projectId],
        set: (projectId: string, dir: string) => { locationTable[projectId] = dir; },
        delete: (projectId: string) => { delete locationTable[projectId]; },
        all: () => ({ ...locationTable }),
      },
      sqliteIo: wrappedSqlite,
      io: { renameSync },
      log: () => undefined,
    });
  };

  return { tmp, userData, legacyBase, projectRoot, legacyAssets, newAssets, legacyTtsRuntime, newTtsRuntime, dbs, sqliteIo, ledgerOf, run };
}

describe("runAssetHomeMigration 全量迁移(真未迁移态)", () => {
  it("①预检失败(文件名冲突异 size)→零提交+台账:assets.db 留旧根、新根无 db、interrupted:true", async () => {
    const fixture = createFixture();
    fs.writeFileSync(path.join(fixture.newAssets, "files", "role", "a.png"), "conflicting-different-size");

    const result = await fixture.run();
    expect(result.status).toBe("interrupted");

    expect(fs.existsSync(path.join(fixture.legacyAssets, "assets.db"))).toBe(true);
    expect(fs.existsSync(path.join(fixture.newAssets, "assets.db"))).toBe(false);
    expect(fixture.ledgerOf(result).interrupted).toBe(true);
  });

  it("②【B2 顺序】提交点序:files/thumbs→assets.db→TTS audio/config→tts.sqlite→改写→marker(落 userData)→善后", async () => {
    const fixture = createFixture();
    const order: string[] = [];
    const realRenameSync = fs.renameSync;
    const result = await fixture.run({
      renameSync: (from, to) => {
        if (from.endsWith("assets.db")) order.push("commit:assets.db");
        else if (from.endsWith("tts.sqlite")) order.push("commit:tts.sqlite");
        else if (path.basename(to) === "config.json" && to.includes(`TTS${path.sep}runtime`)) order.push("tts:config");
        else if (to.includes(`TTS${path.sep}runtime${path.sep}audio${path.sep}`)) order.push("tts:audio");
        else order.push("file");
        realRenameSync(from, to);
      },
    });
    expect(result.status).toBe("migrated");
    const fileIndex = order.indexOf("file");
    const dbCommit = order.indexOf("commit:assets.db");
    const ttsAudio = order.indexOf("tts:audio");
    const ttsConfig = order.indexOf("tts:config");
    const ttsCommit = order.indexOf("commit:tts.sqlite");
    expect(fileIndex).toBeGreaterThan(-1);
    expect(dbCommit).toBeGreaterThan(fileIndex);
    expect(ttsAudio).toBeGreaterThan(dbCommit);
    expect(ttsConfig).toBeGreaterThan(dbCommit);
    expect(ttsCommit).toBeGreaterThan(ttsAudio);
    expect(ttsCommit).toBeGreaterThan(ttsConfig);

    const marker = readAssetHomeMarker(fixture.userData);
    expect(marker?.ttsMigrated).toBe(true);
    expect(marker?.lastKnownLocation).toBe(fixture.projectRoot);
    // 1016:一段 marker 写点升 v2+assetsStoreMigrated(一段落点=store/assets 一次到位)
    expect(marker?.version).toBe(2);
    expect(marker?.assetsStoreMigrated).toBe(true);
  });

  it("③【B2 失败语义】P4′(sqlite 改写)失败→资产域已就位不回落,重跑只续 TTS 并写 marker", async () => {
    const fixture = createFixture();
    const first = await fixture.run({ updateRowsFailAt: "profiles" });
    expect(first.status).toBe("interrupted");
    // 资产域已提交(P6 后不回落);失败分级语义:P6 后中断须自报 assetCommitted=true
    // (补刀:此前 catch 恒报「资产未提交,回落旧根」——P6 后是撒谎,误导人工排查)
    expect(first.assetCommitted).toBe(true);
    expect(fs.existsSync(path.join(fixture.newAssets, "assets.db"))).toBe(true);
    expect(fs.existsSync(path.join(fixture.legacyAssets, "assets.db"))).toBe(false);
    expect(readAssetHomeMarker(fixture.userData)?.ttsMigrated).toBeFalsy();

    const second = await fixture.run();
    expect(second.status).toBe("migrated");
    expect(readAssetHomeMarker(fixture.userData)?.ttsMigrated).toBe(true);
  });

  it("⑥【B1 断电窗口】assets.db 已 rename+marker 未写→重跑自愈补 marker,不在旧根建库;files 半迁→续迁", async () => {
    const fixture = createFixture();
    fs.renameSync(
      path.join(fixture.legacyAssets, "assets.db"),
      path.join(fixture.newAssets, "assets.db"),
    );
    fs.renameSync(
      path.join(fixture.legacyAssets, "files", "role", "a.png"),
      path.join(fixture.newAssets, "files", "role", "a.png"),
    );

    const result = await fixture.run();
    expect(result.status).toBe("migrated");
    expect(fs.existsSync(path.join(fixture.legacyAssets, "files", "role", "b.png"))).toBe(false);
    expect(fs.existsSync(path.join(fixture.newAssets, "files", "role", "b.png"))).toBe(true);
    expect(readAssetHomeMarker(fixture.userData)?.ttsMigrated).toBe(true);
    expect(fs.existsSync(path.join(fixture.legacyAssets, "assets.db"))).toBe(false);
  });

  it("⑦核账失败(DB filePath 指向缺失文件)→assets.db 仍在旧根+interrupted:true", async () => {
    const fixture = createFixture();
    fixture.dbs[path.join(fixture.legacyAssets, "assets.db")] = {
      tables: {
        assets: [
          { __rowid__: 1, id: "a1", type: "role", name: "甲", filePath: "role/a.png" },
          { __rowid__: 2, id: "a2", type: "scene", name: "乙", filePath: "scene/s2.png" },
        ],
      },
    };

    const result = await fixture.run();
    expect(result.status).toBe("interrupted");
    // 失败分级语义:P6 前中断=资产未提交,自报 assetCommitted=false(真回落旧根)
    expect(result.assetCommitted).toBe(false);
    expect(fs.existsSync(path.join(fixture.legacyAssets, "assets.db"))).toBe(true);
    expect(fs.existsSync(path.join(fixture.newAssets, "assets.db"))).toBe(false);
    expect(fixture.ledgerOf(result).interrupted).toBe(true);
  });

  it("⑧【M3/M10】基线内断链过(role/missing.png);迁移期间文件集漂移(scene 文件被外部删除)→并集核账中止不提交", async () => {
    const fixture = createFixture();
    const ok = await fixture.run();
    expect(ok.status).toBe("migrated");

    const drifting = createFixture();
    let dropped = false;
    const realRename = fs.renameSync;
    const bad = await drifting.run({
      // 注入:首个文件搬移时外部删除 scene/s.png(模拟迁移期间文件集漂移→新断链+并集计数失守)
      renameSync: (from, to) => {
        realRename(from, to);
        if (!dropped) {
          dropped = true;
          fs.rmSync(path.join(drifting.legacyAssets, "files", "scene", "s.png"));
        }
      },
    });
    expect(bad.status).toBe("interrupted");
    expect(fs.existsSync(path.join(drifting.legacyAssets, "assets.db"))).toBe(true);
  });

  it("⑨【M6】per-file 三态:目标无→rename;同 size→跳过(不覆盖新根,旧根副本留档);异 size→冲突中止", async () => {
    const fixture = createFixture();
    fs.writeFileSync(path.join(fixture.newAssets, "files", "role", "b.png"), "role-b");
    const result = await fixture.run();
    expect(result.status).toBe("migrated");
    // 同 size 跳过:新根 b.png 未被旧根覆盖(原内容原样)
    expect(fs.readFileSync(path.join(fixture.newAssets, "files", "role", "b.png"), "utf-8")).toBe("role-b");
    const files = fixture.ledgerOf(result).files as { skippedSameSize: number };
    expect(files.skippedSameSize).toBeGreaterThan(0);
    // 旧根副本未丢失:善后进 rolls 留档(绝不删)
    const rollFiles = fs.readdirSync(path.join(result.ledgerDir!, "rolls"), { recursive: true }).map(String);
    expect(rollFiles.some((name) => name.includes("b.png"))).toBe(true);
  });

  it("⑩【M4】generations 双前缀计数入台账+置 NULL,重跑幂等 noop", async () => {
    const fixture = createFixture();
    const first = await fixture.run();
    expect(first.status).toBe("migrated");
    const generations = fixture.ledgerOf(first).generations as { ttsRuntimeAudio: number; legacyTtsRuntimeAudio: number };
    expect(generations.ttsRuntimeAudio).toBe(2);
    expect(generations.legacyTtsRuntimeAudio).toBe(1);

    const newDb = fixture.dbs[path.join(fixture.newTtsRuntime, "tts.sqlite")]!;
    for (const row of newDb.tables.generations ?? []) {
      expect(row.audioPath).toBeNull();
    }

    const second = await fixture.run();
    expect(second.status).toBe("noop");
  });

  it("⑪profiles 中文路径前缀改写:旧家绝对前缀→新家,中文文件名保留", async () => {
    const fixture = createFixture();
    const legacyTts = path.join(fixture.legacyTtsRuntime, "tts.sqlite");
    fixture.dbs[legacyTts] = {
      tables: {
        profiles: [
          { __rowid__: 1, id: "p1", name: "道劫主角", refAudio: `${fixture.legacyTtsRuntime}/audio/主角参考.wav` },
        ],
        generations: [],
      },
    };

    const result = await fixture.run();
    expect(result.status).toBe("migrated");
    const newDb = fixture.dbs[path.join(fixture.newTtsRuntime, "tts.sqlite")]!;
    const profile = (newDb.tables.profiles ?? [])[0] as { refAudio?: string };
    expect(profile.refAudio).toBe(`${fixture.newTtsRuntime}/audio/主角参考.wav`);
  });

  it("⑬【M17】旧 assets 壳含未知顶层文件(非白名单)→移台账不删", async () => {
    const fixture = createFixture();
    // 顶层未知件:P2 只搬 files/thumbs,顶层杂件留给善后甄别
    fs.writeFileSync(path.join(fixture.legacyAssets, "遗留配置.ini"), "unknown");

    const result = await fixture.run();
    expect(result.status).toBe("migrated");
    const rolls = (fixture.ledgerOf(result).rolls as Array<{ reason: string }>) ?? [];
    expect(rolls.some((roll) => roll.reason.includes("未知文件"))).toBe(true);
    expect(fs.existsSync(path.join(result.ledgerDir!, "rolls"))).toBe(true);
    const rollFiles = fs.readdirSync(path.join(result.ledgerDir!, "rolls"), { recursive: true }).map(String);
    expect(rollFiles.some((name) => name.includes("遗留配置.ini"))).toBe(true);
  });

  it("⑮【M16】旧根警示文件 MIGRATED-README.txt 写入", async () => {
    const fixture = createFixture();
    const result = await fixture.run();
    expect(result.status).toBe("migrated");
    expect(fs.existsSync(path.join(fixture.legacyAssets, "MIGRATED-README.txt"))).toBe(true);
  });

  it("⑯profiles id 快照入台账", async () => {
    const fixture = createFixture();
    const result = await fixture.run();
    const baseline = fixture.ledgerOf(result).baseline as { profiles: { ids: string[] } };
    expect(baseline.profiles.ids).toEqual(expect.arrayContaining(["p1", "p2"]));
  });

  it("⑰【m-3】分步耗时入台账(phases[].ms 数值)", async () => {
    const fixture = createFixture();
    const result = await fixture.run();
    const phases = fixture.ledgerOf(result).phases as Array<{ name: string; ms: number }>;
    expect(phases.length).toBeGreaterThan(3);
    for (const phase of phases) {
      expect(typeof phase.ms).toBe("number");
      expect(phase.ms).toBeGreaterThanOrEqual(0);
    }
  });

  it("P1 备份:两 db 原件 copy 进 MA/backups/asset-migration-<ts>/(严禁塞 store/)", async () => {
    const fixture = createFixture();
    const result = await fixture.run();
    expect(result.ledgerDir).toContain(path.join(fixture.projectRoot, "backups"));
    expect(result.ledgerDir).not.toContain(`${path.sep}store${path.sep}`);
    expect(fs.existsSync(path.join(result.ledgerDir!, "assets.db.orig"))).toBe(true);
    expect(fs.existsSync(path.join(result.ledgerDir!, "tts.sqlite.orig"))).toBe(true);
  });

  it("【计划存量处置⑤】config.json.bak-model-dir-unify 等备份件→善后移台账留档,不删不落新根", async () => {
    const fixture = createFixture();
    fs.writeFileSync(path.join(fixture.legacyTtsRuntime, "config.json.bak-model-dir-unify"), "bak");
    const result = await fixture.run();
    expect(result.status).toBe("migrated");
    // 旧家不残留
    expect(fs.existsSync(path.join(fixture.legacyTtsRuntime, "config.json.bak-model-dir-unify"))).toBe(false);
    // 新根不混入备份件
    expect(fs.existsSync(path.join(fixture.newTtsRuntime, "config.json.bak-model-dir-unify"))).toBe(false);
    // 台账 rolls 留档在场
    const ledger = fixture.ledgerOf(result);
    const rolls = ledger.rolls as Array<{ from: string; to: string; reason: string }>;
    const rolled = rolls.find((entry) => entry.from.endsWith("config.json.bak-model-dir-unify"));
    expect(rolled).toBeTruthy();
    expect(fs.existsSync(rolled!.to)).toBe(true);
  });
});

describe("runAssetHomeMigration 分段续迁与甄别", () => {
  it("③资产迁+TTS 未迁→只跑 TTS 段,旧家 tts.sqlite 到新家", async () => {
    const fixture = createFixture();
    fs.renameSync(path.join(fixture.legacyAssets, "assets.db"), path.join(fixture.newAssets, "assets.db"));
    fs.rmSync(path.join(fixture.legacyAssets, "files", "role", "b.png"));

    const result = await fixture.run();
    expect(result.status).toBe("migrated");
    expect(fs.existsSync(path.join(fixture.newTtsRuntime, "tts.sqlite"))).toBe(true);
    expect(fs.existsSync(path.join(fixture.legacyTtsRuntime, "tts.sqlite"))).toBe(false);
    expect(readAssetHomeMarker(fixture.userData)?.ttsMigrated).toBe(true);
  });

  it("④【B3 甄别】新根 tts.sqlite 含全部基线 id(真库半态)→幂等改写+写 marker", async () => {
    const fixture = createFixture();
    fs.renameSync(path.join(fixture.legacyAssets, "assets.db"), path.join(fixture.newAssets, "assets.db"));
    fs.mkdirSync(fixture.newTtsRuntime, { recursive: true });
    fs.renameSync(path.join(fixture.legacyTtsRuntime, "tts.sqlite"), path.join(fixture.newTtsRuntime, "tts.sqlite"));
    fixture.dbs[path.join(fixture.newTtsRuntime, "tts.sqlite")] = fixture.dbs[path.join(fixture.legacyTtsRuntime, "tts.sqlite")]!;

    const result = await fixture.run();
    expect(result.status).toBe("migrated");
    expect(readAssetHomeMarker(fixture.userData)?.ttsMigrated).toBe(true);
  });

  it("④【B3 甄别】新根库缺基线 id(分叉空库)→移台账留档+旧家真库 rename 补位+改写", async () => {
    const fixture = createFixture();
    fs.renameSync(path.join(fixture.legacyAssets, "assets.db"), path.join(fixture.newAssets, "assets.db"));
    fs.mkdirSync(fixture.newTtsRuntime, { recursive: true });
    fs.writeFileSync(path.join(fixture.newTtsRuntime, "tts.sqlite"), "forked-empty-db");
    fixture.dbs[path.join(fixture.newTtsRuntime, "tts.sqlite")] = {
      tables: { profiles: [{ __rowid__: 1, id: "fork-x", name: "分叉" }] },
    };

    const result = await fixture.run();
    expect(result.status).toBe("migrated");
    const rolls = (fixture.ledgerOf(result).rolls as Array<{ reason: string }>) ?? [];
    expect(rolls.some((roll) => roll.reason.includes("分叉"))).toBe(true);
    const newDb = fixture.dbs[path.join(fixture.newTtsRuntime, "tts.sqlite")]!;
    expect((newDb.tables.profiles ?? []).map((row) => row.id)).toEqual(expect.arrayContaining(["p1", "p2"]));
    expect(readAssetHomeMarker(fixture.userData)?.ttsMigrated).toBe(true);
  });

  it("⑤【B2/B3 防线】新根已提交+旧家再现 tts.sqlite→旧家件移台账留档(不覆盖不清删)", async () => {
    const fixture = createFixture();
    const first = await fixture.run();
    expect(first.status).toBe("migrated");

    fs.writeFileSync(path.join(fixture.legacyTtsRuntime, "tts.sqlite"), "reappeared");

    const second = await fixture.run();
    expect(second.status).toBe("noop");
    const rolls = (fixture.ledgerOf(second).rolls as Array<{ reason: string }>) ?? [];
    expect(rolls.some((roll) => roll.reason.includes("再现"))).toBe(true);
    expect(fs.existsSync(path.join(fixture.legacyTtsRuntime, "tts.sqlite"))).toBe(false);
    expect(fixture.dbs[path.join(fixture.newTtsRuntime, "tts.sqlite")]).toBeDefined();
  });

  it("⑫【M11】无残留→noop;旧域再现残留(顶层杂件)→补善后移台账", async () => {
    const fixture = createFixture();
    const first = await fixture.run();
    expect(first.status).toBe("migrated");

    const second = await fixture.run();
    expect(second.status).toBe("noop");

    fs.writeFileSync(path.join(fixture.legacyAssets, "residue-config.json"), "residue");
    const third = await fixture.run();
    expect(third.status).toBe("noop");
    const rolls = (fixture.ledgerOf(third).rolls as Array<{ reason: string }>) ?? [];
    expect(rolls.some((roll) => roll.reason.includes("未知文件") || roll.reason.includes("残留"))).toBe(true);
  });

  it("⑭【M14】旧家 audio/ 含 wav(失败会话新生成)→整目录移台账留档不删", async () => {
    const fixture = createFixture();
    await fixture.run();
    fs.mkdirSync(path.join(fixture.legacyTtsRuntime, "audio"), { recursive: true });
    fs.writeFileSync(path.join(fixture.legacyTtsRuntime, "audio", "fresh.wav"), "new");
    fs.writeFileSync(path.join(fixture.legacyTtsRuntime, "tts.sqlite"), "reappeared-too");

    const second = await fixture.run();
    const rolls = (fixture.ledgerOf(second).rolls as Array<{ reason: string }>) ?? [];
    expect(rolls.some((roll) => roll.reason.includes("新生成") || roll.reason.includes("audio"))).toBe(true);
    const rollFiles = fs.readdirSync(path.join(second.ledgerDir!, "rolls"), { recursive: true }).map(String);
    expect(rollFiles.some((name) => name.includes("fresh.wav"))).toBe(true);
  });

  it("⑥异常态:多项目位置→status error 不迁移不建库", async () => {
    const fixture = createFixture();
    const projectRoot2 = path.join(fixture.tmp, "MA2");
    fs.mkdirSync(projectRoot2, { recursive: true });
    const result = await runAssetHomeMigration({
      userDataPath: fixture.userData,
      getStorageBasePath: () => fixture.legacyBase,
      locationStore: {
        get: (pid: string) => (pid === "pid-1" ? fixture.projectRoot : projectRoot2),
        set: () => undefined,
        delete: () => undefined,
        all: () => ({ "pid-1": fixture.projectRoot, "pid-2": projectRoot2 }),
      },
      sqliteIo: fixture.sqliteIo,
      log: () => undefined,
    });
    expect(result.status).toBe("error");
    expect(fs.existsSync(path.join(fixture.newAssets, "assets.db"))).toBe(false);
  });
});

describe("1016 双源 legacy 探测与 prefixMappings 双映射", () => {
  it("T-matrix1【补刀·一段矩阵】marker v2 在场+双侧资产 db 全缺(App 家无+新根无)→一段 noop 不触碰 marker(ORPHANED 判定权留 resolve/根健康闸,例程不越权改写失联证据)", async () => {
    const fixture = createFixture();
    // 造态:App 家旧根整树清空(1015 已善后终态)+新根 store/assets 无 db
    fs.rmSync(fixture.legacyAssets, { recursive: true, force: true });
    fs.rmSync(fixture.newAssets, { recursive: true, force: true });
    // marker v2 在场(宣称已迁 store/assets——与文件真相矛盾=失联态)
    fs.writeFileSync(
      path.join(fixture.userData, "asset-home.json"),
      JSON.stringify({
        version: 2,
        projectId: "pid-1",
        lastKnownLocation: fixture.projectRoot,
        ttsMigrated: true,
        assetsStoreMigrated: true,
        ledgerDir: "/tmp/stage-ledger",
      }),
      "utf-8",
    );

    const result = await fixture.run();
    expect(result.status).toBe("noop");
    // marker 原样未被触碰(读回等值)
    expect(JSON.parse(fs.readFileSync(path.join(fixture.userData, "asset-home.json"), "utf-8"))).toEqual({
      version: 2,
      projectId: "pid-1",
      lastKnownLocation: fixture.projectRoot,
      ttsMigrated: true,
      assetsStoreMigrated: true,
      ledgerDir: "/tmp/stage-ledger",
    });
  });

  it("T-matrix2【补刀·半态】marker v1 在场+新根 store/assets db 在+App 家已清(二段已跑但 marker 未升)→一段续迁段按 ttsMigrated 补善后,不重迁不建库", async () => {
    const fixture = createFixture();
    // 造态:资产已在项目根 store/assets(二段 c 跑完)+marker 仍 v1
    fs.mkdirSync(fixture.newAssets, { recursive: true });
    fs.renameSync(path.join(fixture.legacyAssets, "assets.db"), path.join(fixture.newAssets, "assets.db"));
    fixture.dbs[path.join(fixture.newAssets, "assets.db")] = fixture.dbs[path.join(fixture.legacyAssets, "assets.db")]!;
    delete fixture.dbs[path.join(fixture.legacyAssets, "assets.db")];
    fs.writeFileSync(
      path.join(fixture.userData, "asset-home.json"),
      JSON.stringify({ version: 1, projectId: "pid-1", lastKnownLocation: fixture.projectRoot, ttsMigrated: true }),
      "utf-8",
    );

    const result = await fixture.run();
    // 一段不炸不重迁:续迁段 resume-files(旧家空)+ttsMigrated=true 只补善后
    expect(result.status).toBe("noop");
    expect(fs.existsSync(path.join(fixture.newAssets, "assets.db"))).toBe(true);
  });

  it("T11a store 形旧家(legacyBase/store/assets 有 db)→flat 缺位时兜底命中,资产迁入项目域 store/assets", async () => {
    const fixture = createFixture({ legacyForm: "store" });
    const result = await fixture.run();
    expect(result.status).toBe("migrated");
    expect(fs.existsSync(path.join(fixture.newAssets, "assets.db"))).toBe(true);
    expect(fs.existsSync(path.join(fixture.newAssets, "files", "role", "a.png"))).toBe(true);
    // 旧家 store 形壳已善后(MIGRATED-README 留守)
    expect(fs.existsSync(path.join(fixture.legacyAssets, "MIGRATED-README.txt"))).toBe(true);
    expect(readAssetHomeMarker(fixture.userData)).toMatchObject({ version: 2, assetsStoreMigrated: true });
  });

  it("T11b store 形旧家命中时 TTS profiles 指向旧家 store 形资产前缀的行被正确改写(不漏改不断链)", async () => {
    const fixture = createFixture({ legacyForm: "store" });
    const legacyTts = path.join(fixture.legacyTtsRuntime, "tts.sqlite");
    fixture.dbs[legacyTts] = {
      tables: {
        profiles: [
          { __rowid__: 1, id: "p1", name: "音色1", refAudio: `${fixture.legacyAssets}/files/role/主角参考.wav` },
        ],
        generations: [],
      },
    };

    const result = await fixture.run();
    expect(result.status).toBe("migrated");
    const newDb = fixture.dbs[path.join(fixture.newTtsRuntime, "tts.sqlite")]!;
    const profile = (newDb.tables.profiles ?? [])[0] as { refAudio?: string };
    expect(profile.refAudio).toBe(`${fixture.newAssets}/files/role/主角参考.wav`);
  });

  it("T11c 双源并存(旧家 flat 与 store 形都有 db)→fail-closed 不猜边不迁移", async () => {
    const fixture = createFixture();
    // 旧家 flat 已在场(fixture 自建),再造 store 形旧家 db
    fs.mkdirSync(path.join(fixture.legacyBase, "store", "assets"), { recursive: true });
    fs.writeFileSync(path.join(fixture.legacyBase, "store", "assets", "assets.db"), "another-db");

    const result = await fixture.run();
    expect(result.status).toBe("error");
    expect(fs.existsSync(path.join(fixture.newAssets, "assets.db"))).toBe(false);
    // 两侧原样保留
    expect(fs.existsSync(path.join(fixture.legacyBase, "assets", "assets.db"))).toBe(true);
    expect(fs.existsSync(path.join(fixture.legacyBase, "store", "assets", "assets.db"))).toBe(true);
  });
});

// ============================================================================
// 1016 maxBuffer 回归锁:真机 P0 预检 RangeError(stdout maxBuffer exceeded)
// —— defaultSqliteIo.readTable 走 sqlite3 CLI 全表 -json dump,7282 行真库 stdout
// 超 Node 默认 1MB;测试夹具均为小库,默认实现零覆盖故漏网。本组测试用 fake CLI
// (node 脚本吐 2MB stdout)钉死大库语义。
// ============================================================================

describe("defaultSqliteIo 大库 maxBuffer(1016 真机回归锁)", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-maxbuf-"));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  function writeFakeCli(): string {
    const cli = path.join(tmp, "fake-sqlite3.cjs");
    // 模拟 `sqlite3 -json db "SELECT ..."`:吐 ~2.2MB 的合法 JSON 行(>1MB 默认帽)
    const rows = Array.from({ length: 12000 }, (_, i) => ({
      __rowid: i + 1,
      type: "role",
      path: `role/asset-${i}.png`,
      padding: "x".repeat(160),
    }));
    const payload = path.join(tmp, "payload.json");
    fs.writeFileSync(payload, JSON.stringify(rows));
    fs.writeFileSync(
      cli,
      `#!/usr/bin/env node
const fs=require("fs");process.stdout.write(fs.readFileSync(${JSON.stringify(payload)}, "utf8"));`,
    );
    fs.chmodSync(cli, 0o755);
    return cli;
  }

  it("readTable:2MB+ stdout 不炸 maxBuffer,行数保真", async () => {
    process.env.MY_SQLITE3_CLI = writeFakeCli();
    try {
      const db = path.join(tmp, "assets.db");
      fs.writeFileSync(db, "");
      const rows = await defaultSqliteIoForTest.readTable(db, "assets");
      expect(rows).toHaveLength(12000);
      expect(rows[0].path).toBe("role/asset-0.png");
    } finally {
      delete process.env.MY_SQLITE3_CLI;
    }
  });

  it("tableExists:大 stdout 同样不炸(同一 maxBuffer 帽覆盖全部调用)", async () => {
    process.env.MY_SQLITE3_CLI = writeFakeCli();
    try {
      const db = path.join(tmp, "assets.db");
      const exists = await defaultSqliteIoForTest.tableExists(db, "assets");
      expect(exists).toBe(true); // fake CLI 恒吐非空 → name 行存在语义
    } finally {
      delete process.env.MY_SQLITE3_CLI;
    }
  });
});
