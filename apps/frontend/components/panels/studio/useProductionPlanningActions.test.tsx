// @vitest-environment jsdom

// livefire9/10 吞异常防线测试:画布节点动作经 index.tsx `void` 派发,async 链上
// 未捕获异常会被无声吞掉。handleProductionNodeAction 的整体 try/catch 必须把
// handleDirectorPlan / handleStoryboardTable 链上任何 throw 现形为:
//   1) toast.error,文案含 action.id 与错误 message;
//   2) console.error 指纹([handleProductionNodeAction] <actionId> <error>);
//   3) diagnostics logEvent「productionNodeAction.failed」(App 日志留痕,补上
//      装机「console 无人订阅、toast 一闪即逝」的取证盲区);
// 且不得向上抛——void 派发下上抛=无人接收=静默死亡。

import { act, cleanup, renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { aiManager } from "@/lib/ai/ai-manager";
import { scriptPlanSourceFingerprint } from "./workflow-helpers";
import { useCharacterLibraryStore } from "@/stores/library/character-library-store";
import { useProjectStore } from "@/stores/project/project-store";
import { useStudioStore } from "@/stores/studio/studio-store";
import { collectDerivedAssetGenerationTasks, useProductionPlanningActions } from "./useProductionPlanningActions";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

// 源记忆读取走桥,jsdom 无桥——打桩为恒成功,让用例聚焦吞异常防线本身。
vi.mock("@/lib/studio/source-memory", () => ({
  readSourceMemoryActionContext: vi.fn(async () => ({ success: true, context: "" })),
}));

// 批2/批3 RED(10-13-audit4-downstream):装配/门禁用例要观察 textStream 收到的
// 装配输出并控制成败。既有吞异常防线用例在 startAgentRun 注入点即抛,永远走不到
// textStream,文件级 mock 对其零影响。
vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: { textStream: vi.fn() },
}));

const initialProjectState = useProjectStore.getState();
const initialStudioState = useStudioStore.getState();
const initialCharacterLibraryState = useCharacterLibraryStore.getState();

let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  let sequence = 0;
  const subtle = globalThis.crypto?.subtle;
  vi.stubGlobal("crypto", {
    subtle,
    randomUUID: vi.fn(() => `test-uuid-${++sequence}`),
  });
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    textCompletion: vi.fn(),
  };
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  useStudioStore.setState({
    ...initialStudioState,
    novelChapters: [{
      id: "chapter-002",
      index: 2,
      title: "第二章",
      importedAt: 1,
    }],
    agentWorkData: [{
      id: "work-draft-002",
      key: "scriptDraft",
      episodeId: "chapter-002",
      data: "第二章剧本正文",
      createdAt: 1,
      updatedAt: 1,
    }],
    // D4 门禁(GREEN 起):规划/分镜动作先过「本章资产已提取」,注入点用例的
    // store 夹具须含本章提取批次,否则在 startAgentRun 之前即被拦下。
    entityExtractions: [{
      id: "ext-002",
      episodeId: "chapter-002",
      characters: [{ characterId: "c-002", name: "第二章角色", aliases: [] }],
      scenes: [],
      props: [],
    }],
    // 分镜表链在 run 落库前需先命中导演规划(缺 plan 会提前 toast 返回,走不到注入点)
    scriptPlans: [{
      id: "plan-002",
      episodeId: "chapter-002",
      theme: "主题",
      visualStyle: "视觉风格",
      narrativeRhythm: "叙事节奏",
      sceneIntents: [],
      soundDirection: "声音方向",
      transitions: "转场",
      derivedAssetPlan: [],
    }],
    // 注入点:startAgentRun 在两个 handler 自身 try 之外,此处 throw 会沿 await
    // 链传到 handleProductionNodeAction 的整体 catch。
    startAgentRun: vi.fn(() => {
      throw new Error("startAgentRun 模拟失败");
    }),
  });
});

afterEach(() => {
  cleanup();
  consoleError.mockRestore();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  delete (window as unknown as { diagnosticsLog?: unknown }).diagnosticsLog;
  useProjectStore.setState(initialProjectState, true);
  useStudioStore.setState(initialStudioState, true);
  useCharacterLibraryStore.setState(initialCharacterLibraryState, true);
});

function renderPlanningActions(overrides: {
  saveScriptPlan?: ReturnType<typeof useStudioStore.getState>["saveScriptPlan"];
  saveAgentWorkData?: ReturnType<typeof useStudioStore.getState>["saveAgentWorkData"];
} = {}) {
  return renderHook(() => useProductionPlanningActions({
    activeProjectId: "project-1",
    manualCatalog: {},
    productionEpisodeId: "chapter-002",
    handleStageChange: vi.fn(),
    saveAgentWorkData: (overrides.saveAgentWorkData ?? vi.fn()) as unknown as ReturnType<typeof useStudioStore.getState>["saveAgentWorkData"],
    saveScriptPlan: (overrides.saveScriptPlan ?? vi.fn()) as unknown as ReturnType<typeof useStudioStore.getState>["saveScriptPlan"],
    saveSeriesBible: vi.fn() as unknown as ReturnType<typeof useStudioStore.getState>["saveSeriesBible"],
  }));
}

/** 批2/批3 用例:startAgentRun 正常返 runId,finish/fail 收尾为桩(既有用例不受影响,各自注入 throw)。 */
function stubAgentRunLifecycle() {
  useStudioStore.setState({
    startAgentRun: vi.fn(() => "run-test") as unknown as ReturnType<typeof useStudioStore.getState>["startAgentRun"],
    finishAgentRun: vi.fn() as unknown as ReturnType<typeof useStudioStore.getState>["finishAgentRun"],
    failAgentRun: vi.fn() as unknown as ReturnType<typeof useStudioStore.getState>["failAgentRun"],
  });
}

function capturedMessageText() {
  return vi
    .mocked(aiManager.textStream)
    .mock.calls.flatMap((call) => call[0].messages.map((message) => message.content))
    .join("\n");
}

function collectFailedDiagnostics(write: ReturnType<typeof vi.fn>) {
  return write.mock.calls
    .map(([entry]) => entry as { message?: string; context?: { actionId?: string } })
    .filter((entry) => entry.message === "productionNodeAction.failed");
}

describe("useProductionPlanningActions.handleProductionNodeAction 吞异常防线", () => {
  it("generate-director-plan 链 throw:toast 含 action.id+错误 message,console.error 指纹,diagnostics 落盘,且不上抛", async () => {
    const diagnostics = vi.fn();
    (window as unknown as { diagnosticsLog?: unknown }).diagnosticsLog = { write: diagnostics };
    const { result } = renderPlanningActions();

    await act(async () => {
      // 防线若上抛,此 await 直接 reject,用例即红
      await result.current.handleProductionNodeAction({
        id: "generate-director-plan",
        targetStage: "scriptPlan",
      });
    });

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/环节动作失败\(generate-director-plan\):.*startAgentRun 模拟失败/),
    );
    expect(consoleError).toHaveBeenCalledWith(
      "[handleProductionNodeAction]",
      "generate-director-plan",
      expect.objectContaining({ message: "startAgentRun 模拟失败" }),
    );
    const failed = collectFailedDiagnostics(diagnostics);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.context?.actionId).toBe("generate-director-plan");
  });

  it("generate-storyboard-table 链 throw:同款防线(toast+console.error+diagnostics,不上抛)", async () => {
    const diagnostics = vi.fn();
    (window as unknown as { diagnosticsLog?: unknown }).diagnosticsLog = { write: diagnostics };
    const { result } = renderPlanningActions();

    await act(async () => {
      await result.current.handleProductionNodeAction({
        id: "generate-storyboard-table",
        targetStage: "storyboardTable",
      });
    });

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/环节动作失败\(generate-storyboard-table\):.*startAgentRun 模拟失败/),
    );
    expect(consoleError).toHaveBeenCalledWith(
      "[handleProductionNodeAction]",
      "generate-storyboard-table",
      expect.objectContaining({ message: "startAgentRun 模拟失败" }),
    );
    const failed = collectFailedDiagnostics(diagnostics);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.context?.actionId).toBe("generate-storyboard-table");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 批2(D3/D4/D6)+批3(D2/D5/D7,裁定④⑤)+两条 rider 的 RED 用例
// (10-13-audit4-downstream,design §2/§3 定稿)。D6 纯函数用例在 workflow-helpers.test.ts,
// D5 纯函数/条目指纹用例在 chapter-pipeline-stale.test.ts 与 storyboard-table.test.ts。
// 本组只锁 handler 级可观察行为:门禁/软提示/装配输出/落库指纹。
// ─────────────────────────────────────────────────────────────────────────────

// D2 落库链夹具:可通过 auditDirectorPlanStructure 全门的完整 ①-⑦ 规划
// (与 director-plan.test.ts「T5」同源,⑥ 决策行为 N-M 复合写法——D1 已认)。
const AUDITABLE_PLAN_OUTPUT = [
  "<scriptPlan>",
  "# 《剑主夜访道口镇 EP01》导演创作规划",
  "",
  "## ① 主题立意与叙事核心",
  "核心主题：在被宗门火印压低的道口镇里，落魄剑修用一寸不暴露实力的动作看见穷苦少年的命数。情感主线从码头压迫，到客栈旧痛，再到塾馆微光和灵舟逼近，形成压迫、微燃、倒计时三层递进。离场感受应是苍凉、紧迫、意难平。",
  "",
  "## ② 视觉风格与画面基调",
  "构图以偏侧留白和纵深层叠为主，角色常被压在画面边缘，空间像旧宣纸上的冷灰水痕。码头用队列和藤筐形成斜向压迫，客栈用门框和柜台制造牢笼感，塾馆用角落和水缸突出少年被忽视的位置。镜头运动以定镜、缓推、缓拉为主，禁止无目的环绕和炫技变焦。",
  "",
  "## ③ 叙事结构与节奏规划",
  "叙事采用起承转合：Sc1 建立码头压迫和独孤的隐性救人，Sc2 收入客栈断剑和铜钱线索，Sc3 让晏燎暗红灵气成为全章微光，Sc4 用残卷裂纹和灵舟压境完成钩子。节奏先慢压，再短促点燃，最后把希望和追杀同时推到门口。",
  "",
  "## ④ 分场景情绪与画面意图",
  "",
  "### Sc 1-1 金水河码头 晨/外",
  "- **情绪目标**：观众先看见人被制度压扁，再看见灰衫客只动一寸就救下小杂役；他像河岸枯木，不出声，却能让灾祸偏开半寸。",
  "- **氛围方向**：压迫、窒息、冷漠。",
  "- **镜头意图**：",
  "  - 大远景展示藤筐、矿石和苦力队列，让码头像一台吞人的机器。",
  "  - 中景跟住独孤草鞋滑半寸，矿石砸空，观众只看到物理结果，不看到他暴露实力。",
  "  - 鞋尖拨朽木救人保持中远距离，避免英雄化，突出他仍选择隐藏。",
  "- **空间叙事**：前景朽木栈道，中景赵四与小杂役，背景金水河雾中船影，三层都在压向人。",
  "- **连续性锚点**：独孤灰衫、草鞋、背后油布剑包贯穿后续场次；小杂役恐惧姿态和赵四鞭梢方向不能错位。",
  "",
  "### Sc 1-2 悦来客栈 夜/内",
  "- **情绪目标**：铜钱落柜和断剑揭布把他的贫困与旧案同时推出来，观众第一次靠近他的秘密。",
  "- **氛围方向**：戒备、逼仄、旧痛翻涌。",
  "- **镜头意图**：",
  "  - 柜台正反打压低独孤位置，表现他在人间规则里没有余地。",
  "  - 上楼脚步避开木板响声，与码头避矿石形成同一套肉身本能。",
  "  - 三层油布被揭开，断剑断口进入大特写，旧案线索由道具承担。",
  "- **空间叙事**：柜台、楼梯、斗室层层收紧，门框和木墙让角色无处可退。",
  "- **连续性锚点**：断剑位置、账册线索、铜钱数量和油布剑包状态必须进入后续分镜表。",
  "",
  "## ⑤ 声音方向",
  "逐场声音要服务压迫和微光：Sc1 用苦力号子、矿石碎裂、鞭梢破空构成底噪，独孤救人瞬间压低其他声源，只留矿石砸空；Sc2 用算盘、铜钱落柜、木梯轻响和断剑低鸣建立旧案感；Sc3 用孩童压低的呼吸、水缸闷响和枯枝折断声点出晏燎命数；Sc4 用更鼓、缆绳绷断、寒铁震鸣和窗棂响声完成倒计时。",
  "",
  "## ⑥ 转场与视觉连续性",
  "Sc1 到 Sc2 以矿石裂纹的墨痕硬切到客栈柜台账册，保留压迫质感；Sc2 到 Sc3 用断剑断口形状接塾馆门框，暗示旧伤寻找新因；Sc3 到 Sc4 用晏燎掌心余温接残卷新裂纹，形成希望与杀机同源。视觉连续性锚点包括独孤灰衫和油布剑包、断剑断口、铜钱和账册、晏燎湿草鞋与暗红灵气。",
  "- Sc 1-1 → Sc 1-2：风格词=水墨晕染；氛围词=战斗",
  "",
  "## ⑦ 衍生资产预划清单",
  "| 资产名 | 衍生状态 | 原因/出现段落 |",
  "|---|---|---|",
  "| 独孤剑尘 | 灰衫入镇态 | Sc1-Sc4 连续出镜 |",
  "</scriptPlan>",
].join("\n");

function planForChapter(overrides: { scriptFingerprint?: string } = {}) {
  return {
    id: "plan-002",
    episodeId: "chapter-002",
    theme: "主题",
    visualStyle: "视觉风格",
    narrativeRhythm: "叙事节奏",
    sceneIntents: [],
    soundDirection: "声音方向",
    transitions: "转场",
    derivedAssetPlan: [],
    ...(overrides.scriptFingerprint === undefined ? {} : { scriptFingerprint: overrides.scriptFingerprint }),
  };
}

describe("批2 D4 · 导演规划门禁补「本章资产已提取」", () => {
  it("D4: 本章无提取 → 门禁拦(提示先提取),不再放行调用模型", async () => {
    stubAgentRunLifecycle();
    useStudioStore.setState({ entityExtractions: [] });
    vi.mocked(aiManager.textStream).mockResolvedValue({ success: false, error: "capture-stop" });
    const { result } = renderPlanningActions();

    await act(async () => {
      await result.current.handleDirectorPlan("chapter-002", "");
    });

    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/资产提取/));
    expect(aiManager.textStream).not.toHaveBeenCalled();
  });
});

describe("批2 D3 · 分镜表资产清单不再跨章回退", () => {
  it("D3: 第 2 章无提取、第 1 章有 → 不取第 1 章资产且提示先提取(现实现回退必红)", async () => {
    stubAgentRunLifecycle();
    useStudioStore.setState({
      entityExtractions: [
        {
          id: "ext-001",
          episodeId: "chapter-001",
          characters: [{ characterId: "c-1", name: "第一章角色", aliases: [] }],
          scenes: [],
          props: [],
        },
      ],
    });
    vi.mocked(aiManager.textStream).mockResolvedValue({ success: false, error: "capture-stop" });
    const { result } = renderPlanningActions();

    await act(async () => {
      await result.current.handleStoryboardTable("chapter-002", "");
    });

    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/资产提取/));
    expect(aiManager.textStream).not.toHaveBeenCalled();
    expect(capturedMessageText()).not.toContain("第一章角色");
  });
});

describe("批2 D4 · 派生资产匹配不到不再静默丢", () => {
  it("D4: resolver 匹配不到的计划条目 → 结果上报 unmatched 计数与明细(现实现 continue 静默,必红)", () => {
    useCharacterLibraryStore.setState({
      characters: [
        {
          id: "char-1",
          name: "断臂散修",
          description: "",
          visualTraits: "",
          projectId: "project-1",
          views: [],
          variations: [{ id: "var-1", name: "雨夜湿衣", visualPrompt: "" }],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      folders: [],
      currentFolderId: null,
      selectedCharacterId: null,
    });
    const resolver = (name: string) =>
      name === "断臂散修" ? { kind: "character" as const, id: "char-1", name } : null;

    // RED 期断言收窄:unmatched 为批2 GREEN 将新增的返回字段(design §2 D4
    // 「计数+汇总提示」),现返回类型尚无该键——不收窄则 tsc 先红,盖过行为红因。
    const result = collectDerivedAssetGenerationTasks(
      [
        { parentAssetId: "幽灵资产", state: "雨夜湿衣", reason: "库中已删,匹配不到" },
        { parentAssetId: "断臂散修", state: "雨夜湿衣", reason: "可解析" },
      ],
      resolver,
      "visual-manual-x",
      "project-1",
      "chapter-002",
    ) as {
      characterVariationTasks: unknown[];
      storeTasks: unknown[];
      total: number;
      unmatched?: Array<{ parentAssetId: string; state: string }>;
    };

    expect(result.characterVariationTasks).toHaveLength(1);
    expect(result.unmatched).toEqual([{ parentAssetId: "幽灵资产", state: "雨夜湿衣" }]);
  });
});

describe("批3 D2 · 分镜表门禁:规划指纹过期=软提示可继续(裁定④⑤)", () => {
  it("D2: 改剧本后旧规划出分镜表 → toast「剧本已更新」软提示,流程可继续(不硬拦)", async () => {
    stubAgentRunLifecycle();
    useStudioStore.setState({
      scriptPlans: [
        planForChapter({ scriptFingerprint: scriptPlanSourceFingerprint("chapter-002", "旧版剧本正文") }),
      ],
    });
    vi.mocked(aiManager.textStream).mockResolvedValue({ success: false, error: "capture-stop" });
    const { result } = renderPlanningActions();

    await act(async () => {
      await result.current.handleStoryboardTable("chapter-002", "");
    });

    expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/剧本已更新/));
    expect(aiManager.textStream).toHaveBeenCalled();
  });

  it("D2 兼容锁: 旧规划无指纹 → 不提示,分镜表照常出(回落现行为)", async () => {
    stubAgentRunLifecycle();
    // beforeEach 的 plan-002 无 scriptFingerprint
    vi.mocked(aiManager.textStream).mockResolvedValue({ success: false, error: "capture-stop" });
    const { result } = renderPlanningActions();

    await act(async () => {
      await result.current.handleStoryboardTable("chapter-002", "");
    });

    expect(toast.warning).not.toHaveBeenCalledWith(expect.stringMatching(/剧本已更新/));
    expect(aiManager.textStream).toHaveBeenCalled();
    // S7 载荷缓解(10-14 livefire17):分镜表流式整体预算单独 1200s(ch002 定谳:
    // 期望总时长 690-1215s,600s 档=人为墙;1200s=判定性预算非充分预算)
    expect(vi.mocked(aiManager.textStream).mock.calls[0]?.[0]?.timeoutMs).toBe(1_200_000);
  });

  it("D2: 导演规划落库带来源剧本指纹 sourceScript(条目 id+updatedAt,裁定⑤)", async () => {
    stubAgentRunLifecycle();
    const saveScriptPlan = vi.fn() as unknown as ReturnType<typeof useStudioStore.getState>["saveScriptPlan"];
    const saveAgentWorkData = vi.fn(() => "work-plan-1") as unknown as ReturnType<typeof useStudioStore.getState>["saveAgentWorkData"];
    vi.mocked(aiManager.textStream).mockResolvedValue({ success: true, text: AUDITABLE_PLAN_OUTPUT });
    const { result } = renderPlanningActions({ saveScriptPlan, saveAgentWorkData });

    await act(async () => {
      await result.current.handleDirectorPlan("chapter-002", "");
    });

    expect(saveScriptPlan).toHaveBeenCalled();
    const savedPlan = vi.mocked(saveScriptPlan).mock.calls[0]?.[0] as {
      scriptFingerprint?: string;
      sourceScript?: { entryId: string; updatedAt: number };
    };
    // beforeEach 草稿条目 = { id: "work-draft-002", updatedAt: 1 }
    expect(savedPlan.sourceScript).toEqual({ entryId: "work-draft-002", updatedAt: 1 });
  });
});

describe("批3 D7 · 下游入口未审/审不过=软警示可继续(裁定④)", () => {
  it("D7: 分镜表入口对未审剧本软警示但可继续(不强制审核通过)", async () => {
    stubAgentRunLifecycle();
    // plan 指纹置为现势,隔离 D2 过期提示;无 scriptDraftReview 条目=未审
    useStudioStore.setState({
      scriptPlans: [
        planForChapter({ scriptFingerprint: scriptPlanSourceFingerprint("chapter-002", "第二章剧本正文") }),
      ],
    });
    vi.mocked(aiManager.textStream).mockResolvedValue({ success: false, error: "capture-stop" });
    const { result } = renderPlanningActions();

    await act(async () => {
      await result.current.handleStoryboardTable("chapter-002", "");
    });

    expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/未审|审核/));
    expect(aiManager.textStream).toHaveBeenCalled();
  });

  it("D7: 审不过(新版审核含未修复问题)→ 软警示可继续", async () => {
    stubAgentRunLifecycle();
    useStudioStore.setState({
      scriptPlans: [
        planForChapter({ scriptFingerprint: scriptPlanSourceFingerprint("chapter-002", "第二章剧本正文") }),
      ],
      agentWorkData: [
        {
          id: "work-draft-002",
          key: "scriptDraft",
          episodeId: "chapter-002",
          data: "第二章剧本正文",
          createdAt: 100,
          updatedAt: 100,
        },
        {
          id: "work-review-002",
          key: "scriptDraftReview",
          episodeId: "chapter-002",
          data: "🔴 结线断链：第 3 场与第 4 场因果断裂，需重写。",
          createdAt: 200,
          updatedAt: 200,
        },
      ],
    });
    vi.mocked(aiManager.textStream).mockResolvedValue({ success: false, error: "capture-stop" });
    const { result } = renderPlanningActions();

    await act(async () => {
      await result.current.handleStoryboardTable("chapter-002", "");
    });

    expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/未审|审核/));
    expect(aiManager.textStream).toHaveBeenCalled();
  });
});

describe("riderB · 规划/分镜代理上下文注入目标画幅(platformSpec,G36 全链 16:9)", () => {
  it("riderB: 导演规划装配输出含画幅行(RED:现装配链无 platformSpec 注入)", async () => {
    stubAgentRunLifecycle();
    useStudioStore.setState({
      workflowConfig: { ...initialStudioState.workflowConfig, platformSpec: "16:9" },
    });
    vi.mocked(aiManager.textStream).mockResolvedValue({ success: false, error: "capture-stop" });
    const { result } = renderPlanningActions();

    await act(async () => {
      await result.current.handleDirectorPlan("chapter-002", "");
    });

    expect(capturedMessageText()).toContain("目标画幅：16:9");
  });

  it("riderB: 分镜表装配输出含画幅行(RED:现装配链无 platformSpec 注入)", async () => {
    stubAgentRunLifecycle();
    useStudioStore.setState({
      workflowConfig: { ...initialStudioState.workflowConfig, platformSpec: "16:9" },
    });
    vi.mocked(aiManager.textStream).mockResolvedValue({ success: false, error: "capture-stop" });
    const { result } = renderPlanningActions();

    await act(async () => {
      await result.current.handleStoryboardTable("chapter-002", "");
    });

    expect(capturedMessageText()).toContain("目标画幅：16:9");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C 批(10-14-audit4-residuals):R12 D2 门读 sourceScript + R13 无资产硬拦锁
// ─────────────────────────────────────────────────────────────────────────────

describe("R12 · D2 门禁读 sourceScript(裁定⑤),正文哈希只作旧数据回落", () => {
  it("D2: plan 带 sourceScript 指向旧条目 → 即便正文哈希同势也过期提示(现实现只比哈希,必红)", async () => {
    stubAgentRunLifecycle();
    useStudioStore.setState({
      scriptPlans: [
        {
          ...planForChapter(),
          // 哈希与现势正文一致(单独比哈希判「新」),但 sourceScript 指向已不在的旧条目
          scriptFingerprint: scriptPlanSourceFingerprint("chapter-002", "第二章剧本正文"),
          sourceScript: { entryId: "work-draft-old", updatedAt: 1 },
        },
      ],
    });
    vi.mocked(aiManager.textStream).mockResolvedValue({ success: false, error: "capture-stop" });
    const { result } = renderPlanningActions();

    await act(async () => {
      await result.current.handleStoryboardTable("chapter-002", "");
    });

    expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/剧本已更新/));
    expect(aiManager.textStream).toHaveBeenCalled();
  });

  it("D2: sourceScript 与现势草稿一致 → 即便哈希字段过期也不提示(sourceScript 为准,现实现必红)", async () => {
    stubAgentRunLifecycle();
    useStudioStore.setState({
      scriptPlans: [
        {
          ...planForChapter(),
          // 哈希是旧正文(单独比哈希判「过期」),但 sourceScript 与 beforeEach 草稿逐位一致
          scriptFingerprint: scriptPlanSourceFingerprint("chapter-002", "旧版剧本正文"),
          sourceScript: { entryId: "work-draft-002", updatedAt: 1 },
        },
      ],
    });
    vi.mocked(aiManager.textStream).mockResolvedValue({ success: false, error: "capture-stop" });
    const { result } = renderPlanningActions();

    await act(async () => {
      await result.current.handleStoryboardTable("chapter-002", "");
    });

    expect(toast.warning).not.toHaveBeenCalledWith(expect.stringMatching(/剧本已更新/));
    expect(aiManager.textStream).toHaveBeenCalled();
  });
});

describe("R13(Q4) · 无资产=硬拦锁(裁定 Q4「按裁定不改」,防回退)", () => {
  it("导演规划与分镜表两入口本章无提取 → toast.error 硬拦且不调模型(现状直绿,突变验证防回退)", async () => {
    stubAgentRunLifecycle();
    useStudioStore.setState({ entityExtractions: [] });
    vi.mocked(aiManager.textStream).mockResolvedValue({ success: true, text: "不应到达模型" });
    const { result } = renderPlanningActions();

    await act(async () => {
      await result.current.handleDirectorPlan("chapter-002", "");
    });
    await act(async () => {
      await result.current.handleStoryboardTable("chapter-002", "");
    });

    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/本章无资产提取结果/));
    expect(toast.error).toHaveBeenCalledTimes(2);
    expect(aiManager.textStream).not.toHaveBeenCalled();
  });
});

describe("道劫规划写回前语义审核", () => {
  const response = (passed = true) => JSON.stringify({ stage: "planning", passed, checks: { facts: passed, chronology: true, dialogue: true, stageBoundary: true, visibleCharacters: true }, findings: passed ? [] : [{ dimension: "facts", outputQuote: "半寸", sourceQuote: "", reason: "原文无精确距离" }] });
  beforeEach(() => {
    vi.mocked(aiManager.textStream).mockReset();
    stubAgentRunLifecycle();
    useProjectStore.setState({ activeProjectId: "project-1" });
    useStudioStore.setState({ workflowConfig: { ...initialStudioState.workflowConfig, directorManualId: "Daojie_xianxia" }, novelChapters: [{ id: "chapter-002", index: 2, title: "章", sourceText: "独孤剑尘救下杂役。", importedAt: 1 }] });
  });
  it.each(["{}", response(false)])("拒绝稿不覆盖规划及原有分镜: %s", async (text) => {
    const save = vi.fn<(...args: unknown[]) => string>(() => "work"); const planSave = vi.fn();
    vi.mocked(aiManager.textStream).mockResolvedValueOnce({ success: true, text: AUDITABLE_PLAN_OUTPUT }).mockResolvedValueOnce({ success: true, text });
    const { result } = renderPlanningActions({ saveAgentWorkData: save, saveScriptPlan: planSave });
    await act(async () => { await result.current.handleDirectorPlan("chapter-002"); });
    expect(aiManager.textStream).toHaveBeenCalledTimes(2);
    expect(planSave).not.toHaveBeenCalled();
    expect(save.mock.calls.some(([key]) => key === "directorPlan")).toBe(false);
    expect(save).toHaveBeenCalledWith("supervisionReport", expect.stringContaining(AUDITABLE_PLAN_OUTPUT), "chapter-002", expect.anything());
  });
  it("完整审核通过才保存规划", async () => {
    const planSave = vi.fn();
    vi.mocked(aiManager.textStream).mockResolvedValueOnce({ success: true, text: AUDITABLE_PLAN_OUTPUT }).mockResolvedValueOnce({ success: true, text: response() });
    const { result } = renderPlanningActions({ saveScriptPlan: planSave });
    await act(async () => { await result.current.handleDirectorPlan("chapter-002"); });
    expect(aiManager.textStream).toHaveBeenCalledTimes(2);
    expect(planSave).toHaveBeenCalled();
  });
  it.each(["project", "source", "draft", "plan"])("审核期间%s变化禁止迟到写回", async (change) => {
    const save = vi.fn(); const planSave = vi.fn();
    vi.mocked(aiManager.textStream).mockResolvedValueOnce({ success: true, text: AUDITABLE_PLAN_OUTPUT }).mockImplementationOnce(async () => {
      if (change === "project") useProjectStore.setState({ activeProjectId: "project-2" });
      if (change === "source") useStudioStore.setState({ novelChapters: [] });
      if (change === "draft") useStudioStore.setState({ agentWorkData: [] });
      if (change === "plan") useStudioStore.setState({ scriptPlans: [] });
      return { success: true, text: response() };
    });
    const { result } = renderPlanningActions({ saveAgentWorkData: save, saveScriptPlan: planSave });
    await act(async () => { await result.current.handleDirectorPlan("chapter-002"); });
    expect(aiManager.textStream).toHaveBeenCalledTimes(2);
    expect(planSave).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  });
});

describe("道劫分镜写回审核", () => {
  const board = (seconds: number) => [
    "<storyboardTable>",
    "| 序号 | 画面描述 | 场景 | 关联资产名称 | 时长 | 景别 | 运镜 | 角色动作 | 朝向 | 空间关系 | 情绪 | 台词 | 音效 | 关联资产ID | 出镜语义JSON |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    `| 1 | 雨夜码头 | 码头 | [码头] | ${seconds} | 近景 | 静止 | 雨落 | 面向右 | 中景 | 紧张 | 无台词 | 风声 | [scene-dock] | ${JSON.stringify({ sceneViewpointId: "dock", personFree: true, visibleCharacters: [], visibleProps: [], actionIn: "雨落", actionOut: "雨声延续" })} |`,
    "</storyboardTable>",
  ].join("\n");
  const pass = JSON.stringify({ stage: "storyboard", passed: true, checks: { facts: true, chronology: true, dialogue: true, stageBoundary: true, visibleCharacters: true }, findings: [] });
  beforeEach(() => {
    vi.mocked(aiManager.textStream).mockReset(); stubAgentRunLifecycle();
    useProjectStore.setState({ activeProjectId: "project-1" });
    useStudioStore.setState({ workflowConfig: { ...initialStudioState.workflowConfig, directorManualId: "Daojie_xianxia" }, novelChapters: [{ id: "chapter-002", index: 2, title: "章", sourceText: "码头雨落。", importedAt: 1 }] });
  });
  it("有效结构但审核无效不替换分镜", async () => {
    const replace = vi.fn(); const save = vi.fn(); useStudioStore.setState({ replaceStoryboardsForEpisode: replace });
    vi.mocked(aiManager.textStream).mockResolvedValueOnce({ success: true, text: board(12) }).mockResolvedValueOnce({ success: true, text: "{}" });
    const { result } = renderPlanningActions({ saveAgentWorkData: save });
    await act(async () => { await result.current.handleStoryboardTable("chapter-002"); });
    expect(aiManager.textStream).toHaveBeenCalledTimes(2); expect(replace).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith("supervisionReport", expect.stringContaining(board(12)), "chapter-002", expect.anything());
  });
  it("实际201秒无需额外联网审核，拒绝写回", async () => {
    const replace = vi.fn(); useStudioStore.setState({ replaceStoryboardsForEpisode: replace });
    vi.mocked(aiManager.textStream).mockResolvedValueOnce({ success: true, text: board(201) });
    const { result } = renderPlanningActions();
    await act(async () => { await result.current.handleStoryboardTable("chapter-002"); });
    expect(aiManager.textStream).toHaveBeenCalledTimes(1); expect(replace).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("未通过原文审核"));
  });
  it("审核通过才落库和转换，审核期间再次点击不增加调用", async () => {
    const replace = vi.fn(); const save = vi.fn(() => "board-1"); useStudioStore.setState({ replaceStoryboardsForEpisode: replace });
    let resolveReview!: (value: { success: boolean; text: string }) => void;
    vi.mocked(aiManager.textStream).mockResolvedValueOnce({ success: true, text: board(12) }).mockImplementationOnce(() => new Promise((resolve) => { resolveReview = resolve; }));
    const { result } = renderPlanningActions({ saveAgentWorkData: save }); let pending!: Promise<void>;
    await act(async () => { pending = result.current.handleStoryboardTable("chapter-002"); await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(replace).not.toHaveBeenCalled();
    await act(async () => { await result.current.handleDirectorPlan("chapter-002"); });
    expect(aiManager.textStream).toHaveBeenCalledTimes(2);
    await act(async () => { resolveReview({ success: true, text: pass }); await pending; });
    expect(replace).toHaveBeenCalledTimes(1); expect(save).toHaveBeenCalledWith("storyboardTable", board(12), "chapter-002", expect.anything());
  });
});
