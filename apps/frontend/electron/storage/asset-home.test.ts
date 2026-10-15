import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  AssetHomeError,
  assetHomeMarkerPath,
  readAssetHomeMarker,
  resolveAssetHomeRoot,
  resolveTtsHomeRoot,
} from "./asset-home";

/**
 * 资产/TTS 家解析状态机测试(1015 资产归域)。
 * 文件即真相:全部走真实临时目录 + 注入的位置表函数,不 mock fs。
 * 锚:计划 testPlan【新增】asset-home.test.ts ①-⑩。
 */

type Fixture = {
  tmp: string;
  userData: string;
  /** 项目域根(如 /Users/…/IP/MA 的测试替身)。 */
  projectRoot: string;
  /** 旧统一存储基路径(getStorageBasePath 测试替身)。 */
  legacyBase: string;
  /** 写位置表真源 <userData>/project-locations.json。 */
  writeLocationTable: (entries: Record<string, string> | "CORRUPT") => void;
  writeMarker: (marker: Record<string, unknown> | "CORRUPT") => void;
  /** M-A 求值式 fallback:与 storage-manager.ts:130-134 现状逐字节等价的派生式。 */
  fallback: () => string;
  resolve: (overrides?: { allLocations?: () => Record<string, string> }) => string;
  resolveTts: (overrides?: { allLocations?: () => Record<string, string>; legacyBase?: () => string }) => string;
};

function createFixture(): Fixture {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-asset-home-"));
  const userData = path.join(tmp, "userData");
  const projectRoot = path.join(tmp, "MA");
  const legacyBase = path.join(tmp, "legacy-base");
  fs.mkdirSync(userData, { recursive: true });

  const writeLocationTable = (entries: Record<string, string> | "CORRUPT") => {
    const filePath = path.join(userData, "project-locations.json");
    if (entries === "CORRUPT") {
      fs.writeFileSync(filePath, "{not-json", "utf-8");
      return;
    }
    fs.writeFileSync(filePath, JSON.stringify({ version: 1, locations: entries }), "utf-8");
  };

  const writeMarker = (marker: Record<string, unknown> | "CORRUPT") => {
    const filePath = path.join(userData, "asset-home.json");
    if (marker === "CORRUPT") {
      fs.writeFileSync(filePath, "{broken", "utf-8");
      return;
    }
    fs.writeFileSync(filePath, JSON.stringify(marker), "utf-8");
  };

  const fallback = () => path.join(legacyBase, "assets");

  const emptyLocations = (_projectId?: string): Record<string, string> => ({});
  const table = (overrides?: { allLocations?: (projectId?: string) => Record<string, string> }) => (
    (): Record<string, string> => (overrides?.allLocations ?? emptyLocations)()
  );
  const resolve = (overrides?: { allLocations?: (projectId?: string) => Record<string, string> }) => resolveAssetHomeRoot({
    userDataPath: userData,
    locationStore: (projectId: string): string | undefined => table(overrides)()[projectId],
    allLocations: table(overrides),
    fallback,
  });

  const resolveTts = (overrides?: { allLocations?: (projectId?: string) => Record<string, string>; legacyBase?: () => string }) => resolveTtsHomeRoot({
    userDataPath: userData,
    locationStore: (projectId: string): string | undefined => table(overrides)()[projectId],
    allLocations: table(overrides),
    legacyBasePath: overrides?.legacyBase ?? (() => legacyBase),
  });

  return { tmp, userData, projectRoot, legacyBase, writeLocationTable, writeMarker, fallback, resolve, resolveTts };
}

function touchAssetDb(root: string) {
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "assets", "assets.db"), "db", "utf-8");
}

function touchTtsDb(root: string) {
  fs.mkdirSync(path.join(root, "TTS", "runtime"), { recursive: true });
  fs.writeFileSync(path.join(root, "TTS", "runtime", "tts.sqlite"), "db", "utf-8");
}

describe("resolveAssetHomeRoot 状态机", () => {
  it("①真未迁移态(marker 无+新根无 db+位置表可读)→fallback=join(legacyBase,'assets') 求值式", () => {
    const fixture = createFixture();
    expect(fixture.resolve()).toBe(path.join(fixture.legacyBase, "assets"));
  });

  it("②资产已迁(新根 assets.db 在场+位置表注册)→返回 <projectRoot>/assets", () => {
    const fixture = createFixture();
    touchAssetDb(fixture.projectRoot);
    const all = () => ({ "pid-1": fixture.projectRoot });
    fixture.writeLocationTable({ "pid-1": fixture.projectRoot });
    expect(fixture.resolve({ allLocations: all })).toBe(path.join(fixture.projectRoot, "assets"));
  });

  it("③【M8】marker 损坏→按无处理→全表探测自愈+补写 marker(不抛异常态)", () => {
    const fixture = createFixture();
    touchAssetDb(fixture.projectRoot);
    fixture.writeLocationTable({ "pid-1": fixture.projectRoot });
    fixture.writeMarker("CORRUPT");

    const all = () => ({ "pid-1": fixture.projectRoot });
    expect(fixture.resolve({ allLocations: all })).toBe(path.join(fixture.projectRoot, "assets"));

    // 自愈后 marker 已补写且可读
    const healed = readAssetHomeMarker(fixture.userData);
    expect(healed?.lastKnownLocation).toBe(fixture.projectRoot);
  });

  it("④位置表损坏→异常态 ASSET_HOME_LOCATION_TABLE_CORRUPT", () => {
    const fixture = createFixture();
    fixture.writeLocationTable("CORRUPT");
    expect(() => fixture.resolve({ allLocations: () => ({}) })).toThrow(AssetHomeError);
    expect(() => fixture.resolve({ allLocations: () => ({}) })).toThrow(/位置表/);
  });

  it("⑤marker 在+位置表条目删→ASSET_HOME_ORPHANED(lastKnownLocation 透出,绝不静默 fallback)", () => {
    const fixture = createFixture();
    fixture.writeMarker({ version: 1, lastKnownLocation: fixture.projectRoot, ttsMigrated: true });
    // 位置表条目丢:allLocations 返回空表 + 文件无该条目
    const caught = (() => {
      try {
        fixture.resolve({ allLocations: () => ({}) });
        return null;
      } catch (error) {
        return error as AssetHomeError;
      }
    })();
    expect(caught?.code).toBe("ASSET_HOME_ORPHANED");
    expect(caught?.lastKnownLocation).toBe(fixture.projectRoot);
  });

  it("⑤b marker 在+条目在但新根 db 缺→ASSET_HOME_ORPHANED(目录被删场景)", () => {
    const fixture = createFixture();
    fixture.writeMarker({ version: 1, lastKnownLocation: fixture.projectRoot });
    fixture.writeLocationTable({ "pid-1": fixture.projectRoot });
    // 不 touchAssetDb:MA/assets/assets.db 缺
    expect(() => fixture.resolve({ allLocations: () => ({ "pid-1": fixture.projectRoot }) }))
      .toThrow(/ASSET_HOME_ORPHANED|失联/);
  });

  it("⑥无 marker+全表探测唯一命中→返回新根+补写 marker;多命中→异常态", () => {
    const fixture = createFixture();
    const otherRoot = path.join(fixture.tmp, "OTHER");
    touchAssetDb(fixture.projectRoot);
    touchAssetDb(otherRoot);
    const all = () => ({ "pid-1": fixture.projectRoot, "pid-2": otherRoot });

    expect(() => fixture.resolve({ allLocations: all })).toThrow(AssetHomeError);

    // 唯一命中(去掉 otherRoot 的 db)→自愈+补 marker
    fs.rmSync(path.join(otherRoot, "assets", "assets.db"));
    expect(fixture.resolve({ allLocations: all })).toBe(path.join(fixture.projectRoot, "assets"));
    expect(readAssetHomeMarker(fixture.userData)?.lastKnownLocation).toBe(fixture.projectRoot);
  });

  it("⑦【B-1】marker 恒落 <userData>/asset-home.json:不在资产树内、不随数据迁移", () => {
    const fixture = createFixture();
    expect(assetHomeMarkerPath(fixture.userData)).toBe(path.join(fixture.userData, "asset-home.json"));
    touchAssetDb(fixture.projectRoot);
    const all = () => ({ "pid-1": fixture.projectRoot });
    fixture.resolve({ allLocations: all });
    // 自愈补写后 marker 仍在 userData,而非资产树内
    const markerPath = assetHomeMarkerPath(fixture.userData);
    expect(fs.existsSync(markerPath)).toBe(true);
    expect(markerPath.startsWith(path.join(fixture.projectRoot, "assets"))).toBe(false);
    expect(readAssetHomeMarker(fixture.userData)?.lastKnownLocation).toBe(fixture.projectRoot);
  });

  it("⑨marker 元数据透出:lastKnownLocation/ttsMigrated 保留既有值不被自愈覆写", () => {
    const fixture = createFixture();
    touchAssetDb(fixture.projectRoot);
    fixture.writeLocationTable({ "pid-1": fixture.projectRoot });
    fixture.writeMarker({ version: 1, lastKnownLocation: fixture.projectRoot, ttsMigrated: true });
    fixture.resolve({ allLocations: () => ({ "pid-1": fixture.projectRoot }) });
    expect(readAssetHomeMarker(fixture.userData)).toMatchObject({
      lastKnownLocation: fixture.projectRoot,
      ttsMigrated: true,
    });
  });

  it("⑩【M12】fallback 态+旧根 db 缺失→console.warn 软警示但照常返回 fallback", () => {
    const fixture = createFixture();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // legacyBase 下无 assets/assets.db → 旧根 db 缺失
      expect(fixture.resolve()).toBe(path.join(fixture.legacyBase, "assets"));
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("resolveTtsHomeRoot【B-2 统一层级】", () => {
  it("⑧a 新态返回基路径级=location(无 TTS 段);旧态返回基路径级=legacyBase", () => {
    const fixture = createFixture();
    touchTtsDb(fixture.projectRoot);
    const all = () => ({ "pid-1": fixture.projectRoot });
    fixture.writeLocationTable({ "pid-1": fixture.projectRoot });

    const newBase = fixture.resolveTts({ allLocations: all });
    expect(newBase).toBe(fixture.projectRoot);
    expect(newBase.endsWith(path.sep + "TTS")).toBe(false);
    // ttsRootDir 拼合无重复 TTS/TTS 段
    expect(path.join(newBase, "TTS")).not.toContain(`TTS${path.sep}TTS`);

    // 旧态:新根探针缺+旧家在场 → 基路径级=legacyBase
    const legacyOnly = createFixture();
    touchTtsDb(legacyOnly.legacyBase);
    expect(legacyOnly.resolveTts()).toBe(legacyOnly.legacyBase);
  });

  it("⑧b 两侧都无=无 TTS 史合法态→按绑定态返回基路径不 throw(B2 复审修复)", () => {
    // 绑定项目(位置表非空+两侧无 tts.sqlite+无 marker):新用户/无资产史用户
    // TTS 首用——迁移例程对该态恒 noop 不写 marker(asset-home-migration 无资产史
    // 分支),重启不补;旧行为=静默建库可用,修复前此态恒 throw 致 TTS 面板全炸。
    const bound = createFixture();
    bound.writeLocationTable({ "pid-1": bound.projectRoot });
    const boundAll = () => ({ "pid-1": bound.projectRoot });
    expect(bound.resolveTts({ allLocations: boundAll })).toBe(bound.projectRoot);
    // 消费式 ttsRootDir 拼合落项目域(归域方向:MA/TTS/runtime/)
    expect(path.join(bound.resolveTts({ allLocations: boundAll }), "TTS", "runtime")).toBe(
      path.join(bound.projectRoot, "TTS", "runtime"),
    );

    // 未绑项目(空表+无 marker+两侧无):与未注入 provider 的旧行为
    // join(storageBasePath(),'TTS') 等价→旧家基路径,Python 建库。
    const unbound = createFixture();
    expect(unbound.resolveTts()).toBe(unbound.legacyBase);
  });

  it("⑧f 空迁移态(marker.ttsMigrated=true+两侧无)→candidates[0] 生效,新内容路由进项目域", () => {
    const fixture = createFixture();
    fixture.writeLocationTable({ "pid-1": fixture.projectRoot });
    fixture.writeMarker({ version: 1, lastKnownLocation: fixture.projectRoot, ttsMigrated: true });
    expect(fixture.resolveTts({ allLocations: () => ({ "pid-1": fixture.projectRoot }) })).toBe(fixture.projectRoot);
  });

  it("⑧c 两侧都在→新根生效(返回 location,旧家件交善后甄别)", () => {
    const fixture = createFixture();
    touchTtsDb(fixture.projectRoot);
    touchTtsDb(fixture.legacyBase);
    const all = () => ({ "pid-1": fixture.projectRoot });
    expect(fixture.resolveTts({ allLocations: all })).toBe(fixture.projectRoot);
  });

  it("⑧d 与 resolveAssetHomeRoot 差 /assets 段:同一 fixture 下资产根=项目根/assets,TTS 基=项目根", () => {
    const fixture = createFixture();
    touchAssetDb(fixture.projectRoot);
    touchTtsDb(fixture.projectRoot);
    const all = () => ({ "pid-1": fixture.projectRoot });
    expect(fixture.resolve({ allLocations: all })).toBe(path.join(fixture.projectRoot, "assets"));
    expect(fixture.resolveTts({ allLocations: all })).toBe(fixture.projectRoot);
  });

  it("⑧e 探针路径逐字节等价:join(base,'TTS','runtime','tts.sqlite') 与旧家 join(legacyBase,'TTS','runtime','tts.sqlite') 派生式", () => {
    const fixture = createFixture();
    touchTtsDb(fixture.projectRoot);
    const base = fixture.resolveTts({ allLocations: () => ({ "pid-1": fixture.projectRoot }) });
    expect(path.join(base, "TTS", "runtime", "tts.sqlite")).toBe(
      path.join(fixture.projectRoot, "TTS", "runtime", "tts.sqlite"),
    );
  });

  it("⑤跟随异常态:位置表损坏→throw(不猜边)", () => {
    const fixture = createFixture();
    fixture.writeLocationTable("CORRUPT");
    expect(() => fixture.resolveTts({ allLocations: () => ({}) })).toThrow(AssetHomeError);
  });
});
