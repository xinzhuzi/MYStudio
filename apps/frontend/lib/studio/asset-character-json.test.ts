import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildStorePromptRelativePath,
  getCharacterJsonInfo,
  invalidateAssetPromptInfoCache,
  loadCharacterJsonText,
  loadCharacterSubject,
  resolveAssetPromptJsonInfo,
  restoreCharacterJsonText,
  saveCharacterJsonText,
} from "./asset-character-json";

const mocks = vi.hoisted(() => ({
  readText: vi.fn(),
  writeText: vi.fn(),
  restoreText: vi.fn(),
  projectReadText: vi.fn(),
  projectWriteText: vi.fn(),
  activeProjectId: "proj-test" as string | null,
}));

vi.mock("@/lib/bridge/studio-skills", () => ({
  getStudioSkillsBridge: () => ({
    readText: mocks.readText,
    writeText: mocks.writeText,
    restoreText: mocks.restoreText,
  }),
}));

vi.mock("@/lib/bridge/project-files", () => ({
  getProjectFilesBridge: () => ({
    readText: mocks.projectReadText,
    writeText: mocks.projectWriteText,
  }),
}));

vi.mock("@/stores/project/project-store", () => ({
  useProjectStore: { getState: () => ({ activeProjectId: mocks.activeProjectId }) },
}));

/** store 位读桩:按 relativePath 查表;缺省路径一律 {success:false}。 */
function stubStoreFiles(files: Record<string, string>): void {
  mocks.projectReadText.mockImplementation(async (payload: { relativePath: string }) => {
    const text = files[payload.relativePath];
    return text === undefined ? { success: false, error: "not found" } : { success: true, text };
  });
}

beforeEach(() => {
  mocks.readText.mockReset();
  mocks.writeText.mockReset();
  mocks.restoreText.mockReset();
  mocks.projectReadText.mockReset().mockResolvedValue({ success: false, error: "not found" });
  mocks.projectWriteText.mockReset().mockResolvedValue({ success: true, filePath: "/tmp/x" });
  mocks.activeProjectId = "proj-test";
  invalidateAssetPromptInfoCache();
});

describe("asset-character-json(提示词真源 JSON 域:store 位接线 10-27)", () => {
  it("buildStorePromptRelativePath:平铺/撞名 @type 两形态(读探写共用)", () => {
    expect(buildStorePromptRelativePath("晏燎")).toBe("store/assets/files/prompts/晏燎.json");
    expect(buildStorePromptRelativePath("晏燎", "role")).toBe("store/assets/files/prompts/晏燎.json");
    expect(buildStorePromptRelativePath("蛟龙", "role", true)).toBe("store/assets/files/prompts/蛟龙@role.json");
    expect(buildStorePromptRelativePath("蛟龙", "tool", true)).toBe("store/assets/files/prompts/蛟龙@tool.json");
  });

  it("store 优先且次序正确:store 命中即收,技能存储桥不被调", async () => {
    stubStoreFiles({ "store/assets/files/prompts/晏燎.json": '{"store":true}' });
    const result = await loadCharacterJsonText("晏燎", "role");
    expect(result).toMatchObject({
      status: "ready",
      source: "store",
      text: '{"store":true}',
      relativePath: "store/assets/files/prompts/晏燎.json",
      seedAvailable: true,
    });
    expect(mocks.readText).not.toHaveBeenCalled();
    expect(mocks.projectReadText).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "proj-test", relativePath: "store/assets/files/prompts/晏燎.json", raw: true }),
    );
  });

  it("store-only 角色:store 命中收(seedAvailable=false);两处皆无→missing", async () => {
    stubStoreFiles({
      "store/assets/files/prompts/小杂役.json": JSON.stringify({ asset_type: "role", body_base: { 主体词: "素体句" } }),
    });
    const hit = await loadCharacterJsonText("小杂役", "role");
    expect(hit).toMatchObject({ status: "ready", source: "store" });
    if (hit.status === "ready") expect(hit.seedAvailable).toBeFalsy();

    mocks.projectReadText.mockResolvedValue({ success: false, error: "not found" });
    await expect(loadCharacterJsonText("小杂役", "role")).resolves.toMatchObject({ status: "missing" });
  });

  it("store 未命中+repo 命中→技能存储副本/内置种子链照旧", async () => {
    mocks.projectReadText.mockResolvedValue({ success: false, error: "not found" });
    mocks.readText.mockResolvedValue({ success: true, content: '{"edited":true}' });
    const stored = await loadCharacterJsonText("晏燎", "role");
    expect(stored).toMatchObject({ status: "ready", source: "storage", text: '{"edited":true}', seedAvailable: true });

    mocks.readText.mockResolvedValue({ success: false, error: "boom" });
    const bundled = await loadCharacterJsonText("晏燎", "role");
    expect(bundled.status).toBe("ready");
    if (bundled.status === "ready") expect(bundled.source).toBe("bundle");
  });

  it("asset_type 校验:匹配收/不匹配拒/无 asset_type 仅 role 收且 scene 续探 @type 位", async () => {
    stubStoreFiles({
      "store/assets/files/prompts/场景甲.json": JSON.stringify({ asset_type: "scene", zh: "场景甲" }),
      "store/assets/files/prompts/蛟龙@scene.json": JSON.stringify({ asset_type: "scene", zh: "蛟龙场景" }),
      "store/assets/files/prompts/蛟龙.json": JSON.stringify({ asset_type: "tool", zh: "蛟龙道具" }),
    });
    // 匹配收
    await expect(loadCharacterJsonText("场景甲", "scene")).resolves.toMatchObject({ status: "ready", source: "store" });
    // 不匹配拒(非 glob 名→两处皆无)
    await expect(loadCharacterJsonText("场景甲", "role")).resolves.toMatchObject({ status: "missing" });
    // 无 asset_type:role 收
    stubStoreFiles({ "store/assets/files/prompts/旧手件.json": '{"zh":"旧"}' });
    await expect(loadCharacterJsonText("旧手件", "role")).resolves.toMatchObject({ status: "ready", source: "store" });
    // 无 asset_type:scene 拒(平铺位)→ 续探 <名>@scene.json → 命中
    stubStoreFiles({
      "store/assets/files/prompts/蛟龙.json": '{"zh":"无型旧件"}',
      "store/assets/files/prompts/蛟龙@scene.json": JSON.stringify({ asset_type: "scene" }),
    });
    const viaTyped = await loadCharacterJsonText("蛟龙", "scene");
    expect(viaTyped).toMatchObject({ status: "ready", source: "store", relativePath: "store/assets/files/prompts/蛟龙@scene.json" });
  });

  it("撞名路径:蛟龙 role 走 @role 位、蛟龙 tool 吃平铺位;save 写读同路(@role)", async () => {
    stubStoreFiles({
      "store/assets/files/prompts/蛟龙.json": JSON.stringify({ asset_type: "tool", zh: "蛟龙道具" }),
      "store/assets/files/prompts/蛟龙@role.json": JSON.stringify({ asset_type: "role", body_base: { 主体词: "蛟龙素体" } }),
    });
    const roleLoad = await loadCharacterJsonText("蛟龙", "role");
    expect(roleLoad).toMatchObject({
      status: "ready",
      source: "store",
      relativePath: "store/assets/files/prompts/蛟龙@role.json",
    });
    const toolLoad = await loadCharacterJsonText("蛟龙", "tool");
    expect(toolLoad).toMatchObject({
      status: "ready",
      source: "store",
      relativePath: "store/assets/files/prompts/蛟龙.json",
    });

    const saved = await saveCharacterJsonText("蛟龙", '{"asset_type":"role"}', "role");
    expect(saved).toMatchObject({ ok: true });
    expect(mocks.projectWriteText).toHaveBeenCalledWith(
      "_p/proj-test/store/assets/files/prompts/蛟龙@role.json",
      '{"asset_type":"role"}',
    );
  });

  it("save 成功后 invalidate 真源位置缓存(重探即见新态)", async () => {
    stubStoreFiles({ "store/assets/files/prompts/小杂役.json": '{"asset_type":"role"}' });
    await expect(resolveAssetPromptJsonInfo("小杂役", "role")).resolves.toEqual({ origin: "store" });
    // 缓存生效:mock 改失配后仍回 store
    mocks.projectReadText.mockResolvedValue({ success: false, error: "not found" });
    await expect(resolveAssetPromptJsonInfo("小杂役", "role")).resolves.toEqual({ origin: "store" });
    // save 成功 → invalidate → 重探落空(非 glob 名→null)
    const saved = await saveCharacterJsonText("小杂役", '{"asset_type":"role"}', "role");
    expect(saved).toMatchObject({ ok: true });
    await expect(resolveAssetPromptJsonInfo("小杂役", "role")).resolves.toEqual({ origin: null });
  });

  it("save 前置门控:store 命中或 repo info 任一即可;JSON 非法不触写桥", async () => {
    stubStoreFiles({ "store/assets/files/prompts/小杂役.json": '{"asset_type":"role"}' });
    const bad = await saveCharacterJsonText("小杂役", "{not json", "role");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("JSON 格式无效");
    expect(mocks.projectWriteText).not.toHaveBeenCalled();

    const ok = await saveCharacterJsonText("小杂役", '{"asset_type":"role"}', "role");
    expect(ok).toMatchObject({ ok: true });
    expect(mocks.projectWriteText).toHaveBeenCalledWith(
      "_p/proj-test/store/assets/files/prompts/小杂役.json",
      '{"asset_type":"role"}',
    );
  });

  it("store-only restore 无种子报错;repo 角色 restore=写 bundledText 进 store 同路径", async () => {
    await expect(restoreCharacterJsonText("小杂役", "role")).resolves.toMatchObject({
      ok: false,
      error: "该 JSON 无内置种子",
    });

    stubStoreFiles({ "store/assets/files/prompts/晏燎.json": '{"用户":"编辑"}' });
    const restored = await restoreCharacterJsonText("晏燎", "role");
    expect(restored).toMatchObject({ ok: true });
    const bundled = getCharacterJsonInfo("晏燎")?.bundledText ?? "";
    expect(mocks.projectWriteText).toHaveBeenCalledWith("_p/proj-test/store/assets/files/prompts/晏燎.json", bundled);
  });

  it("loadCharacterSubject(type 缺省)=平铺名探测+旧件按 role 收", async () => {
    stubStoreFiles({ "store/assets/files/prompts/旧手件.json": JSON.stringify({ body_base: { 主体词: "旧件素体" } }) });
    await expect(loadCharacterSubject("旧手件", null)).resolves.toBe("旧件素体");
    // type 缺省不探 @type 位:平铺被异型占用(asset_type tool)→ 不收
    stubStoreFiles({ "store/assets/files/prompts/蛟龙.json": JSON.stringify({ asset_type: "tool", body_base: { 主体词: "道具" } }) });
    await expect(loadCharacterSubject("蛟龙", null)).resolves.toBeNull();
  });
});

import { deriveSubjectFromCharacterJson } from "./asset-character-json";

describe("deriveSubjectFromCharacterJson(主体句真源接线)", () => {
  const truth = JSON.stringify({
    body_base: { 主体词: "基底主体句" },
    stages: { 境界: { "1.炼气期": { 主体词_独立t2i备用: "炼气主体" }, "2.筑基期": { 主体词_独立t2i备用: "筑基主体" } } },
  });

  it("境界键剥数字前缀匹配选择器值", () => {
    expect(deriveSubjectFromCharacterJson(truth, "筑基期")).toBe("筑基主体");
  });

  it("炼/练两写法归一(实库「练气期」命中 JSON 键「1.炼气期」)", () => {
    expect(deriveSubjectFromCharacterJson(truth, "练气期")).toBe("炼气主体");
  });

  it("无阶段/未命中境界 → 回退 body_base.主体词", () => {
    expect(deriveSubjectFromCharacterJson(truth, null)).toBe("基底主体句");
    expect(deriveSubjectFromCharacterJson(truth, "剑主男")).toBe("基底主体句");
  });

  it("真源实弹:晏燎筑基期主体词含身份锚", () => {
    const info = getCharacterJsonInfo("晏燎");
    expect(info).not.toBeNull();
    const subject = deriveSubjectFromCharacterJson(info?.bundledText ?? "{}", "筑基期");
    expect(subject).toContain("约二十岁的清瘦青年男修");
    expect(subject).toContain("筑基剑装");
  });

  it("损坏 JSON/结构缺失 → null(调用方回退 DB 行为)", () => {
    expect(deriveSubjectFromCharacterJson("{broken", "筑基期")).toBeNull();
    expect(deriveSubjectFromCharacterJson("{}", "筑基期")).toBeNull();
    expect(deriveSubjectFromCharacterJson(JSON.stringify({ stages: { 境界: {} } }), "筑基期")).toBeNull();
  });

  it("loadCharacterSubject 走存储副本派生;无真源角色 null", async () => {
    mocks.readText.mockResolvedValue({ success: true, content: truth });
    await expect(loadCharacterSubject("晏燎", "筑基期")).resolves.toBe("筑基主体");
    await expect(loadCharacterSubject("不存在角色", "筑基期")).resolves.toBeNull();
  });
});

import {
  findCharacterPromptRealm,
  parseCharacterPromptCatalog,
} from "./asset-character-json";

describe("parseCharacterPromptCatalog(人物提示词目录化)", () => {
  it("晏燎真源:基底两组+十境,每境五条指令且路由标注正确", () => {
    const info = getCharacterJsonInfo("晏燎");
    expect(info).not.toBeNull();
    const catalog = parseCharacterPromptCatalog(info?.bundledText ?? "{}");
    expect(catalog).not.toBeNull();
    expect(catalog?.faceBase).toMatchObject({ route: "t2i", title: "人脸基准" });
    expect(catalog?.bodyBase).toMatchObject({ route: "t2i", title: "人物基底·素体" });
    expect(catalog?.realms).toHaveLength(10);
    const jz = findCharacterPromptRealm(catalog, "筑基期");
    expect(jz?.entries.map((e) => e.title)).toEqual([
      "筑基期·独立主体词", "筑基期·换装编辑指令", "筑基期·正视图指令", "筑基期·海报指令", "筑基期·三视图指令",
    ]);
    expect(jz?.entries.map((e) => e.route)).toEqual(["t2i", "i2i", "i2i", "i2i", "i2i"]);
    expect(jz?.entries[0]?.text).toContain("约二十岁的清瘦青年男修");
  });

  it("境界查找炼/练归一:「练气期」命中 JSON 键「1.炼气期」;未命中/空值 null", () => {
    const info = getCharacterJsonInfo("晏燎");
    const catalog = parseCharacterPromptCatalog(info?.bundledText ?? "{}");
    expect(findCharacterPromptRealm(catalog, "练气期")?.stage).toBe("练气期");
    expect(findCharacterPromptRealm(catalog, "剑主男")).toBeNull();
    expect(findCharacterPromptRealm(catalog, null)).toBeNull();
    expect(findCharacterPromptRealm(null, "筑基期")).toBeNull();
  });

  it("损坏/缺基底结构 → null(回退既有 UI)", () => {
    expect(parseCharacterPromptCatalog("{broken")).toBeNull();
    expect(parseCharacterPromptCatalog("{}")).toBeNull();
  });
});

import { resolveBareTypeSubjectGate } from "./asset-character-json";

describe("resolveBareTypeSubjectGate(无衣物定妆型区分闸,10-26 用户令)", () => {
  const SU = "一位约二十岁的清瘦青年男修的全身素体立绘:通身素体呈现,足部赤裸。";
  const CLOTHED = "约十岁的男童,码头杂役,土黄粗布短褐缀补丁,配旧布裤,腰束栗褐布绳。";

  it("真源素体句在场:素体型恒发素体句(不吃兜底带衣句)", () => {
    const r = resolveBareTypeSubjectGate({ kind: "无衣物定妆", bodyBaseSubject: SU, fallback: CLOTHED });
    expect(r.subject).toBe(SU);
    expect(r.block).toBeUndefined();
  });

  it("用户显式本型槽句最优先", () => {
    const r = resolveBareTypeSubjectGate({ kind: "无衣物定妆", bodyBaseSubject: SU, fallback: CLOTHED, slot: "  槽句  " });
    expect(r.subject).toBe("槽句");
  });

  it("无真源+兜底句带衣物→自动派生素体句(10-27 令:阻断改自动生成)", () => {
    const r = resolveBareTypeSubjectGate({ kind: "无衣物定妆", bodyBaseSubject: null, fallback: CLOTHED });
    expect(r.derived).toBe(true);
    expect(r.subject).toContain("约十岁的男童");
    expect(r.subject).toContain("码头杂役");
    expect(r.subject).toContain("素体");
    expect(r.subject).not.toMatch(/剑装|交领|短褐|布裤/);
  });

  it("无真源+兜底句自带素体声明→放行;其他型零干预", () => {
    const bare = resolveBareTypeSubjectGate({ kind: "无衣物定妆", bodyBaseSubject: null, fallback: "男童全身素体,赤足站立。" });
    expect(bare.block).toBeUndefined();
    const other = resolveBareTypeSubjectGate({ kind: "美宣", bodyBaseSubject: null, fallback: CLOTHED });
    expect(other).toEqual({});
  });

  it("晏燎真源实弹:body_base 素体词可派发", () => {
    const info = getCharacterJsonInfo("晏燎");
    const su = deriveSubjectFromCharacterJson(info?.bundledText ?? "{}", null);
    expect(su).toContain("素体");
    const r = resolveBareTypeSubjectGate({ kind: "无衣物定妆", bodyBaseSubject: su, fallback: CLOTHED });
    expect(r.subject).toBe(su);
  });
});

describe("resolveBareTypeSubjectGate 赤足漏洞回归(10-26 小杂役实录)", () => {
  it("穿破衣光脚杂役句→自动派生素体句(10-27 用户令:阻断改自动生成):剥衣物段留身份/面容/发型,套素体基准尾", () => {
    const XIAOZAYI = "约十岁的男童,码头杂役,谨小慎微、眼神怯生,圆脸稚气未脱,偏大的深色眼睛。肤色微黄,身形瘦小。素颜状态,中性微表情含怯意。土黄粗布短褐缀补丁,配旧布裤,腰束栗褐布绳,衣裤完整可穿;赤足。凌乱的及肩墨黑短发。";
    const r = resolveBareTypeSubjectGate({ kind: "无衣物定妆", bodyBaseSubject: null, fallback: XIAOZAYI });
    expect(r.block).toBeUndefined();
    expect(r.derived).toBe(true);
    expect(r.subject).toContain("约十岁的男童");
    expect(r.subject).toContain("墨黑短发");
    expect(r.subject).toContain("通身素体呈现");
    expect(r.subject).not.toMatch(/短褐|布裤|布绳|衣/);
  });
  it("全身素体声明仍放行(素体词在场)", () => {
    const r = resolveBareTypeSubjectGate({ kind: "无衣物定妆", bodyBaseSubject: null, fallback: "男童全身素体,赤足站立。" });
    expect(r.block).toBeUndefined();
  });
});

describe("deriveBare 构图段剥除(10-27 用户贴全文实录:四视图/21:9横幅段必须剥)", () => {
  it("小杂役 DB 全文(含四视图并排+横幅+散光段)→派生句零构图词、零衣物词、身份发型保留", () => {
    const FULL = "约十岁的男童,码头杂役,谨小慎微、眼神怯生,非少年非青年,圆脸稚气未脱、脸颊圆润,偏大的深色眼睛。肤色微黄,身形瘦小,身高仅及成人胸口、约一百三十厘米,五头身幼态比例,五官由稚气孩童神态自然推导。素颜状态,中性微表情含怯意,目视前方,自然站立、双臂自然下垂、双脚微分。土黄粗布短褐缀补丁,配旧布裤,腰束栗褐布绳,衣裤完整可穿;赤足。凌乱的及肩墨黑短发,碎发垂在额前与耳侧。无持物、无发饰配饰。宣纸白纯色背景,无场景元素。同一画面从左至右并排四视图:人像特写自头顶至锁骨完整入画,正面、侧面、背面全身立像自头顶至脚底完整入画;21:9 横幅,均匀柔和散光。四视图面容、体型、发型、基础服装完全一致。";
    const r = resolveBareTypeSubjectGate({ kind: "无衣物定妆", bodyBaseSubject: null, fallback: FULL });
    expect(r.derived).toBe(true);
    expect(r.subject).toContain("约十岁的男童");
    expect(r.subject).toContain("墨黑短发");
    expect(r.subject).toContain("通身素体呈现");
    expect(r.subject).not.toMatch(/四视图|横幅|并排|散光|特写|短褐|布裤|布绳|宣纸白|视图/);
  });
});
