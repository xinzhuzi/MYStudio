import { describe, expect, it, vi } from "vitest";
import { buildStageMessages } from "./script-planning";
import { buildDirectorPlanMessages } from "./director-plan";
import { buildStoryboardTableMessages } from "./storyboard-table";
import { buildStudioManualContext } from "./manuals";
import { buildDaojieAuditMessages, isDaojieAdaptation, reviewDaojieGeneration } from "./daojie-generation-audit";
const script = "# 道劫 EP1：问铃\n# 范围与目标：问铃 | 时长：0.5分钟\n# 已确定要求：未设\n\n## 剧情梗概\n问铃。\n\n**1 山门 未定/外 ·约30秒**\n人物：玄清子\n镜头1：铃声停了。玄清子问。\n\n## 改编追踪\n| 原文位置 | 是否采用 | 视听表达 | 待确认 |";
const input = { stage: "script" as const, sourceText: "玄清子问后，铃声才停。", outputText: script };
const checks = { facts: true, chronology: true, dialogue: true, stageBoundary: true, visibleCharacters: true };
const validInput = { ...input, outputText: script.replace("铃声停了。玄清子问。", "玄清子问。铃声才停。") };
const anchor = { outputQuote: "玄清子问。铃声才停。", sourceQuote: input.sourceText, sourceKind: "chapter", kind: "physical_fact", supported: true, reason: "本章问后停铃，保留顺序；该段无引语，未补原话或OS；人物与阶段一致" };
const evidence = { facts: [anchor], chronology: [anchor], dialogue: [anchor], stageBoundary: [anchor], visibleCharacters: [anchor] };
const pass = JSON.stringify({ stage: "script", passed: true, checks, evidence, findings: [] });
const legacyPass = JSON.stringify({ stage: "script", passed: true, checks, findings: [] });
const decision = () => ({ stage: "script", passed: true, checks: { ...checks }, evidence: { facts: [{ ...anchor }], chronology: [{ ...anchor }], dialogue: [{ ...anchor }], stageBoundary: [{ ...anchor }], visibleCharacters: [{ ...anchor }] }, findings: [] as { dimension: string; outputQuote: string; sourceQuote: string; reason: string }[] });
describe("道劫生成写回审核", () => {
  it.each([180, 195])("严格剧本与分镜在%s秒通过时长门并进入语义审核", async (seconds) => {
    const outputText = validInput.outputText.replace("0.5分钟", `${seconds / 60}分钟`).replace("·约30秒", `·约${seconds}秒`);
    const complete = vi.fn().mockResolvedValue({ success: true, text: pass });
    expect((await reviewDaojieGeneration({ ...validInput, outputText }, complete)).passed).toBe(true);
    const storyboardComplete = vi.fn().mockResolvedValue({ success: true, text: JSON.stringify({ ...decision(), stage: "storyboard" }) });
    expect((await reviewDaojieGeneration({ ...validInput, stage: "storyboard", totalDurationSeconds: seconds }, storyboardComplete)).passed).toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(storyboardComplete).toHaveBeenCalledTimes(1);
  });

  it("196秒剧本与分镜在模型调用前拒绝", async () => {
    const complete = vi.fn();
    const outputText = validInput.outputText.replace("0.5分钟", `${196 / 60}分钟`).replace("·约30秒", "·约196秒");
    const result = await reviewDaojieGeneration({ ...validInput, outputText }, complete);
    expect(result.passed).toBe(false);
    expect(result.report).toContain("195秒");
    const storyboard = await reviewDaojieGeneration({ ...validInput, stage: "storyboard", totalDurationSeconds: 196 }, complete);
    expect(storyboard.passed).toBe(false);
    expect(storyboard.report).toContain("195秒");
    expect(complete).not.toHaveBeenCalled();
  });

  it("提供从零编号的连续引文目录，不补标点或拼接编号", () => {
    const material = { stage: "planning" as const, sourceText: "“命。”柜台后说，半钱碎银。\n她转身。", outputText: "镜头1：她转身。然后停下；没有台词。", bibleContext: "她是掌门。" };
    const request = JSON.parse(buildDaojieAuditMessages(material).user);
    for (const [field, original] of [["sourceQuoteOptions", material.sourceText], ["outputQuoteOptions", material.outputText], ["bibleQuoteOptions", material.bibleContext]] as const) {
      expect(request[field].length).toBeGreaterThan(0);
      for (const [index, entry] of request[field].entries()) {
        expect(entry).toEqual({ index, quote: expect.any(String) });
        expect(original.includes(entry.quote)).toBe(true);
      }
    }
    expect(request.sourceQuoteOptions).toEqual([{ index: 0, quote: "“命。”柜台后说，半钱碎银。" }, { index: 1, quote: "她转身。" }]);
    expect(request.outputQuoteOptions).toEqual([{ index: 0, quote: material.outputText }]);
  });
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
    const messages = buildDaojieAuditMessages(validInput);
    expect(messages.user).toContain(input.sourceText);
    expect(JSON.parse(messages.user).outputToReview).toBe(validInput.outputText);
    const complete = vi.fn().mockResolvedValue({ success: true, text: pass });
    expect((await reviewDaojieGeneration(validInput, complete)).passed).toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it.each([
    [input, legacyPass],
    [{ stage: "planning" as const, sourceText: "她推开门。", outputText: "她推开门，门轴发出刺耳的尖啸。" }, JSON.stringify({ stage: "planning", passed: true, checks, findings: [] })],
  ])("五true空findings不能自证时序或物理新增无误", async (material, text) => {
    const complete = vi.fn().mockResolvedValue({ success: true, text });
    const result = await reviewDaojieGeneration(material, complete);
    expect(result.passed).toBe(false);
    expect(result.report).toContain(material.outputText);
    expect(result.report).toContain(text);
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it.each(["facts", "chronology", "dialogue", "stageBoundary", "visibleCharacters"] as const)("%s证据的输出和本章引文都必须逐字定位", async (dimension) => {
    for (const field of ["outputQuote", "sourceQuote"] as const) {
      const audit = decision();
      audit.evidence[dimension][0][field] = "不能逐字定位的拼接……引文";
      expect((await reviewDaojieGeneration(validInput, async () => ({ success: true, text: JSON.stringify(audit) }))).passed).toBe(false);
    }
  });
  it.each(["facts", "chronology", "dialogue", "stageBoundary", "visibleCharacters"] as const)("%s不能仅以圣经/上游或空锚点替代本章支持", async (dimension) => {
    for (const sourceKind of ["chapter", "bible"]) {
      const audit = decision();
      audit.evidence[dimension][0].sourceKind = sourceKind;
      audit.evidence[dimension][0].sourceQuote = "旁章里铃声先停。";
      const material = { ...validInput, bibleContext: "旁章里铃声先停。", scriptText: "旁章里铃声先停。", planText: "旁章里铃声先停。" };
      expect((await reviewDaojieGeneration(material, async () => ({ success: true, text: JSON.stringify(audit) }))).passed).toBe(false);
    }
    const audit = decision();
    audit.evidence[dimension][0].sourceQuote = "";
    expect((await reviewDaojieGeneration(validInput, async () => ({ success: true, text: JSON.stringify(audit) }))).passed).toBe(false);
  });
  it("圣经只补充身份说明，每维仍保留本章锚点", async () => {
    const audit = decision();
    const identity = { ...anchor, outputQuote: "玄清子", sourceKind: "bible", sourceQuote: "玄清子是掌门。", kind: "identity" };
    audit.evidence.facts.push(identity);
    audit.evidence.visibleCharacters.push(identity);
    const material = { ...validInput, bibleContext: identity.sourceQuote };
    expect((await reviewDaojieGeneration(material, async () => ({ success: true, text: JSON.stringify(audit) }))).passed).toBe(true);
    audit.evidence.facts[1].kind = "physical_fact";
    expect((await reviewDaojieGeneration(material, async () => ({ success: true, text: JSON.stringify(audit) }))).passed).toBe(false);
  });
  it.each(["chronology", "dialogue", "visibleCharacters"] as const)("%s不得用creative_intent绕过事件/原话/出镜核对", async (dimension) => {
    const audit = decision();
    audit.evidence[dimension][0].kind = "creative_intent";
    expect((await reviewDaojieGeneration(validInput, async () => ({ success: true, text: JSON.stringify(audit) }))).passed).toBe(false);
  });
  it("非现场配乐与镜头意图用场景原文作上下文，不要求原文发生该设计", async () => {
    const audit = decision();
    audit.stage = "planning";
    const creative = { ...anchor, outputQuote: "非现场配乐建议：低音弦乐；镜头意图：保持远景。", kind: "creative_intent", reason: "场景级设计，不断言现场存在新声源或动作" };
    audit.evidence.facts.push(creative);
    audit.evidence.stageBoundary.push(creative);
    const material = { ...validInput, stage: "planning" as const, outputText: validInput.outputText + "\n" + creative.outputQuote };
    expect((await reviewDaojieGeneration(material, async () => ({ success: true, text: JSON.stringify(audit) }))).passed).toBe(true);
  });
  it("证据未支持而checks/passed声称通过时拒绝", async () => {
    const audit = decision();
    audit.evidence.chronology[0].supported = false;
    expect((await reviewDaojieGeneration(validInput, async () => ({ success: true, text: JSON.stringify(audit) }))).passed).toBe(false);
  });
  it("同一输出引文不能同时标为现场事实和创意意图", async () => {
    const audit = decision();
    audit.evidence.stageBoundary[0].kind = "creative_intent";
    expect((await reviewDaojieGeneration(validInput, async () => ({ success: true, text: JSON.stringify(audit) }))).passed).toBe(false);
  });
  it.each(["facts", "chronology", "dialogue", "stageBoundary", "visibleCharacters"] as const)("%s不得缺证据或以空数组自证", async (dimension) => {
    const audit = decision();
    audit.evidence[dimension] = [];
    expect((await reviewDaojieGeneration(validInput, async () => ({ success: true, text: JSON.stringify(audit) }))).passed).toBe(false);
    const { [dimension]: _missing, ...remaining } = audit.evidence;
    expect((await reviewDaojieGeneration(validInput, async () => ({ success: true, text: JSON.stringify({ ...audit, evidence: remaining }) }))).passed).toBe(false);
  });
  it.each(["门轴发出尖啸。", "她转身跃起。", "门拔高一丈。", "门泛出青光。", "门凭空消失。"])('无本章支持的现场断言保留明确拒绝理由: %s', async (outputQuote) => {
    const audit = decision();
    audit.stage = "planning";
    audit.passed = false;
    audit.checks.facts = false;
    audit.evidence.facts.push({ ...anchor, outputQuote, sourceQuote: "", supported: false, reason: "原文未支持该现场断言" });
    audit.findings.push({ dimension: "facts", outputQuote, sourceQuote: "", reason: "原文未支持该现场断言" });
    const material = { ...validInput, stage: "planning" as const, outputText: validInput.outputText + outputQuote };
    const complete = vi.fn().mockResolvedValue({ success: true, text: JSON.stringify(audit) });
    const result = await reviewDaojieGeneration(material, complete);
    expect(result.passed).toBe(false);
    expect(result.report.split("\n\n")[1]).toContain("原文未支持该现场断言");
    expect(result.report).toContain(material.outputText);
    expect(complete).toHaveBeenCalledTimes(1);
    audit.findings = [];
    const inconsistent = await reviewDaojieGeneration(material, async () => ({ success: true, text: JSON.stringify(audit) }));
    expect(inconsistent.report.split("\n\n")[1]).toContain("判定不一致");
  });
  it("findings必须对应失败维度及同一对未支持引文", async () => {
    const audit = decision();
    audit.passed = false;
    audit.checks.chronology = false;
    audit.evidence.chronology[0].supported = false;
    audit.findings = [{ dimension: "chronology", outputQuote: "玄清子", sourceQuote: input.sourceText, reason: "引文对不上" }];
    const result = await reviewDaojieGeneration(validInput, async () => ({ success: true, text: JSON.stringify(audit) }));
    expect(result.report.split("\n\n")[1]).toContain("判定不一致");
  });
  it.each(["script", "planning", "storyboard"] as const)("%s的有效五维证据仍可通过单次审核", async (stage) => {
    const audit = { ...decision(), stage };
    const complete = vi.fn().mockResolvedValue({ success: true, text: JSON.stringify(audit) });
    expect((await reviewDaojieGeneration({ ...validInput, stage, totalDurationSeconds: 30 }, complete)).passed).toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it.each(["", "审核通过", "{}", '{"passed":true}', pass.replace('"chronology":true,', ""), pass.replace('"stage":"script"', '"stage":"planning"')])("无效/缺维度/错阶段协议拒绝写回: %s", async (text) => {
    expect((await reviewDaojieGeneration(input, async () => ({ success: true, text }))).passed).toBe(false);
  });
  it("时序问题、传输失败和异常均拒绝，失败稿及审核保留，无自动重试", async () => {
    const audit = decision();
    audit.passed = false;
    audit.checks.chronology = false;
    for (const entries of Object.values(audit.evidence)) entries[0].outputQuote = "铃声停了。玄清子问。";
    audit.evidence.chronology[0].supported = false;
    audit.findings.push({ dimension: "chronology", outputQuote: "铃声停了。玄清子问。", sourceQuote: input.sourceText, reason: "把停铃提前" });
    const failed = JSON.stringify(audit);
    const result = await reviewDaojieGeneration(input, async () => ({ success: true, text: failed }));
    expect(result.passed).toBe(false);
    expect(result.report).toContain(input.outputText);
    expect(result.report.split("\n\n")[1]).toContain("把停铃提前");
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
    [script.replace("0.5分钟", "3.5分钟").replace("·约30秒", "·约210秒"), "195秒"],
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

const indexedInput = { stage: "planning" as const, sourceText: "玄清子问。\n铃声才停。", outputText: "玄清子问。\n铃声才停。", bibleContext: "玄清子是掌门。" };
const indexedDecision = () => {
  const entry = () => ({ outputQuoteIndex: 0, sourceQuoteIndex: 0 as number | null, sourceKind: "chapter", kind: "physical_fact", supported: true, reason: "核对本章场景" });
  return { stage: "planning", passed: true, checks: { ...checks }, evidence: { facts: [entry()], chronology: [entry()], dialogue: [entry()], stageBoundary: [entry()], visibleCharacters: [entry()] }, findings: [] as { dimension: string; outputQuoteIndex: number; sourceQuoteIndex: number | null; reason: string }[] };
};
const reviewIndexed = (audit: unknown, material = indexedInput) => reviewDaojieGeneration(material, async () => ({ success: true, text: JSON.stringify(audit) }));

const tableDecision = () => {
  const audit = indexedDecision();
  const withoutKind = ({ kind: _kind, ...entry }: typeof audit.evidence.facts[number]) => entry;
  return {
    ...audit,
    protocolVersion: "indexed-kind-table-v1",
    classifications: [{ outputQuoteIndex: 0, kind: "physical_fact" }],
    evidence: {
      facts: audit.evidence.facts.map(withoutKind), chronology: audit.evidence.chronology.map(withoutKind),
      dialogue: audit.evidence.dialogue.map(withoutKind), stageBoundary: audit.evidence.stageBoundary.map(withoutKind),
      visibleCharacters: audit.evidence.visibleCharacters.map(withoutKind),
    },
  };
};

const bidirectionalInput = { ...indexedInput, requiredProtocol: "bidirectional-v1" as const };
const bidirectionalDecision = () => ({
  ...tableDecision(), protocolVersion: "bidirectional-v1",
  sourceDispositions: [0, 1].map((sourceQuoteIndex) => ({
    sourceQuoteIndex,
    claims: [{ sourceStart: 0, sourceEnd: 5, category: "fact", importance: "ordinary", disposition: "preserved", medium: "image", knowledgeAttributionChanged: false, outputQuoteIndexes: [sourceQuoteIndex], reason: "画面保留该原文事实" }],
  })),
});

describe("道劫双向保真协议", () => {
  it("重要信息保留但知情归属变化时生成独立裁定项", async () => {
    const audit = bidirectionalDecision();
    const response = { ...audit, sourceDispositions: audit.sourceDispositions.map((row) => ({
      ...row,
      claims: row.claims.map((claim) => ({ ...claim, importance: "important", knowledgeAttributionChanged: row.sourceQuoteIndex === 0 })),
    })) };
    const complete = vi.fn().mockResolvedValue({ success: true, text: JSON.stringify(response) });
    const result = await reviewDaojieGeneration(bidirectionalInput, complete);
    expect(result).toMatchObject({ passed: false, candidate: true, fidelity: { decisionItems: [{
      itemId: "source:0:0:5:knowledge-attribution-changed", sourceQuoteIndex: 0, sourceStart: 0, sourceEnd: 5,
      disposition: "knowledge-attribution-changed",
    }] } });
    expect(result.fidelity?.decisionItems).toHaveLength(1);
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it("重要信息压缩后归属变化仍须独立裁定", async () => {
    const audit = bidirectionalDecision();
    const response = { ...audit, sourceDispositions: audit.sourceDispositions.map((row) => ({
      ...row,
      claims: row.claims.map((claim) => ({ ...claim, importance: "important", disposition: "compressed", knowledgeAttributionChanged: row.sourceQuoteIndex === 0 })),
    })) };
    const complete = vi.fn().mockResolvedValue({ success: true, text: JSON.stringify(response) });
    const result = await reviewDaojieGeneration(bidirectionalInput, complete);
    expect(result).toMatchObject({ passed: false, candidate: true });
    expect(result.fidelity?.decisionItems).toEqual([{
      itemId: "source:0:0:5:knowledge-attribution-changed", sourceQuoteIndex: 0, sourceStart: 0, sourceEnd: 5,
      disposition: "knowledge-attribution-changed",
    }]);
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it("普通信息归属变化不升级为重要信息必裁项", async () => {
    const audit = bidirectionalDecision();
    const response = { ...audit, sourceDispositions: audit.sourceDispositions.map((row) => ({
      ...row, claims: row.claims.map((claim) => ({ ...claim, knowledgeAttributionChanged: true })),
    })) };
    const complete = vi.fn().mockResolvedValue({ success: true, text: JSON.stringify(response) });
    const result = await reviewDaojieGeneration(bidirectionalInput, complete);
    expect(result).toMatchObject({ passed: true, candidate: true });
    expect(result.fidelity?.decisionItems).toEqual([]);
    expect(result.fidelity?.sourceDispositions.every((row) => row.claims.every((claim) => claim.knowledgeAttributionChanged))).toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it("归属变化须显式布尔信号，不能缺省或以理由文字代替", async () => {
    const audit = bidirectionalDecision();
    for (const signal of [undefined, "false", null, 1]) {
      const response = { ...audit, sourceDispositions: audit.sourceDispositions.map((row) => ({
        ...row, claims: row.claims.map((claim) => ({ ...claim, knowledgeAttributionChanged: signal })),
      })) };
      const result = await reviewDaojieGeneration(bidirectionalInput, async () => ({ success: true, text: JSON.stringify(response) }));
      expect(result.passed).toBe(false);
      expect(result).not.toHaveProperty("fidelity");
    }
  });
  it("重要后置与归属变化分别裁定，失真或防新增失败仍不能转为候审", async () => {
    const audit = bidirectionalDecision();
    const response = { ...audit, sourceDispositions: audit.sourceDispositions.map((row) => ({
      ...row, claims: row.claims.map((claim) => ({ ...claim, importance: "important", disposition: "deferred", knowledgeAttributionChanged: true })),
    })) };
    const result = await reviewDaojieGeneration(bidirectionalInput, async () => ({ success: true, text: JSON.stringify(response) }));
    expect(result.passed).toBe(false);
    expect(result.fidelity?.decisionItems.map((item) => item.itemId)).toEqual([
      "source:0:0:5:deferred", "source:0:0:5:knowledge-attribution-changed",
      "source:1:0:5:deferred", "source:1:0:5:knowledge-attribution-changed",
    ]);
    const distorted = { ...response, sourceDispositions: response.sourceDispositions.map((row) => ({
      ...row, claims: row.claims.map((claim) => ({ ...claim, disposition: "distorted" })),
    })) };
    const inventedKnowledge = { ...response, passed: false, checks: { ...response.checks, facts: false },
      evidence: { ...response.evidence, facts: [{ ...response.evidence.facts[0], supported: false }] },
      findings: [{ dimension: "facts", outputQuoteIndex: 0, sourceQuoteIndex: 0, reason: "角色越知或提前揭示" }],
    };
    for (const rejected of [distorted, inventedKnowledge]) {
      const blocked = await reviewDaojieGeneration(bidirectionalInput, async () => ({ success: true, text: JSON.stringify(rejected) }));
      expect(blocked.passed).toBe(false);
      expect(blocked).not.toHaveProperty("fidelity");
      expect(blocked).not.toHaveProperty("candidate");
    }
  });
  it("双向请求明确要求知情归属信号，媒介转换不自动等于归属变化", () => {
    const request = buildDaojieAuditMessages(bidirectionalInput);
    expect(request.system).toContain('"knowledgeAttributionChanged":false');
    expect(request.system).toContain("每条必填布尔值knowledgeAttributionChanged");
    expect(request.system).toContain("仅换媒介不等于知情归属变化");
    expect(request.system).toContain("重要归属变化由程序生成独立裁定项");
    expect(request.system).toContain("越知、提前揭示和失真不得借裁定放行");
  });
  it("同段重要主张分别生成本地裁定项，重复原文仍按源索引独立绑定", async () => {
    const audit = bidirectionalDecision();
    const material = { ...bidirectionalInput, sourceText: "玄清子问。\n为救母。须折寿。\n为救母。须折寿。", outputText: "玄清子问。" };
    const sourceDispositions = [audit.sourceDispositions[0], ...[1, 2].map((sourceQuoteIndex) => ({
      sourceQuoteIndex,
      claims: [
        { sourceStart: 0, sourceEnd: 4, category: "motivation", importance: "important", disposition: "omitted", medium: "none", knowledgeAttributionChanged: false, outputQuoteIndexes: [], reason: "救母动机无承载" },
        { sourceStart: 4, sourceEnd: 8, category: "cost", importance: "important", disposition: "deferred", medium: "none", knowledgeAttributionChanged: false, outputQuoteIndexes: [], reason: "折寿代价后置，尚未裁定" },
      ],
    }))];
    const complete = vi.fn().mockResolvedValue({ success: true, text: JSON.stringify({ ...audit, sourceDispositions }) });
    const result = await reviewDaojieGeneration(material, complete);
    expect(result).toMatchObject({ passed: false, candidate: true, fidelity: {
      decisionItems: [
        { itemId: "source:1:0:4:omitted", sourceQuoteIndex: 1, sourceStart: 0, sourceEnd: 4, disposition: "omitted" },
        { itemId: "source:1:4:8:deferred", sourceQuoteIndex: 1, sourceStart: 4, sourceEnd: 8, disposition: "deferred" },
        { itemId: "source:2:0:4:omitted", sourceQuoteIndex: 2, sourceStart: 0, sourceEnd: 4, disposition: "omitted" },
        { itemId: "source:2:4:8:deferred", sourceQuoteIndex: 2, sourceStart: 4, sourceEnd: 8, disposition: "deferred" },
      ],
    } });
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it("UTF-16范围与重要保留不产生删改裁定，模型不能注入裁定项或批准", async () => {
    const audit = bidirectionalDecision();
    const material = { ...bidirectionalInput, sourceText: "😀问。\n铃声才停。" };
    const first = { ...audit.sourceDispositions[0], claims: [{ ...audit.sourceDispositions[0].claims[0], sourceStart: 2, sourceEnd: 4, importance: "important", medium: "vs" }] };
    const response = { ...audit, sourceDispositions: [first, audit.sourceDispositions[1]] };
    const result = await reviewDaojieGeneration(material, async () => ({ success: true, text: JSON.stringify(response) }));
    expect(result).toMatchObject({ passed: true, fidelity: { decisionItems: [], sourceDispositions: [first, audit.sourceDispositions[1]] } });
    for (const extra of [{ decisionItems: [] }, { decisions: [{ itemId: "source:0:2:4:omitted", decision: "accepted" }] }]) {
      const rejected = await reviewDaojieGeneration(material, async () => ({ success: true, text: JSON.stringify({ ...response, ...extra }) }));
      expect(rejected.passed).toBe(false);
      expect(rejected).not.toHaveProperty("fidelity");
    }
  });
  it.each(["", "{}", "{", '{"protocolVersion":"bidirectional-v1",'])("新协议空或畸形JSON拒绝且不自动重试: %s", async (text) => {
    const complete = vi.fn().mockResolvedValue({ success: true, text });
    const result = await reviewDaojieGeneration(bidirectionalInput, complete);
    expect(result.passed).toBe(false);
    expect(result).not.toHaveProperty("fidelity");
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it("新协议原文或输出为空时不发审核请求", async () => {
    for (const material of [{ ...bidirectionalInput, sourceText: " \n" }, { ...bidirectionalInput, outputText: "" }]) {
      const complete = vi.fn();
      const result = await reviewDaojieGeneration(material, complete);
      expect(result.passed).toBe(false);
      expect(result).not.toHaveProperty("fidelity");
      expect(complete).not.toHaveBeenCalled();
    }
  });
  it("普通合理压缩通过，重要后置仅候审，失真没有可晋级保真记录", async () => {
    const audit = bidirectionalDecision();
    const compressed = { ...audit, sourceDispositions: audit.sourceDispositions.map((row) => ({ ...row, claims: row.claims.map((claim) => ({ ...claim, disposition: "compressed", reason: "问询与停铃均有画面，省去重复修辞而不损失事实" })) })) };
    const accepted = await reviewDaojieGeneration(bidirectionalInput, async () => ({ success: true, text: JSON.stringify(compressed) }));
    expect(accepted).toMatchObject({ passed: true, candidate: true, fidelity: { technicallyValid: true } });
    for (const disposition of ["deferred", "distorted"] as const) {
      const changed = { ...audit, sourceDispositions: audit.sourceDispositions.map((row) => ({ ...row, claims: row.claims.map((claim) => ({ ...claim, importance: "important", disposition, medium: "none", knowledgeAttributionChanged: false, outputQuoteIndexes: [], reason: "重要信息后置或语义失真" })) })) };
      const result = await reviewDaojieGeneration(bidirectionalInput, async () => ({ success: true, text: JSON.stringify(changed) }));
      expect(result.passed).toBe(false);
      if (disposition === "deferred") expect(result).toMatchObject({ candidate: true, fidelity: { technicallyValid: true } });
      else { expect(result).not.toHaveProperty("fidelity"); expect(result).not.toHaveProperty("candidate"); }
    }
  });
  it.each(["missing-row", "duplicate-row", "row-range", "no-claims", "duplicate-range", "empty-reason", "negative", "fraction", "end-range", "empty-range", "blank-range", "carrier-range", "duplicate-carrier", "missing-carrier", "none-with-carrier", "extra"])("畸形去向 %s 拒绝且不带有效保真记录", async (mode) => {
    const audit = bidirectionalDecision();
    const first = audit.sourceDispositions[0];
    const claim = first.claims[0];
    if (mode === "missing-row") audit.sourceDispositions = [first];
    if (mode === "duplicate-row") audit.sourceDispositions = [first, first];
    if (mode === "row-range") first.sourceQuoteIndex = 2;
    if (mode === "no-claims") first.claims = [];
    if (mode === "duplicate-range") first.claims = [claim, { ...claim }];
    if (mode === "empty-reason") claim.reason = " \n ";
    if (mode === "negative") claim.sourceStart = -1;
    if (mode === "fraction") claim.sourceStart = 0.5;
    if (mode === "end-range") claim.sourceEnd = 6;
    if (mode === "empty-range") claim.sourceEnd = 0;
    if (mode === "blank-range") { claim.sourceEnd = 1; }
    if (mode === "carrier-range") claim.outputQuoteIndexes = [2];
    if (mode === "duplicate-carrier") claim.outputQuoteIndexes = [0, 0];
    if (mode === "missing-carrier") claim.outputQuoteIndexes = [];
    if (mode === "none-with-carrier") claim.medium = "none";
    if (mode === "extra") Object.assign(claim, { approved: true });
    const material = mode === "blank-range" ? { ...bidirectionalInput, sourceText: "玄 清子问。\n铃声才停。" } : bidirectionalInput;
    if (mode === "blank-range") claim.sourceStart = 1, claim.sourceEnd = 2;
    const complete = vi.fn().mockResolvedValue({ success: true, text: JSON.stringify(audit) });
    const result = await reviewDaojieGeneration(material, complete);
    expect(result.passed).toBe(false);
    expect(result).not.toHaveProperty("fidelity");
    expect(result).not.toHaveProperty("candidate");
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it.each([decision(), indexedDecision(), tableDecision(), { ...bidirectionalDecision(), protocolVersion: "unknown" }, { ...bidirectionalDecision(), sourceDispositions: undefined }])("要求新协议时拒绝旧版或缺损响应，不降级", async (audit) => {
    const result = await reviewDaojieGeneration(bidirectionalInput, async () => ({ success: true, text: JSON.stringify(audit) }));
    expect(result.passed).toBe(false);
    expect(result).not.toHaveProperty("fidelity");
  });
  it("防新增失败或传输错误不能转为候审裁定", async () => {
    const audit = bidirectionalDecision();
    const unsupported = { ...audit, passed: false, checks: { ...audit.checks, facts: false }, evidence: { ...audit.evidence, facts: [{ ...audit.evidence.facts[0], supported: false }] }, findings: [{ dimension: "facts", outputQuoteIndex: 0, sourceQuoteIndex: 0, reason: "新增现场事实" }] };
    for (const complete of [vi.fn().mockResolvedValue({ success: true, text: JSON.stringify(unsupported) }), vi.fn().mockResolvedValue({ success: false, error: "断网" }), vi.fn().mockRejectedValue(new Error("超时"))]) {
      const result = await reviewDaojieGeneration(bidirectionalInput, complete);
      expect(result.passed).toBe(false);
      expect(result).not.toHaveProperty("fidelity");
      expect(result).not.toHaveProperty("candidate");
      expect(complete).toHaveBeenCalledTimes(1);
    }
  });
  it("要求双向审核时请求只给新协议，明确逐源主张、UTF-16定位与语义覆盖局限", () => {
    const request = buildDaojieAuditMessages({ ...indexedInput, requiredProtocol: "bidirectional-v1" });
    expect(request.system).toContain('"protocolVersion":"bidirectional-v1"');
    expect(request.system).toContain("sourceDispositions");
    expect(request.system).toContain("每个非空原文索引恰一行");
    expect(request.system).toContain("UTF-16");
    expect(request.system).toContain("段内不同重要主张分别列出");
    expect(request.system).toContain("全索引覆盖不证明语义主张识别完备");
    expect(request.system).toContain("重要遗漏或后置由程序判为候审");
    expect(request.system).not.toContain("indexed-kind-table-v1");
    expect(request.system).toContain("全知叙述不自动变角色心声");
    expect(JSON.parse(request.user).sourceQuoteOptions).toEqual([
      { index: 0, quote: "玄清子问。" }, { index: 1, quote: "铃声才停。" },
    ]);
  });
  it("重要动机完全遗漏时可保留候审结果，无需伪造输出锚且仅审核一次", async () => {
    const material = {
      ...indexedInput,
      requiredProtocol: "bidirectional-v1" as const,
      sourceText: "玄清子问。\n他逃亡十年，只因不愿交出断剑。",
      outputText: "玄清子问。",
    };
    const sourceDispositions = [
      { sourceQuoteIndex: 0, claims: [{ sourceStart: 0, sourceEnd: 5, category: "fact", importance: "ordinary", disposition: "preserved", medium: "image", knowledgeAttributionChanged: false, outputQuoteIndexes: [0], reason: "画面保留问询" }] },
      { sourceQuoteIndex: 1, claims: [{ sourceStart: 0, sourceEnd: 15, category: "motivation", importance: "important", disposition: "omitted", medium: "none", knowledgeAttributionChanged: false, outputQuoteIndexes: [], reason: "稿中无十年逃亡及不交断剑的动机，需要用户裁定" }] },
    ];
    const audit = { ...tableDecision(), protocolVersion: "bidirectional-v1", sourceDispositions };
    const complete = vi.fn().mockResolvedValue({ success: true, text: JSON.stringify(audit) });
    const result = await reviewDaojieGeneration(material, complete);
    expect(result.passed).toBe(false);
    expect(result).toMatchObject({ candidate: true, fidelity: { protocolVersion: "bidirectional-v1", sourceDispositions, technicallyValid: true } });
    expect(result.report).toContain("重要信息待逐项裁定");
    expect(result.report).toContain(material.outputText);
    expect(complete).toHaveBeenCalledTimes(1);
  });
});

describe("道劫单一分类表协议", () => {
  it("一个索引只分类一次，五维独立引用且保留原始wire", async () => {
    const audit = tableDecision();
    audit.evidence.chronology[0].sourceQuoteIndex = 1;
    const wire = JSON.stringify(audit);
    const complete = vi.fn().mockResolvedValue({ success: true, text: wire });
    const result = await reviewDaojieGeneration(indexedInput, complete);
    expect(result.passed).toBe(true);
    expect(result.report).toContain(wire);
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it.each(["script", "planning", "storyboard"] as const)("%s请求明确使用新版本、单一分类表与无kind的维度证据", (stage) => {
    const { system } = buildDaojieAuditMessages({ ...indexedInput, stage });
    expect(system).toContain('"protocolVersion":"indexed-kind-table-v1"');
    expect(system).toContain('"classifications":[{"outputQuoteIndex":0,"kind":"physical_fact"}]');
    expect(system).toContain("outputQuoteIndex/sourceQuoteIndex/sourceKind/supported/reason");
    expect(system).not.toContain("outputQuoteIndex/sourceQuoteIndex/sourceKind/kind/supported/reason");
    expect(system).toContain("禁止在evidence内重复kind");
  });
  it.each(["same", "conflicting", "missing", "unused", "empty"])("拒绝%s分类表", async (mode) => {
    const audit = tableDecision();
    if (mode === "same") audit.classifications.push({ ...audit.classifications[0] });
    if (mode === "conflicting") audit.classifications.push({ outputQuoteIndex: 0, kind: "identity" });
    if (mode === "missing") audit.evidence.facts[0].outputQuoteIndex = 1;
    if (mode === "unused") audit.classifications.push({ outputQuoteIndex: 1, kind: "identity" });
    if (mode === "empty") audit.classifications = [];
    expect((await reviewIndexed(audit)).report.split("\n\n")[1]).toContain("协议无效");
  });
  it.each(["output", "source", "classification"])("%s索引拒绝负数/小数/错误类型/越界", async (target) => {
    for (const index of [-1, 0.5, "0", true, null, 2, 999]) {
      const audit = tableDecision();
      if (target === "classification") Object.assign(audit.classifications[0], { outputQuoteIndex: index });
      else Object.assign(audit.evidence.facts[0], { [target === "output" ? "outputQuoteIndex" : "sourceQuoteIndex"]: index });
      expect((await reviewIndexed(audit)).report.split("\n\n")[1]).toContain("协议无效");
    }
  });
  it("拒绝未知或缺少版本、混合协议及各层额外键，不回退旧协议", async () => {
    for (const version of ["unknown", null, false, 1]) {
      expect((await reviewIndexed({ ...tableDecision(), protocolVersion: version })).passed).toBe(false);
      expect((await reviewIndexed({ ...indexedDecision(), protocolVersion: version })).passed).toBe(false);
    }
    const { protocolVersion: _version, ...noVersion } = tableDecision();
    expect((await reviewIndexed(noVersion)).passed).toBe(false);
    for (const level of ["top", "classification", "evidence", "checks", "dimension", "finding"]) {
      const audit = tableDecision();
      if (level === "top") Object.assign(audit, { extra: true });
      if (level === "classification") Object.assign(audit.classifications[0], { supported: true });
      if (level === "evidence") Object.assign(audit.evidence.facts[0], { kind: "physical_fact" });
      if (level === "checks") Object.assign(audit.checks, { extra: true });
      if (level === "dimension") Object.assign(audit.evidence, { extra: [] });
      if (level === "finding") audit.findings.push(Object.assign({ dimension: "facts", outputQuoteIndex: 0, sourceQuoteIndex: 0, reason: "错误" }, { kind: "physical_fact" }));
      expect((await reviewIndexed(audit)).report.split("\n\n")[1]).toContain("协议无效");
    }
    for (const extra of [{ outputQuote: "玄清子问。" }, { sourceQuote: "玄清子问。" }]) {
      const audit = tableDecision();
      Object.assign(audit.evidence.facts[0], extra);
      expect((await reviewIndexed(audit)).passed).toBe(false);
    }
  });
  it.each(["facts", "chronology", "dialogue", "stageBoundary", "visibleCharacters"] as const)("%s不可缺失/空数组/空reason/无本章锚点", async (dimension) => {
    const audit = tableDecision();
    audit.evidence[dimension] = [];
    expect((await reviewIndexed(audit)).passed).toBe(false);
    const { [dimension]: _missing, ...rest } = audit.evidence;
    expect((await reviewIndexed({ ...audit, evidence: rest })).passed).toBe(false);
    const emptyReason = tableDecision();
    emptyReason.evidence[dimension][0].reason = " ";
    expect((await reviewIndexed(emptyReason)).passed).toBe(false);
    const bibleOnly = tableDecision();
    bibleOnly.classifications[0].kind = "identity";
    bibleOnly.evidence[dimension][0].sourceKind = "bible";
    expect((await reviewIndexed(bibleOnly)).passed).toBe(false);
  });
  it("重复文字不同索引独立分类，不按文字合并", async () => {
    const material = { ...indexedInput, outputText: "低音弦乐。\n低音弦乐。\n她退后。", sourceText: "院中响起低音弦乐。\n她退后。" };
    const audit = tableDecision();
    audit.classifications = [{ outputQuoteIndex: 0, kind: "physical_fact" }, { outputQuoteIndex: 1, kind: "creative_intent" }, { outputQuoteIndex: 2, kind: "physical_fact" }];
    for (const entries of Object.values(audit.evidence)) Object.assign(entries[0], { outputQuoteIndex: 2, sourceQuoteIndex: 1 });
    audit.evidence.facts.push({ ...audit.evidence.facts[0], outputQuoteIndex: 0, sourceQuoteIndex: 0 });
    audit.evidence.stageBoundary.push({ ...audit.evidence.stageBoundary[0], outputQuoteIndex: 1, sourceQuoteIndex: 0 });
    expect((await reviewIndexed(audit, material)).passed).toBe(true);
  });
  it("圣经仅身份且创意维度边界保留，不由分类表赋予物理支持", async () => {
    const material = { ...indexedInput, outputText: indexedInput.outputText + "\n玄清子" };
    const audit = tableDecision();
    audit.classifications.push({ outputQuoteIndex: 2, kind: "identity" });
    const identity = { ...audit.evidence.facts[0], outputQuoteIndex: 2, sourceKind: "bible" };
    audit.evidence.facts.push(identity);
    audit.evidence.visibleCharacters.push(identity);
    expect((await reviewIndexed(audit, material)).passed).toBe(true);
    audit.classifications[1].kind = "physical_fact";
    expect((await reviewIndexed(audit, material)).report.split("\n\n")[1]).toContain("判定不一致");
    audit.classifications[1].kind = "identity";
    identity.sourceQuoteIndex = 1;
    expect((await reviewIndexed(audit, material)).report.split("\n\n")[1]).toContain("协议无效");
    const creative = tableDecision();
    creative.classifications[0].kind = "creative_intent";
    expect((await reviewIndexed(creative)).report.split("\n\n")[1]).toContain("判定不一致");
  });
  it("同索引各维supported独立，null失败证据必须准确配finding", async () => {
    const audit = tableDecision();
    audit.passed = false;
    audit.checks.facts = false;
    audit.evidence.facts.push({ ...audit.evidence.facts[0], sourceQuoteIndex: null, supported: false });
    audit.findings.push({ dimension: "facts", outputQuoteIndex: 0, sourceQuoteIndex: null, reason: "无来源现场声" });
    const result = await reviewIndexed(audit);
    expect(result.passed).toBe(false);
    expect(result.report.split("\n\n")[1]).toContain("无来源现场声");
    expect(result.report.split("\n\n")[1]).not.toContain("判定不一致");
    for (const change of [{ dimension: "chronology" }, { outputQuoteIndex: 1 }, { sourceQuoteIndex: 0 }]) {
      expect((await reviewIndexed({ ...audit, findings: [{ ...audit.findings[0], ...change }] })).report.split("\n\n")[1]).toContain("判定不一致");
    }
    audit.evidence.facts[1].sourceKind = "bible";
    expect((await reviewIndexed(audit)).report.split("\n\n")[1]).toContain("协议无效");
  });
  it.each(["outputQuoteIndex", "sourceQuoteIndex"] as const)("重复文字finding的%s保留精确索引0配对", async (field) => {
    const material = { ...indexedInput, sourceText: "她退后。\n她退后。", outputText: "她退后。\n她退后。" };
    const audit = tableDecision();
    audit.classifications.push({ outputQuoteIndex: 1, kind: "physical_fact" });
    audit.passed = false;
    audit.checks.facts = false;
    audit.evidence.facts[0].supported = false;
    audit.evidence.facts.push({ ...audit.evidence.facts[0], outputQuoteIndex: 1, sourceQuoteIndex: 1, supported: true });
    audit.findings.push({ dimension: "facts", outputQuoteIndex: 0, sourceQuoteIndex: 0, reason: "索引0未支持" });
    expect((await reviewIndexed(audit, material)).report.split("\n\n")[1]).toContain("索引0未支持");
    audit.findings[0][field] = 1;
    expect((await reviewIndexed(audit, material)).report.split("\n\n")[1]).toContain("判定不一致");
  });
  it("checks/passed矛盾、错误阶段和损坏JSON仍拒绝且不重试", async () => {
    const audit = tableDecision();
    audit.evidence.facts[0].supported = false;
    expect((await reviewIndexed(audit)).report.split("\n\n")[1]).toContain("判定不一致");
    expect((await reviewIndexed({ ...tableDecision(), passed: false })).report.split("\n\n")[1]).toContain("判定不一致");
    expect((await reviewIndexed({ ...tableDecision(), stage: "script" })).passed).toBe(false);
    for (const text of [JSON.stringify(tableDecision()).slice(0, -1), "```json\n" + JSON.stringify(tableDecision()) + "\n```", ""]) {
      const complete = vi.fn().mockResolvedValue({ success: true, text });
      expect((await reviewDaojieGeneration(indexedInput, complete)).passed).toBe(false);
      expect(complete).toHaveBeenCalledTimes(1);
    }
  });
  it("分类值与finding结构仍严格，不以表级字段覆盖各维证据", async () => {
    for (const kind of ["chronology", "dialogue", "stage_boundary", "", null, true]) {
      const audit = tableDecision();
      Object.assign(audit.classifications[0], { kind });
      expect((await reviewIndexed(audit)).report.split("\n\n")[1]).toContain("协议无效");
    }
    for (const change of [{ outputQuoteIndex: -1 }, { sourceQuoteIndex: 0.5 }, { sourceQuoteIndex: 2 }, { sourceKind: "bible" }, { outputQuote: "玄清子问。" }]) {
      const audit = tableDecision();
      audit.passed = false;
      audit.checks.facts = false;
      audit.evidence.facts[0].supported = false;
      audit.findings.push({ dimension: "facts", outputQuoteIndex: 0, sourceQuoteIndex: 0, reason: "未获支持", ...change });
      expect((await reviewIndexed(audit)).report.split("\n\n")[1]).toContain("协议无效");
    }
  });
  it("每一对未支持索引均需finding且不能以圣经同号来源偷换本章", async () => {
    const material = { ...indexedInput, sourceText: "她退后。\n她退后。", outputText: "她退后。\n她退后。" };
    const audit = tableDecision();
    audit.classifications.push({ outputQuoteIndex: 1, kind: "physical_fact" });
    audit.passed = false;
    audit.checks.facts = false;
    audit.evidence.facts[0].supported = false;
    audit.evidence.facts.push({ ...audit.evidence.facts[0], outputQuoteIndex: 1, sourceQuoteIndex: 1 });
    audit.findings.push({ dimension: "facts", outputQuoteIndex: 0, sourceQuoteIndex: 0, reason: "第一处" });
    expect((await reviewIndexed(audit, material)).report.split("\n\n")[1]).toContain("判定不一致");
    audit.findings.push({ dimension: "facts", outputQuoteIndex: 1, sourceQuoteIndex: 1, reason: "第二处" });
    expect((await reviewIndexed(audit, material)).report.split("\n\n")[1]).toContain("第一处；第二处");
    audit.classifications[1].kind = "identity";
    Object.assign(audit.evidence.facts[1], { sourceKind: "bible", sourceQuoteIndex: 0 });
    audit.findings[1].sourceQuoteIndex = 0;
    expect((await reviewIndexed(audit, material)).report.split("\n\n")[1]).toContain("判定不一致");
  });
  it("null失败证据不替代本章锚点，合法新协议也不能绕过时长门", async () => {
    const audit = tableDecision();
    audit.passed = false;
    audit.checks.facts = false;
    Object.assign(audit.evidence.facts[0], { sourceQuoteIndex: null, supported: false });
    audit.findings.push({ dimension: "facts", outputQuoteIndex: 0, sourceQuoteIndex: null, reason: "无来源" });
    expect((await reviewIndexed(audit)).report.split("\n\n")[1]).toContain("判定不一致");
    for (const material of [{ ...validInput, outputText: script.replace("0.5分钟", "0.6分钟") }, { ...indexedInput, stage: "storyboard" as const, totalDurationSeconds: 196 }]) {
      const complete = vi.fn().mockResolvedValue({ success: true, text: JSON.stringify(tableDecision()) });
      expect((await reviewDaojieGeneration(material, complete)).passed).toBe(false);
      expect(complete).not.toHaveBeenCalled();
    }
  });
});

describe("道劫审核索引引用协议", () => {
  it("请求只指导索引JSON协议，仍要求语义核对", () => {
    const { system } = buildDaojieAuditMessages(indexedInput);
    expect(system).toContain("outputQuoteIndex/sourceQuoteIndex/sourceKind/supported/reason");
    expect(system).toContain("dimension/outputQuoteIndex/sourceQuoteIndex/reason");
    expect(system).toContain("从0开始");
    expect(system).toContain("sourceQuoteIndex=null");
    expect(system).toContain("physical_fact、creative_intent、identity");
    expect(system).toContain("不得因在数组中就判通过");
    expect(system).not.toContain("完整复制一个字符串");
    expect(system).not.toContain("含outputQuote/sourceQuote/");
  });
  it.each(["facts", "chronology", "dialogue", "stageBoundary", "visibleCharacters"] as const)("%s的有效索引由当前目录解析且保留其余四维", async (dimension) => {
    const audit = indexedDecision();
    audit.evidence[dimension][0].outputQuoteIndex = 1;
    audit.evidence[dimension][0].sourceQuoteIndex = 1;
    expect((await reviewIndexed(audit)).passed).toBe(true);
  });
  it.each(["。", "；"])("不同索引的现场声与非现场配乐可独立判kind，重复文本标点为%s", async (punctuation) => {
    const material = { ...indexedInput, sourceText: "院中传来低音弦乐。\n她推开门。", outputText: `现场声音：\n低音弦乐。\n非现场配乐建议：\n低音弦乐${punctuation}\n她推开门。` };
    const audit = indexedDecision();
    for (const entries of Object.values(audit.evidence)) Object.assign(entries[0], { outputQuoteIndex: 4, sourceQuoteIndex: 1 });
    audit.evidence.facts.push({ ...audit.evidence.facts[0], outputQuoteIndex: 1, sourceQuoteIndex: 0, reason: "原文明确存在现场低音弦乐" });
    audit.evidence.stageBoundary.push({ ...audit.evidence.stageBoundary[0], outputQuoteIndex: 3, sourceQuoteIndex: 0, kind: "creative_intent", reason: "另一个段落在非现场配乐建议标题下给出配乐设计" });
    expect((await reviewIndexed(audit, material)).passed).toBe(true);
  });
  it.each([
    ["physical_fact", "creative_intent"],
    ["physical_fact", "identity"],
    ["identity", "creative_intent"],
  ] as const)("同一索引的%s与%s冲突，不受维度遍历顺序影响", async (firstKind, secondKind) => {
    for (const [factsKind, stageKind] of [[firstKind, secondKind], [secondKind, firstKind]]) {
      const audit = indexedDecision();
      for (const entries of Object.values(audit.evidence)) Object.assign(entries[0], { outputQuoteIndex: 1, sourceQuoteIndex: 1 });
      Object.assign(audit.evidence.facts[0], { outputQuoteIndex: 0, sourceQuoteIndex: 0, kind: factsKind });
      Object.assign(audit.evidence.stageBoundary[0], { outputQuoteIndex: 0, sourceQuoteIndex: 0, kind: stageKind });
      const result = await reviewIndexed(audit);
      expect(result.passed).toBe(false);
      expect(result.report.split("\n\n")[1]).toContain("判定不一致");
    }
  });
  it("同一索引跨维度一致标为identity仍可通过", async () => {
    const audit = indexedDecision();
    for (const entries of Object.values(audit.evidence)) entries[0].kind = "identity";
    expect((await reviewIndexed(audit)).passed).toBe(true);
  });
  it.each(["outputQuoteIndex", "sourceQuoteIndex"] as const)("%s拒绝非整数、负数、越界和错误类型", async (field) => {
    for (const value of [-1, 0.5, 2, 999, "0", true, null]) {
      const audit = indexedDecision();
      Object.assign(audit.evidence.facts[0], { [field]: value });
      expect((await reviewIndexed(audit)).report.split("\n\n")[1]).toContain("协议无效");
    }
  });
  it("拒绝未知字段、单条混合引用和跨条混合协议", async () => {
    for (const extra of [{ outputQuote: indexedInput.outputText }, { sourceQuote: indexedInput.sourceText }, { unexpected: true }]) {
      const audit = indexedDecision();
      Object.assign(audit.evidence.facts[0], extra);
      expect((await reviewIndexed(audit)).report.split("\n\n")[1]).toContain("协议无效");
    }
    const audit = indexedDecision();
    Object.assign(audit.evidence, { chronology: [anchor] });
    expect((await reviewIndexed(audit)).report.split("\n\n")[1]).toContain("协议无效");
    const raw = decision();
    Object.assign(raw.evidence.facts[0], { outputQuoteIndex: 0 });
    expect((await reviewDaojieGeneration(validInput, async () => ({ success: true, text: JSON.stringify(raw) }))).passed).toBe(false);
  });
  it("圣经目录仅补身份，本章依据不能由圣经或上游代替", async () => {
    const audit = indexedDecision();
    const material = { ...indexedInput, outputText: indexedInput.outputText + "\n玄清子" };
    const identity = { ...audit.evidence.facts[0], outputQuoteIndex: 2, sourceKind: "bible", kind: "identity" };
    audit.evidence.facts.push(identity);
    audit.evidence.visibleCharacters.push(identity);
    expect((await reviewIndexed(audit, material)).passed).toBe(true);
    identity.sourceQuoteIndex = 1; // chapter has index 1, bible does not.
    expect((await reviewIndexed(audit, material)).report.split("\n\n")[1]).toContain("协议无效");
    identity.sourceQuoteIndex = 0;
    identity.kind = "physical_fact";
    expect((await reviewIndexed(audit, material)).report.split("\n\n")[1]).toContain("判定不一致");
    for (const dimension of ["facts", "chronology", "dialogue", "stageBoundary", "visibleCharacters"] as const) {
      const noChapter = indexedDecision();
      noChapter.evidence[dimension] = [{ ...identity, kind: "identity" }];
      expect((await reviewIndexed(noChapter, material)).passed).toBe(false);
    }
    const noBible = { ...material, bibleContext: "", scriptText: indexedInput.bibleContext, planText: indexedInput.bibleContext };
    identity.kind = "identity";
    expect((await reviewIndexed(audit, noBible)).report.split("\n\n")[1]).toContain("协议无效");
  });
  it("无来源失败项以null配对finding，不能充当每维的本章锚点", async () => {
    const audit = indexedDecision();
    audit.passed = false;
    audit.checks.facts = false;
    audit.evidence.facts.push({ ...audit.evidence.facts[0], outputQuoteIndex: 1, sourceQuoteIndex: null, supported: false });
    audit.findings.push({ dimension: "facts", outputQuoteIndex: 1, sourceQuoteIndex: null, reason: "原文没有此断言" });
    expect((await reviewIndexed(audit)).report.split("\n\n")[1]).toContain("原文没有此断言");
    audit.evidence.facts[1].sourceKind = "bible";
    expect((await reviewIndexed(audit)).report.split("\n\n")[1]).toContain("协议无效");
    audit.evidence.facts[1].sourceKind = "chapter";
    audit.evidence.facts.shift();
    expect((await reviewIndexed(audit)).report.split("\n\n")[1]).toContain("判定不一致");
  });
  it("失败finding必须与同维未支持证据为同一对索引", async () => {
    const audit = indexedDecision();
    audit.passed = false;
    audit.checks.chronology = false;
    audit.evidence.chronology[0].supported = false;
    audit.findings.push({ dimension: "chronology", outputQuoteIndex: 0, sourceQuoteIndex: 0, reason: "时序错误" });
    expect((await reviewIndexed(audit)).report.split("\n\n")[1]).toContain("时序错误");
    for (const changed of [{ outputQuoteIndex: 1 }, { sourceQuoteIndex: 1 }, { dimension: "facts" }, { sourceQuoteIndex: null }]) {
      const changedAudit = { ...audit, findings: [{ ...audit.findings[0], ...changed }] };
      expect((await reviewIndexed(changedAudit)).report.split("\n\n")[1]).toContain("判定不一致");
    }
    for (const changed of [{ outputQuoteIndex: -1 }, { sourceQuoteIndex: 0.5 }, { sourceQuoteIndex: 2 }, { sourceKind: "bible" }, { outputQuote: "玄清子问。" }]) {
      expect((await reviewIndexed({ ...audit, findings: [{ ...audit.findings[0], ...changed }] })).report.split("\n\n")[1]).toContain("协议无效");
    }
  });
  it.each(["outputQuoteIndex", "sourceQuoteIndex"] as const)("重复文本的finding仍须精确匹配%s，包含索引0", async (field) => {
    const material = { ...indexedInput, sourceText: "她推开门。\n她推开门。", outputText: "她推开门。\n她推开门。" };
    const audit = indexedDecision();
    audit.passed = false;
    audit.checks.facts = false;
    audit.evidence.facts[0].supported = false;
    audit.evidence.facts.push({ ...audit.evidence.facts[0], outputQuoteIndex: 1, sourceQuoteIndex: 1, supported: true });
    audit.findings.push({ dimension: "facts", outputQuoteIndex: 0, sourceQuoteIndex: 0, reason: "索引0断言未获支持" });
    const exact = await reviewIndexed(audit, material);
    expect(exact.passed).toBe(false);
    expect(exact.report.split("\n\n")[1]).toContain("索引0断言未获支持");
    expect(exact.report.split("\n\n")[1]).not.toContain("判定不一致");
    audit.findings[0][field] = 1;
    const mismatched = await reviewIndexed(audit, material);
    expect(mismatched.passed).toBe(false);
    expect(mismatched.report.split("\n\n")[1]).toContain("判定不一致");
    expect(mismatched.report).toContain(JSON.stringify(audit));
    expect(mismatched.report).toContain(material.outputText);
  });
  it("重复文本的每对未支持索引都须有finding，不能由另一索引代替", async () => {
    const material = { ...indexedInput, sourceText: "她推开门。\n她推开门。", outputText: "她推开门。\n她推开门。" };
    const audit = indexedDecision();
    audit.passed = false;
    audit.checks.facts = false;
    audit.evidence.facts[0].supported = false;
    audit.evidence.facts.push({ ...audit.evidence.facts[0], outputQuoteIndex: 1, sourceQuoteIndex: 1 });
    audit.findings.push({ dimension: "facts", outputQuoteIndex: 0, sourceQuoteIndex: 0, reason: "第一对未获支持" });
    expect((await reviewIndexed(audit, material)).report.split("\n\n")[1]).toContain("判定不一致");
    audit.findings.push({ dimension: "facts", outputQuoteIndex: 1, sourceQuoteIndex: 1, reason: "第二对未获支持" });
    const complete = await reviewIndexed(audit, material);
    expect(complete.passed).toBe(false);
    expect(complete.report.split("\n\n")[1]).toContain("第一对未获支持；第二对未获支持");
    expect(complete.report.split("\n\n")[1]).not.toContain("判定不一致");
  });
  it("索引证据仍检查创意种类、逐维checks和passed一致性", async () => {
    for (const dimension of ["chronology", "dialogue", "visibleCharacters"] as const) {
      const audit = indexedDecision();
      audit.evidence[dimension][0].kind = "creative_intent";
      expect((await reviewIndexed(audit)).passed).toBe(false);
    }
    const audit = indexedDecision();
    audit.evidence.stageBoundary[0].kind = "creative_intent";
    expect((await reviewIndexed(audit)).passed).toBe(false);
    audit.evidence.stageBoundary[0].outputQuoteIndex = 1;
    expect((await reviewIndexed(audit)).passed).toBe(true);
    audit.evidence.facts[0].supported = false;
    expect((await reviewIndexed(audit)).passed).toBe(false);
  });
  it.each([
    ["physical_fact", "creative_intent", false],
    ["physical_fact", "identity", true],
    ["identity", "creative_intent", true],
  ] as const)("旧引文协议保留%s与%s的兼容判定%s", async (firstKind, secondKind, expected) => {
    const audit = decision();
    for (const entries of Object.values(audit.evidence)) entries[0].kind = firstKind;
    audit.evidence.stageBoundary[0].kind = secondKind;
    expect((await reviewDaojieGeneration(validInput, async () => ({ success: true, text: JSON.stringify(audit) }))).passed).toBe(expected);
  });
  it("完整旧引文协议继续通过，表达式和修复后的伪JSON不执行", async () => {
    expect((await reviewDaojieGeneration(validInput, async () => ({ success: true, text: pass }))).passed).toBe(true);
    for (const text of ['({..."stage":"planning"})', '```json\n' + JSON.stringify(indexedDecision()) + '\n```', JSON.stringify(indexedDecision()).slice(0, -1)]) {
      const complete = vi.fn().mockResolvedValue({ success: true, text });
      expect((await reviewDaojieGeneration(indexedInput, complete)).passed).toBe(false);
      expect(complete).toHaveBeenCalledTimes(1);
    }
  });
});
