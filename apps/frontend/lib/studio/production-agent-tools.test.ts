import { describe, expect, it, vi } from "vitest";
import {
  createProductionAgentToolRegistry,
  PRODUCTION_AGENT_DEPLOYMENT_MAPPINGS,
} from "./production-agent-tools";

const validDirectorPlanFixture = [
  "<scriptPlan>",
  "# 《道劫第一章》导演创作规划",
  "",
  "## ① 主题立意与叙事核心",
  "核心主题：被宗门火印压住的小镇里，独孤剑尘以不暴露实力的方式救下弱者，并从晏燎身上看见被压制的微光。情感主线从码头的冷硬压迫，转入客栈旧案的克制疼痛，再落到塾馆少年命数的短暂燃起，最终以灵舟压境形成第一章钩子。观众离场时应记住灰衫、断剑、残卷和少年掌心的暗红一息。",
  "",
  "## ② 视觉风格与画面基调",
  "画面基调遵循宣纸淡彩工笔与青绿山水的低饱和质感，人物轮廓靠细密线描和旧金纹理保持识别。构图以偏侧留白、门框压迫、栈道纵深和柜台阻隔表现阶层距离；镜头运动以定镜、缓推、轻微横移为主，禁止写实摄影、三维塑料感、赛璐璐高饱和和画面文字叠加。角色服装、剑包、铜钱、残卷的位置要跨场连续。",
  "",
  "## ③ 叙事结构与节奏规划",
  "叙事按四个戏剧单元推进：Sc1 用码头劳役建立压迫和独孤隐性救人，Sc2 用客栈铜钱与断剑揭开旧案线索，Sc3 用塾馆夜课把晏燎的命数推到观众面前，Sc4 用残卷裂纹和灵舟逼近完成追杀倒计时。节奏先慢压，再短促点燃，最后收成安静而危险的钩子，不把解说塞满每个镜头。",
  "",
  "## ④ 分场景情绪与画面意图",
  "",
  "### Sc1 金水河码头 晨/外",
  "- **情绪目标**：让观众先感到苦力被制度压扁，再看到独孤只动半寸就让灾祸偏开，救人但不显圣。",
  "- **氛围方向**：压迫、冷硬、隐忍。",
  "- **镜头意图**：大远景排出藤筐、矿石、苦力队列；中景跟住独孤草鞋滑半寸；赵四挥鞭与独孤背影错开。",
  "- **空间叙事**：前景朽木栈道，中景赵四和小杂役，背景金水河船影层层压向人物。",
  "- **连续性锚点**：灰衫、破草鞋、油布剑包、袖中残卷和太一宗火印必须保留。",
  "",
  "### Sc2 悦来客栈 夜/内",
  "- **情绪目标**：把独孤的贫困、旧伤和断剑线索收进狭窄斗室，让观众靠近他的秘密但仍不知道全貌。",
  "- **氛围方向**：戒备、逼仄、旧痛翻涌。",
  "- **镜头意图**：柜台正反打让掌柜隔着账册审视独孤；两枚绿锈铜钱落下后切到油布剑包；斗室内揭开三层油布。",
  "- **空间叙事**：大堂、楼梯、走廊、斗室逐层收紧，门框像牢笼一样压住人物。",
  "- **连续性锚点**：铜钱数量、账册位置、腕侧旧疤、断剑断口和油布折痕不能漂移。",
  "",
  "## ⑤ 声音方向",
  "逐场声音要服务压迫和微光：Sc1 用铁链拖石、矿筐碎裂、鞭梢破空和苦力压低的喘息形成底噪，独孤救人瞬间收掉多余声源，只留矿石砸空；Sc2 用算盘珠、铜钱落柜、木梯轻响、油布摩擦和断剑低鸣承接旧案；Sc3 应以孩童呼吸、水缸闷响和枯枝折断突出晏燎被否定后的倔强；Sc4 用更鼓、纸页颤动、缆绳绷紧和灵舟破雾声完成倒计时。",
  "",
  "## ⑥ 转场与视觉连续性",
  "Sc1 到 Sc2 用矿筐裂口的墨痕硬切到客栈账册边缘，保留被压迫的质感；Sc2 到 Sc3 用断剑断口形状接塾馆门框，暗示旧伤寻找新因；Sc3 到 Sc4 用晏燎掌心余温接残卷新裂纹，把希望和杀机并置。连续性锚点包括独孤灰衫和油布剑包、绿锈铜钱、断剑断口、残卷裂纹、晏燎湿草鞋和暗红灵气。",
  "",
  "## ⑦ 衍生资产预划清单",
  "| 资产名 | 衍生状态 | 原因/出现段落 |",
  "|---|---|---|",
  "| 独孤剑尘 | 灰衫入镇态 | Sc1-Sc4 连续出镜 |",
  "</scriptPlan>",
].join("\n");

describe("production agent typed tools", () => {
  it("maps deployment keys to connected call sites or explicit unsupported reasons", () => {
    expect(PRODUCTION_AGENT_DEPLOYMENT_MAPPINGS).toHaveLength(8);
    expect(PRODUCTION_AGENT_DEPLOYMENT_MAPPINGS.filter((item) => item.status === "connected")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "productionAgent:directorPlanAgent", callSite: expect.any(String) }),
        expect.objectContaining({ key: "productionAgent:storyboardTableAgent", callSite: expect.any(String) }),
        expect.objectContaining({ key: "productionAgent:supervisionAgent", callSite: expect.any(String) }),
      ]),
    );
    expect(PRODUCTION_AGENT_DEPLOYMENT_MAPPINGS.filter((item) => item.status === "unsupported")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "productionAgent:decisionAgent", reason: expect.any(String) }),
        expect.objectContaining({ key: "productionAgent:storyboardGenAgent", reason: expect.any(String) }),
      ]),
    );
  });

  it("writes approved director plans through bounded tools", () => {
    const registry = createProductionAgentToolRegistry();
    const saveAgentWorkData = vi.fn(() => "work-director");
    const saveScriptPlan = vi.fn();

    const result = registry.writeDirectorPlan({
      text: validDirectorPlanFixture,
      episodeId: "chapter-001",
      saveAgentWorkData,
      saveScriptPlan,
    });

    expect(result.approved).toBe(true);
    expect(result.workId).toBe("work-director");
    expect(saveAgentWorkData).toHaveBeenCalledWith("directorPlan", validDirectorPlanFixture, "chapter-001");
    expect(saveScriptPlan).toHaveBeenCalledTimes(1);
  });

  it("blocks invalid director plan writeback during supervision", () => {
    const registry = createProductionAgentToolRegistry();
    const saveAgentWorkData = vi.fn();
    const saveScriptPlan = vi.fn();

    const result = registry.writeDirectorPlan({
      text: "<scriptPlan>\n## 拍摄风格\n太短\n</scriptPlan>",
      episodeId: "chapter-001",
      saveAgentWorkData,
      saveScriptPlan,
    });

    expect(result.approved).toBe(false);
    expect(result.error).toContain("导演规划结构不合格");
    expect(saveAgentWorkData).not.toHaveBeenCalled();
    expect(saveScriptPlan).not.toHaveBeenCalled();
  });
});
