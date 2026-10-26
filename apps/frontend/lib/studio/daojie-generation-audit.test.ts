import { describe, expect, it, vi } from "vitest";
import { buildStageMessages } from "./script-planning";
import { buildDirectorPlanMessages } from "./director-plan";
import { buildStoryboardTableMessages } from "./storyboard-table";
import { buildStudioManualContext } from "./manuals";
import { buildDaojieAuditMessages, isDaojieAdaptation, reviewDaojieGeneration } from "./daojie-generation-audit";
const script = "# 道劫 EP1：问铃\n# 范围与目标：问铃 | 时长：0.5分钟\n# 已确定要求：未设\n\n## 剧情梗概\n问铃。\n\n**1 山门 未定/外 ·约30秒**\n人物：玄清子\n镜头1：铃声停了。玄清子问。\n\n## 改编追踪\n| 原文位置 | 是否采用 | 视听表达 | 待确认 |";
const input = { stage: "script" as const, sourceText: "玄清子问后，铃声才停。", outputText: script };
const checks = { facts: true, chronology: true, dialogue: true, stageBoundary: true, visibleCharacters: true };
const pass = JSON.stringify({ stage: "script", passed: true, checks, findings: [] });
describe("道劫生成写回审核", () => {
  it("只启用精确选中道劫且有真实原文的改编", () => {
    expect(isDaojieAdaptation("Daojie_xianxia", "原文")).toBe(true);
    for (const id of [undefined, "", "daojie_xianxia", "other"]) expect(isDaojieAdaptation(id, "原文")).toBe(false);
    expect(isDaojieAdaptation("Daojie_xianxia", " \n")).toBe(false);
  });
  it("三个生产builder把原文优先约束放在system末尾并携带真实原文", () => {
    const common = { episodeId: "c1", scriptText: "稿", sourceText: input.sourceText, strictDaojieAdaptation: true };
    const requests = [buildStageMessages("scriptDraft", { chapterTitle: "章", chapterText: input.sourceText, strictDaojieAdaptation: true }), buildDirectorPlanMessages(common), buildStoryboardTableMessages(common)];
    for (const request of requests) {
      expect(request.system).toContain("道劫原文保真边界");
      expect(request.system.slice(-1700)).toContain("不得");
      expect(request.user).toContain(input.sourceText);
    }
    expect(buildDirectorPlanMessages({ ...common, strictDaojieAdaptation: false }).system).not.toContain("道劫原文保真边界");
  });
  it("规划只对道劫隔离逐镜模块，其他题材保留默认", () => {
    const manual = (id: string) => ({ id, name: "包", kind: "director" as const, images: [], builtin: false, source: "stored-copy" as const, completenessScore: 1, imageCount: 0, modules: { README: "简介", director_planning_narrative: "规划", director_storyboard_table_narrative: "逐镜专属" }, moduleCount: 3 });
    const catalog = { director: [manual("Daojie_xianxia"), manual("other")] };
    expect(buildStudioManualContext({ directorManualId: "Daojie_xianxia" }, catalog)).not.toContain("逐镜专属");
    expect(buildStudioManualContext({ directorManualId: "other" }, catalog)).toContain("逐镜专属");
  });
  it("审核真实原文与上游，严格协议通过才放行", async () => {
    const messages = buildDaojieAuditMessages(input);
    expect(messages.user).toContain(input.sourceText);
    expect(JSON.parse(messages.user).outputToReview).toBe(input.outputText);
    const complete = vi.fn().mockResolvedValue({ success: true, text: pass });
    expect((await reviewDaojieGeneration(input, complete)).passed).toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it.each(["", "审核通过", "{}", '{"passed":true}', pass.replace('"chronology":true,', ""), pass.replace('"stage":"script"', '"stage":"planning"')])("无效/缺维度/错阶段协议拒绝写回: %s", async (text) => {
    expect((await reviewDaojieGeneration(input, async () => ({ success: true, text }))).passed).toBe(false);
  });
  it("时序问题、传输失败和异常均拒绝，失败稿及审核保留，无自动重试", async () => {
    const failed = JSON.stringify({ stage: "script", passed: false, checks: { ...checks, chronology: false }, findings: [{ dimension: "chronology", outputQuote: "铃声停了", sourceQuote: "问后", reason: "把停铃提前" }] });
    const result = await reviewDaojieGeneration(input, async () => ({ success: true, text: failed }));
    expect(result.passed).toBe(false);
    expect(result.report).toContain(input.outputText);
    expect(result.report).toContain("把停铃提前");
    for (const complete of [vi.fn().mockResolvedValue({ success: false, error: "断网" }), vi.fn().mockRejectedValue(new Error("超时"))]) {
      expect((await reviewDaojieGeneration(input, complete)).passed).toBe(false);
      expect(complete).toHaveBeenCalledTimes(1);
    }
  });
  it("实际时长201秒在联网前拒绝，不能相信自检178秒", async () => {
    const complete = vi.fn();
    const result = await reviewDaojieGeneration({ ...input, stage: "storyboard", totalDurationSeconds: 201 }, complete);
    expect(result.passed).toBe(false);
    expect(result.report).toContain("201");
    expect(complete).not.toHaveBeenCalled();
  });
  it.each([
    [script.replace("0.5分钟", "0.6分钟"), "合计"],
    [script.replace("0.5分钟", "30秒"), "头部"],
    [script.replace("·约30秒", "·约0秒"), "场次"],
    [script.replace("·约30秒", "·约未知秒"), "场次"],
    [script.replace("0.5分钟", "3.5分钟").replace("·约30秒", "·约210秒"), "180秒"],
    [script.replace("## 改编追踪", "改编追踪"), "章节"],
  ])("剧本格式或时长异常在联网前拒绝: %s", async (outputText, reason) => {
    const complete = vi.fn().mockResolvedValue({ success: true, text: pass });
    const result = await reviewDaojieGeneration({ ...input, outputText }, complete);
    expect(result.passed).toBe(false);
    expect(result.report).toContain(reason);
    expect(complete).not.toHaveBeenCalled();
  });
});

it("道劫严格改编不再注入通用新场/OS/强制物理布光许可", () => {
  const strict = buildStageMessages("scriptDraft", { chapterTitle: "章", chapterText: "原文", strictDaojieAdaptation: true });
  expect(strict.system).not.toContain("光源方向、色温、明暗比");
  expect(strict.system).not.toContain("允许为衔接/落地新增");
  expect(strict.system).toContain("改编追踪");
});
