import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getCharacterJsonInfo,
  loadCharacterJsonText,
  restoreCharacterJsonText,
  saveCharacterJsonText,
} from "./asset-character-json";

const mocks = vi.hoisted(() => ({
  readText: vi.fn(),
  writeText: vi.fn(),
  restoreText: vi.fn(),
}));

vi.mock("@/lib/bridge/studio-skills", () => ({
  getStudioSkillsBridge: () => ({
    readText: mocks.readText,
    writeText: mocks.writeText,
    restoreText: mocks.restoreText,
  }),
}));

beforeEach(() => {
  mocks.readText.mockReset();
  mocks.writeText.mockReset();
  mocks.restoreText.mockReset();
});

describe("asset-character-json(角色真源 JSON 域)", () => {
  it("按角色名解析内置真源 JSON(晏燎)", () => {
    const info = getCharacterJsonInfo("晏燎");
    expect(info).not.toBeNull();
    expect(info?.relativePath).toBe("art_skills/daojie_ink_guofeng/json/晏燎.json");
    const parsed = JSON.parse(info?.bundledText ?? "{}") as Record<string, unknown>;
    expect(parsed).toHaveProperty("stages");
    expect(parsed).toHaveProperty("hd_face_base");
  });

  it("无真源的角色名/空名恒 null", () => {
    expect(getCharacterJsonInfo("不存在角色")).toBeNull();
    expect(getCharacterJsonInfo("")).toBeNull();
    expect(getCharacterJsonInfo(null)).toBeNull();
    expect(getCharacterJsonInfo("  ")).toBeNull();
  });

  it("载入优先走桌面存储副本(含用户编辑)", async () => {
    mocks.readText.mockResolvedValue({ success: true, content: '{"edited":true}' });
    const result = await loadCharacterJsonText("晏燎");
    expect(result).toMatchObject({ status: "ready", source: "storage", text: '{"edited":true}' });
    expect(mocks.readText).toHaveBeenCalledWith("art_skills/daojie_ink_guofeng/json/晏燎.json");
  });

  it("桥读失败/返回失败时回内置种子展示", async () => {
    mocks.readText.mockResolvedValue({ success: false, error: "boom" });
    const failed = await loadCharacterJsonText("晏燎");
    expect(failed.status).toBe("ready");
    if (failed.status === "ready") expect(failed.source).toBe("bundle");

    mocks.readText.mockRejectedValue(new Error("bridge down"));
    const rejected = await loadCharacterJsonText("晏燎");
    expect(rejected.status).toBe("ready");
    if (rejected.status === "ready") expect(rejected.source).toBe("bundle");
  });

  it("保存前 JSON.parse 校验:非法 JSON 不触桥", async () => {
    const result = await saveCharacterJsonText("晏燎", "{not json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("JSON 格式无效");
    expect(mocks.writeText).not.toHaveBeenCalled();
  });

  it("合法 JSON 经技能存储桥写入正确路径", async () => {
    mocks.writeText.mockResolvedValue({ success: true, updatedAt: 123 });
    const result = await saveCharacterJsonText("晏燎", '{"zh":"晏燎"}');
    expect(result).toMatchObject({ ok: true });
    expect(mocks.writeText).toHaveBeenCalledWith(
      "art_skills/daojie_ink_guofeng/json/晏燎.json",
      '{"zh":"晏燎"}',
    );
  });

  it("恢复走 restoreText;写失败与恢复失败错误透传", async () => {
    mocks.restoreText.mockResolvedValue({ success: true });
    await expect(restoreCharacterJsonText("晏燎")).resolves.toMatchObject({ ok: true });
    expect(mocks.restoreText).toHaveBeenCalledWith("art_skills/daojie_ink_guofeng/json/晏燎.json");

    mocks.writeText.mockResolvedValue({ success: false, error: "disk full" });
    const saveFailed = await saveCharacterJsonText("晏燎", "{}");
    expect(saveFailed).toMatchObject({ ok: false, error: "disk full" });
  });
});

import { deriveSubjectFromCharacterJson, loadCharacterSubject } from "./asset-character-json";

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
