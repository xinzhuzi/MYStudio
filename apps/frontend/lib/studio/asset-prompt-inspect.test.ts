import { describe, expect, it } from "vitest";

import {
  PROMPT_TEXT_BRIDGE_MISSING_LABEL,
  PROMPT_TEXT_DEGRADATION_LABELS,
  buildFinalDraftCandidates,
  resolvePromptOwnerNote,
} from "./asset-prompt-inspect";

/**
 * 10-25-asset-prompt-layered-panel A-2③/B-3 纯函数锚测试:
 * - 候选回溯序=displayImages 数组序倒排(focusKind 组末位=最新产物居首,PRD §4.1 算法);
 * - 归型走 classifyAssetImage 三层解析(持久值→命名标记→自由);
 * - 族兄弟标注(§4.4 矩阵:来自同族资产 {名});
 * - 降级矩阵文案逐 reason 钉字(§4.4 全路径,禁编造)。
 */
describe("buildFinalDraftCandidates", () => {
  it("focusKind 组过滤+数组序倒排:末位(最新产物)居首供回溯", () => {
    const candidates = buildFinalDraftCandidates(
      [
        { name: "晏燎_海报_v1", filePath: "role/a.png" },
        { name: "晏燎_全身定妆_v1", filePath: "role/f1.png" },
        { name: "晏燎_人脸_2026年10月21日", filePath: "role/face.png" },
        { name: "晏燎_全身定妆_v2", filePath: "role/f2.png" },
      ],
      "全身定妆",
    );
    // 组内两张全身定妆按数组序倒排:v2(末位=最新)在前,v1 在后
    expect(candidates.map((c) => c.filePath)).toEqual(["role/f2.png", "role/f1.png"]);
  });

  it("归型三层解析:kind 持久值优先,命名标记次之,无标记落自由不入选", () => {
    const candidates = buildFinalDraftCandidates(
      [
        // 持久值 kind=人物海报,名却带 _全身定妆_(链式生成名)——持久值优先仍归人物海报
        { name: "晏燎_全身定妆_链式名", filePath: "role/p1.png", kind: "人物海报" },
        // 无持久值,命名标记 _海报_ 归人物海报
        { name: "晏燎_海报_v1", filePath: "role/p2.png" },
        // 无标记=自由,非目标型
        { name: "随手草图", filePath: "role/p3.png" },
      ],
      "人物海报",
    );
    // 倒排:p2(末位)在前,p1 次之;p3(自由)不入组
    expect(candidates.map((c) => c.filePath)).toEqual(["role/p2.png", "role/p1.png"]);
  });

  it("族兄弟条目计入并携带 assetId/assetName(族聚显口径);空路径条目滤除", () => {
    const candidates = buildFinalDraftCandidates(
      [
        { name: "晏燎_全身定妆_v1", filePath: "role/f1.png", assetId: "role-1", assetName: "晏燎" },
        { name: "二哥_全身定妆_v1", filePath: "", assetId: "role-2", assetName: "晏燎二哥" },
      ],
      "全身定妆",
    );
    expect(candidates).toEqual([
      { filePath: "role/f1.png", imageName: "晏燎_全身定妆_v1", assetId: "role-1", assetName: "晏燎" },
    ]);
  });

  it("组空返回空数组(调用方按「该型尚无产物」置灰)", () => {
    expect(buildFinalDraftCandidates([{ name: "晏燎_海报_v1", filePath: "role/a.png" }], "全身定妆")).toEqual([]);
  });
});

describe("resolvePromptOwnerNote", () => {
  it("族兄弟(assetId≠当前)→「来自同族资产 {名}」", () => {
    expect(resolvePromptOwnerNote({ assetId: "role-2", assetName: "晏燎二哥" }, "role-1")).toBe(
      "来自同族资产 晏燎二哥",
    );
  });

  it("本行条目/无归属信息→null 不标注", () => {
    expect(resolvePromptOwnerNote({ assetId: "role-1", assetName: "晏燎" }, "role-1")).toBeNull();
    expect(resolvePromptOwnerNote({}, "role-1")).toBeNull();
    expect(resolvePromptOwnerNote({ assetId: "role-2" }, undefined)).toBeNull();
  });

  it("名缺(旧数据防御位)→只标「来自同族资产」不编造", () => {
    expect(resolvePromptOwnerNote({ assetId: "role-2" }, "role-1")).toBe("来自同族资产");
  });
});

describe("降级文案矩阵(§4.4 全路径钉字)", () => {
  it("六 reason 全覆盖且逐字对齐 PRD §4.4", () => {
    expect(PROMPT_TEXT_DEGRADATION_LABELS["no-texr"]).toBe("该图无提示词元数据");
    expect(PROMPT_TEXT_DEGRADATION_LABELS["not-png"]).toBe("仅引擎 PNG 产物携带提示词元数据");
    expect(PROMPT_TEXT_DEGRADATION_LABELS["file-missing"]).toBe("原图文件不可读");
    // path-rejected/read-failed 对用户同为读不到原图,并轨同文案;oversize 如实标超限
    expect(PROMPT_TEXT_DEGRADATION_LABELS["path-rejected"]).toBe("原图文件不可读");
    expect(PROMPT_TEXT_DEGRADATION_LABELS["read-failed"]).toBe("原图文件不可读");
    expect(PROMPT_TEXT_DEGRADATION_LABELS.oversize).toBe("提示词元数据超出读取上限");
  });

  it("桥缺席单列标签(非桌面/旧 preload)", () => {
    expect(PROMPT_TEXT_BRIDGE_MISSING_LABEL).toBe("当前环境不支持读取提示词元数据");
  });
});
