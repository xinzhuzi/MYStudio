import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  heuristicShotFxMotions,
  parseShotFxMotionResponse,
  selectShotFxMotions,
} from "./shot-fx-ai";

const textMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: {
    text: textMock,
  },
}));

const SHOTS = [
  { shotId: "s1", description: "剑光劈落，轰鸣炸开", dialogue: "看招！" },
  // 注意避开「影」等暗夜词：此处专测退场词奇偶镜行为
  { shotId: "s2", description: "他挥手告别，渐行渐远", dialogue: "" },
  { shotId: "s3", description: "庭院喝茶", dialogue: "今日风平。" },
];

beforeEach(() => {
  textMock.mockReset();
});

describe("parseShotFxMotionResponse", () => {
  const shotIds = new Set(["s1", "s2", "s3"]);

  it("解析 shots schema：motion + fx 插件数组", () => {
    const parsed = parseShotFxMotionResponse(
      '{"shots": [{"shotId": "s1", "motion": "punch-in", "fx": ["shake-hard", "chroma"]}, {"shotId": "s2", "motion": "drift", "fx": []}]}',
      shotIds,
    );
    expect(parsed.motions).toEqual({ s1: "punch-in", s2: "drift" });
    expect(parsed.addons).toEqual({ s1: ["shake-hard", "chroma"], s2: [] });
  });

  it("registry 解析:合法 hy: 收录、非法/闭集外丢弃(08-22 AI 路接线)", () => {
    const parsed = parseShotFxMotionResponse(
      '{"shots": [{"shotId": "s1", "motion": "punch-in", "registry": "hy:light-sweep-pass"}, {"shotId": "s2", "motion": "drift", "registry": "hy:不存在模板"}, {"shotId": "s3", "motion": "tilt-up", "registry": "light-leak"}]}',
      shotIds,
    );
    expect(parsed.registries).toEqual({ s1: "hy:light-sweep-pass" });
  });

  it("grade 解析：合法 LUT 收录+blend 钳制；闭集外/缺省丢弃（08-18-haldclut-grade）", () => {
    const parsed = parseShotFxMotionResponse(
      JSON.stringify({
        shots: [
          { shotId: "s1", motion: "push-in", grade: { lutId: "film-teal-orange", blend: 1.7 } },
          { shotId: "s2", motion: "drift", grade: { lutId: "film-not-exist", blend: 0.5 } },
          { shotId: "s3", motion: "hold" },
        ],
      }),
      shotIds,
    );
    expect(parsed.grades).toEqual({ s1: { lutId: "film-teal-orange", blend: 1 } });
  });

  it("转场桶解析：合法桶收录；cut/未知桶/未知音效类别丢弃（08-19 转场决策层）", () => {
    const parsed = parseShotFxMotionResponse(
      JSON.stringify({
        shots: [
          { shotId: "s1", motion: "push-in", transitionOut: "ink-bleed", sfx: "sword" },
          { shotId: "s2", motion: "drift", transitionOut: "cut", sfx: "not-a-category" },
          { shotId: "s3", motion: "hold", transitionOut: "no-such-bucket" },
        ],
      }),
      shotIds,
    );
    expect(parsed.transitions).toEqual({ s1: "ink-bleed" });
    expect(parsed.sfxCategories).toEqual({ s1: "sword" });
  });

  it("兼容旧 motions schema（无 fx 字段 → 不产 addons 条目）", () => {
    const parsed = parseShotFxMotionResponse(
      '{"motions": [{"shotId": "s1", "motion": "drift"}]}',
      shotIds,
    );
    expect(parsed.motions).toEqual({ s1: "drift" });
    expect(parsed.addons).toEqual({});
  });

  it("插件校验：非法丢弃、同种互斥取首、上限 2 个", () => {
    const parsed = parseShotFxMotionResponse(
      '{"shots": [{"shotId": "s1", "motion": "push-in", "fx": ["shake-soft", "shake-hard", "glow-warm", "chroma", "bogus"]}]}',
      shotIds,
    );
    expect(parsed.addons.s1).toEqual(["shake-soft", "glow-warm"]);
  });

  it("容忍 markdown 代码块与前后杂文；丢弃非法模式与未知 shotId", () => {
    const parsed = parseShotFxMotionResponse(
      '好的：\n```json\n{"shots": [{"shotId": "s1", "motion": "hold", "fx": ["glow-dim"]}, {"shotId": "unknown", "motion": "drift"}, {"shotId": "s2", "motion": "spin"}]}\n```\n以上。',
      shotIds,
    );
    expect(parsed.motions).toEqual({ s1: "hold" });
    expect(parsed.addons).toEqual({ s1: ["glow-dim"] });
  });
});

describe("heuristicShotFxMotions", () => {
  it("与渲染侧规则运镜一致：动作 punch、退场奇数镜走轮换、其余轮换", () => {
    const { motions } = heuristicShotFxMotions(SHOTS);
    expect(motions.s1).toBe("punch-in");
    // s2 含退场词但在奇数镜位（index 1）→ leave-pull 仅偶数镜启用，回落轮换表第 2 项
    expect(motions.s2).toBe(SHOT_FX_MOTION_ROTATION_AT(1));
    expect(motions.s3).toBe(SHOT_FX_MOTION_ROTATION_AT(2));
  });

  it("转场规则兜底：下一镜动作爆点→impact-frame；断裂词（任一侧）→blackout；其余无桶=硬切", () => {
    const { transitions } = heuristicShotFxMotions([
      { shotId: "a", description: "庭院对坐", dialogue: "且慢。" },
      { shotId: "b", description: "剑光轰然炸开", dialogue: "" },
      { shotId: "c", description: "雨歇云散", dialogue: "" },
      { shotId: "d", description: "血祭之地，诀别", dialogue: "" },
      { shotId: "e", description: "远山淡影", dialogue: "" },
    ]);
    // a→b：b 开场动作爆点；b→c：无词命中=硬切；c→d：d 带断裂词；
    // d→e：d 自身断裂词在 from 侧同样成立（断裂发生在血祭镜结尾）。
    expect(transitions).toEqual({ a: "impact-frame", c: "blackout", d: "blackout" });
  });

  it("字幕音效规则兜底：对白优先于画面描述命中声学事件", () => {
    const { sfxCategories } = heuristicShotFxMotions([
      { shotId: "a", description: "风起云涌", dialogue: "听，雷声滚滚。" },
      { shotId: "b", description: "剑出鞘", dialogue: "走吧。" },
    ]);
    expect(sfxCategories).toEqual({ a: "thunder", b: "sword" });
  });
});

describe("selectShotFxMotions", () => {
  it("空分镜返回 empty", async () => {
    const result = await selectShotFxMotions([]);
    expect(result).toEqual({
      motions: {}, addons: {}, grades: {}, atmospheres: {}, transitions: {}, sfxCategories: {}, registries: {}, source: "empty",
    });
  });

  it("AI 成功时返回 ai 来源的运镜+插件组合", async () => {
    textMock.mockResolvedValue({
      success: true,
      text: '{"shots": [{"shotId": "s1", "motion": "punch-in", "fx": ["shake-hard", "chroma"]}, {"shotId": "s2", "motion": "drift"}, {"shotId": "s3", "motion": "tilt-up", "fx": ["glow-warm"]}]}',
    });
    const result = await selectShotFxMotions(SHOTS);
    expect(result.source).toBe("ai");
    expect(result.motions).toEqual({ s1: "punch-in", s2: "drift", s3: "tilt-up" });
    expect(result.addons).toEqual({ s1: ["shake-hard", "chroma"], s3: ["glow-warm"] });
    expect(textMock).toHaveBeenCalledOnce();
  });

  it("依赖未就绪时 prompt 隐藏 registry 模板段（08-22 AI 感知依赖）", async () => {
    textMock.mockResolvedValue({
      success: true,
      text: '{"shots": [{"shotId": "s1", "motion": "punch-in"}, {"shotId": "s2", "motion": "drift"}, {"shotId": "s3", "motion": "tilt-up"}]}',
    });
    const g = globalThis as { electronAPI?: unknown };
    const previous = g.electronAPI;
    g.electronAPI = {
      hyperFramesRegistryDepsCheck: async () => ({ installed: false, installedCount: 16, totalCount: 31, missingPaths: [] }),
    };
    try {
      const result = await selectShotFxMotions(SHOTS);
      expect(result.source).toBe("ai");
      const prompt = (textMock.mock.calls[0]?.[0] as { messages?: Array<{ content: string }> })?.messages?.[1]?.content ?? "";
      expect(prompt).not.toContain("GitHub Registry");
      expect(prompt).not.toContain("hy:");
    } finally {
      if (previous === undefined) {
        delete g.electronAPI;
      } else {
        g.electronAPI = previous;
      }
    }
  });

  it("AI 失败时回落启发式（source=heuristic，不抛错，无插件配置走配方默认）", async () => {
    textMock.mockResolvedValue({ success: false, error: "未配置 AI" });
    const result = await selectShotFxMotions(SHOTS);
    expect(result.source).toBe("heuristic");
    expect(result.motions).toEqual(heuristicShotFxMotions(SHOTS).motions);
    expect(result.addons).toEqual({});
  });

  it("AI 全量非法时同样回落启发式", async () => {
    textMock.mockResolvedValue({ success: true, text: '{"shots": [{"shotId": "s1", "motion": "nope"}]}' });
    const result = await selectShotFxMotions(SHOTS);
    expect(result.source).toBe("heuristic");
  });
});

function SHOT_FX_MOTION_ROTATION_AT(index: number): string {
  // 与 shot-fx-decisions 的轮换表保持同步的最小镜像（避免测试导入实现细节常量导致断言同义反复）
  const rotation = ["push-in", "pull-out", "pan-right", "pan-left", "tilt-down", "tilt-up", "drift"] as const;
  return rotation[index % rotation.length];
}

describe("atmosphere 氛围层解析(08-19 multilayer Child2)", () => {
  it("合法模板收录+同镜去重+上限 2;非法/未知丢弃", () => {
    const raw = JSON.stringify({
      shots: [
        {
          shotId: "s1",
          motion: "hold",
          atmosphere: ["atmo:fog-band", "atmo:light-dust", "atmo:fog-band", "atmo:not-exist", 42, "atmo:embers"],
        },
      ],
    });
    const result = parseShotFxMotionResponse(raw, new Set(["s1"]));
    expect(result.atmospheres.s1).toEqual(["atmo:fog-band", "atmo:light-dust"]);
  });

  it("atmosphere 缺省/空数组=无氛围(安静镜留白)", () => {
    const raw = JSON.stringify({ shots: [{ shotId: "s1", motion: "hold" }, { shotId: "s2", motion: "push-in", atmosphere: [] }] });
    const result = parseShotFxMotionResponse(raw, new Set(["s1", "s2"]));
    expect(result.atmospheres.s1).toBeUndefined();
    expect(result.atmospheres.s2).toBeUndefined();
  });

  it("heuristic 兜底不配氛围(对齐启发式不配 grade 裁定)", () => {
    const result = heuristicShotFxMotions([{ shotId: "s1", description: "火海崩塌爆炸", dialogue: "" }]);
    expect(result.atmospheres).toEqual({});
  });

  it("prompt 含氛围层指南段与 JSON 契约 atmosphere 字段(防 grade 前科重演)", async () => {
    const { selectShotFxMotions } = await import("./shot-fx-ai");
    const { aiManager } = await import("@/lib/ai/ai-manager");
    let capturedPrompt = "";
    vi.mocked(aiManager.text).mockImplementationOnce(async (request) => {
      capturedPrompt = request.messages[1]!.content as string;
      return { success: true, text: JSON.stringify({ shots: [{ shotId: "s1", motion: "hold" }] }) };
    });
    const result = await selectShotFxMotions([{ shotId: "s1", description: "", dialogue: "" }]);
    expect(result.source).toBe("ai");
    expect(result.atmospheres).toEqual({});
    expect(capturedPrompt).toContain("氛围层");
    expect(capturedPrompt).toContain("atmo:fog-band");
    expect(capturedPrompt).toContain("atmo:fireflies");
    expect(capturedPrompt).toContain('"atmosphere"');
  });

  it("prompt 注入逐镜配色锚行与 LUT 同向指南句;无锚镜不加行(08-28 色彩衔接)", async () => {
    const { selectShotFxMotions } = await import("./shot-fx-ai");
    const { aiManager } = await import("@/lib/ai/ai-manager");
    let capturedPrompt = "";
    vi.mocked(aiManager.text).mockImplementationOnce(async (request) => {
      capturedPrompt = request.messages[1]!.content as string;
      return { success: true, text: JSON.stringify({ shots: [{ shotId: "s1", motion: "hold" }, { shotId: "s2", motion: "drift" }] }) };
    });
    const result = await selectShotFxMotions([
      { shotId: "s1", description: "码头对峙", dialogue: "且慢。", colorMood: "(人族·场景)主色赭石+辅色栗褐+点睛藤黄" },
      { shotId: "s2", description: "夜探宗门", dialogue: "" },
    ]);
    expect(result.source).toBe("ai");
    expect(capturedPrompt).toContain("配色锚: (人族·场景)主色赭石+辅色栗褐+点睛藤黄");
    // LUT 指南段含同向纪律句
    expect(capturedPrompt).toContain("同暖调或同冷调");
    expect(capturedPrompt).toContain("不得反向压色");
    // 只有带锚的镜出现配色锚行(s2 无锚不加、无空行残留在解析侧)
    expect(capturedPrompt.split("配色锚:").length - 1).toBe(1);
    // 空白 colorMood 视同缺省
    let promptEmpty = "";
    vi.mocked(aiManager.text).mockImplementationOnce(async (request) => {
      promptEmpty = request.messages[1]!.content as string;
      return { success: true, text: JSON.stringify({ shots: [{ shotId: "s1", motion: "hold" }] }) };
    });
    await selectShotFxMotions([{ shotId: "s1", description: "", dialogue: "", colorMood: "  " }]);
    expect(promptEmpty).not.toContain("配色锚:");
  });
});

describe("vsc:* 运镜指南与配额（10-10 批B,D2/D3/D4）", () => {
  it("干跑:AI 返回 vsc: id 时 selectShotFxMotions 原样选出（AI 摄影指导能选 vsc）", async () => {
    textMock.mockResolvedValue({
      success: true,
      text: '{"shots": [{"shotId": "s1", "motion": "vsc:drone-dive-landing"}, {"shotId": "s2", "motion": "vsc:dutch-roll-to-level"}, {"shotId": "s3", "motion": "push-in"}]}',
    });
    const result = await selectShotFxMotions(SHOTS);
    expect(result.source).toBe("ai");
    expect(result.motions).toEqual({
      s1: "vsc:drone-dive-landing",
      s2: "vsc:dutch-roll-to-level",
      s3: "push-in",
    });
  });

  it("指南含全部 7 个 vsc 运镜条目与配额文案（dolly ≤1 / crash ≤2）", async () => {
    textMock.mockResolvedValue({
      success: true,
      text: '{"shots": [{"shotId": "s1", "motion": "push-in"}, {"shotId": "s2", "motion": "drift"}, {"shotId": "s3", "motion": "tilt-up"}]}',
    });
    await selectShotFxMotions(SHOTS);
    const prompt = (textMock.mock.calls[0]?.[0] as { messages?: Array<{ content: string }> })?.messages?.[1]?.content ?? "";
    for (const id of [
      "vsc:crash-zoom-punch",
      "vsc:dutch-roll-to-level",
      "vsc:slow-push-in",
      "vsc:parallax-glide",
      "vsc:dolly-zoom",
      "vsc:pull-back-isolation",
      "vsc:drone-dive-landing",
    ]) {
      expect(prompt).toContain(`- ${id}:`);
    }
    expect(prompt).toContain("vsc:dolly-zoom 全章至多 1 次");
    expect(prompt).toContain("vsc:crash-zoom-punch 全章至多 2 次");
  });

  it("token 量级断言:指南扩容后 prompt 仍与既有量级同阶（≤12k 字符）", async () => {
    textMock.mockResolvedValue({
      success: true,
      text: '{"shots": [{"shotId": "s1", "motion": "push-in"}, {"shotId": "s2", "motion": "drift"}, {"shotId": "s3", "motion": "tilt-up"}]}',
    });
    await selectShotFxMotions(SHOTS);
    const prompt = (textMock.mock.calls[0]?.[0] as { messages?: Array<{ content: string }> })?.messages?.[1]?.content ?? "";
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt.length).toBeLessThan(12_000);
  });

  it("配额守卫（select 级）:AI 超选 dolly-zoom 时按镜头顺序保留首个,超额回落轮换", async () => {
    textMock.mockResolvedValue({
      success: true,
      text: '{"shots": [{"shotId": "s1", "motion": "vsc:dolly-zoom"}, {"shotId": "s2", "motion": "vsc:dolly-zoom"}, {"shotId": "s3", "motion": "vsc:dolly-zoom"}]}',
    });
    const result = await selectShotFxMotions(SHOTS);
    expect(result.source).toBe("ai");
    expect(result.motions.s1).toBe("vsc:dolly-zoom");
    expect(result.motions.s2).toBe(SHOT_FX_MOTION_ROTATION_AT(1)); // pull-out
    expect(result.motions.s3).toBe(SHOT_FX_MOTION_ROTATION_AT(2)); // pan-right
  });

  it("闭集外 vsc id 解析丢弃（vsc:bogus 不是运镜）", () => {
    const parsed = parseShotFxMotionResponse(
      '{"shots": [{"shotId": "s1", "motion": "vsc:bogus"}, {"shotId": "s2", "motion": "vsc:slow-push-in"}]}',
      new Set(["s1", "s2"]),
    );
    expect(parsed.motions).toEqual({ s2: "vsc:slow-push-in" });
  });

  it("heuristic 关键词可命中 vsc（俯冲→drone-dive;drone 无配额故两镜都保留）", async () => {
    textMock.mockResolvedValue({ success: false, error: "未配置 AI" });
    const shots = [
      { shotId: "d1", description: "镜头自云端俯冲而下", dialogue: "" },
      { shotId: "d2", description: "又一镜俯冲扑近", dialogue: "" },
    ];
    const result = await selectShotFxMotions(shots);
    expect(result.source).toBe("heuristic");
    expect(result.motions.d1).toBe("vsc:drone-dive-landing");
    expect(result.motions.d2).toBe("vsc:drone-dive-landing"); // drone 无配额,两镜都保留
  });
});

describe("cameraMove 桥接线（10-10 批C,design §2.3:建议性非硬门,AI 摄影指导可覆盖）", () => {
  it("AI 显式选择胜出:cameraMove=zoom-in 建议 push-in,AI 选 drift 则 drift", async () => {
    textMock.mockResolvedValue({
      success: true,
      text: '{"shots": [{"shotId": "s1", "motion": "drift"}]}',
    });
    const result = await selectShotFxMotions([
      { shotId: "s1", description: "庭院喝茶", dialogue: "", cameraMove: "zoom-in" },
    ]);
    expect(result.source).toBe("ai");
    expect(result.motions.s1).toBe("drift");
  });

  it("AI 漏选的镜用桥建议补位(不再丢分镜运镜意图);无 cameraMove 的漏选镜仍缺省", async () => {
    // AI 只返回 s1;s2 带 cameraMove=zoom-in→桥补位 push-in;s3 无 cameraMove→不补
    textMock.mockResolvedValue({
      success: true,
      text: '{"shots": [{"shotId": "s1", "motion": "tilt-up"}]}',
    });
    const result = await selectShotFxMotions([
      { shotId: "s1", description: "庭院喝茶", dialogue: "" },
      { shotId: "s2", description: "夜探宗门", dialogue: "", cameraMove: "zoom-in" },
      { shotId: "s3", description: "远山淡影", dialogue: "" },
    ]);
    expect(result.source).toBe("ai");
    expect(result.motions).toEqual({ s1: "tilt-up", s2: "push-in" });
  });

  it("AI 失败回落 heuristic 时桥建议优先于关键词(分镜域运镜词是更强信号)", async () => {
    textMock.mockResolvedValue({ success: false, error: "未配置 AI" });
    const result = await selectShotFxMotions([
      { shotId: "s1", description: "剑光劈落，轰鸣炸开", dialogue: "", cameraMove: "zoom-out" },
    ]);
    expect(result.source).toBe("heuristic");
    expect(result.motions.s1).toBe("pull-out");
  });

  it("prompt 注入分镜运镜行:已映射附初始建议与覆盖口径;未映射仅透出原词;无 cameraMove 不加行", async () => {
    textMock.mockResolvedValue({
      success: true,
      text: '{"shots": [{"shotId": "s1", "motion": "hold"}]}',
    });
    await selectShotFxMotions([
      { shotId: "s1", description: "码头对峙", dialogue: "且慢。", cameraMove: "zoom-in" },
      { shotId: "s2", description: "夜探宗门", dialogue: "", cameraMove: "orbit" },
      { shotId: "s3", description: "远山淡影", dialogue: "" },
    ]);
    const prompt = (textMock.mock.calls[0]?.[0] as { messages?: Array<{ content: string }> })?.messages?.[1]?.content ?? "";
    expect(prompt).toContain("分镜运镜: zoom-in（初始建议 push-in，可按镜头语义覆盖）");
    expect(prompt).toContain("分镜运镜: orbit"); // 留空枚举:原词透出,不带建议
    expect(prompt).not.toContain("分镜运镜: orbit（");
    expect(prompt.split("分镜运镜:").length - 1).toBe(2); // s3 无 cameraMove 不加行
    // 覆盖口径进要求段(建议性非硬门)
    expect(prompt).toContain("分镜列表带「分镜运镜」时尊重其运镜意图");
  });
});
