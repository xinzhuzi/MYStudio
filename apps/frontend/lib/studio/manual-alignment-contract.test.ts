import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 四审D·手册↔注入口径对齐文案契约(10-13-audit4-manual-alignment,TDD RED 先行)。
 *
 * 锁「手册真源文案」本体(node:fs 直读 assets,仿 daojie-manual-contract.test.ts 模式),
 * 覆盖 design.md §9-T5 ①-⑧:H1 分镜表手册对齐规划①-⑦、H2 语速区间口径(10-14 晚 Q1 裁定:
 * 全链统一 2.5~4 字/秒区间——超标判定用上限 4、时长估算取保守端 2.5,道劫「题材豁免」废除)、
 * H4 场头槽位唯一定义、H5 竖屏→16:9、H6 旧格式清理、H7 台词精简阶段限定化、
 * H8 旁白排除三处同批、H9 手册类杂项;⑧=design §8 六族旧词 allowlist 扫描(AC#2 机器化);
 * ⑨-⑬=10-14-audit4-residuals D 批增量(R15 区间化逐点/R16 画幅参数化/R17 示例例/R18 残引)。
 *
 * RED 期约定:断言按 design §2-§7 的 GREEN 目标文本写;现文本未改 → 各用例按「指定红因」失败。
 */
const MANUALS_DIR = join(process.cwd(), "frontend/assets/studio-manuals");
const PRESENT = existsSync(MANUALS_DIR);
const itFile = PRESENT ? it : it.skip;

function readManual(rel: string): string {
  return readFileSync(join(MANUALS_DIR, rel), "utf-8");
}

/** 行级文案锁:取含 needle 的全部行(空数组视为断言失败的一并暴露)。 */
function findLines(content: string, needle: string): string[] {
  return content.split(/\r?\n/).filter((line) => line.includes(needle));
}

/** 规划①-⑦块名真源=workflow-helpers.ts formatScriptPlanContext(:19-27)+director_plan.md:12-19。 */
const PLAN_BLOCK_LABELS = [
  "①主题立意",
  "②视觉风格",
  "③叙事节奏",
  "④分场景意图",
  "⑤声音方向",
  "⑥转场设计",
  "⑦衍生资产预划",
] as const;

describe("四审D 手册文案契约(manual-alignment,H1-H9)", () => {
  itFile("T5① storyboard_table.md 对齐规划①-⑦+16:9+语速区间,旧三块/竖屏/$ 出场人物/【BGM】/get_flowData 清零(H1/H5/H6/H9/R15)", () => {
    const content = readManual("production_execution_storyboard_table.md");
    // H1:第 2 步对齐对象=注入摘要的七块(F2,formatScriptPlanContext 逐字标签)
    for (const label of PLAN_BLOCK_LABELS) {
      expect(content, `分镜表手册缺规划块标签「${label}」(H1:仍按废弃三块书写)`).toContain(label);
    }
    // H5(G36 全链 16:9)::14/:16 两处竖屏表述改 16:9
    expect(content, "分镜表手册缺 16:9(H5:竖屏表述未改)").toContain("16:9");
    // Q1 区间口径锁(10-14 晚裁定,取代「唯一=4」单口径):铁律 5 台词时间分配按区间书写
    expect(content, "分镜表手册缺「2.5~4 字/秒」区间表述(R15:仍按单口径)").toContain("2.5~4 字/秒");
    // H1/H5/H6/H9 负向:六族旧词在本文件清零
    for (const legacy of ["分场汇总表", "逐场注意事项", "场间过渡", "竖屏", "$ 出场人物", "【BGM】", "get_flowData"]) {
      expect(content, `分镜表手册残留旧词「${legacy}」`).not.toContain(legacy);
    }
  });

  itFile("T5② script_execution_script.md:语速区间判定句+{时间}/{内外}+无台词桥+场头唯一定义;150字/分/{时间}/{光线}/资产包 清零(H2/H4/H8/H9/R15)", () => {
    const content = readManual("script_execution_script.md");
    // Q1 区间口径::327 场对账(判定面)改「区间上限 4 字/秒」;:329 配音总量带区间表述(R15)
    expect(content, "剧本手册缺「区间上限 4 字/秒」判定句(R15:仍按单口径 4字/秒)").toContain("区间上限 4 字/秒");
    expect(content, "剧本手册缺「2.5~4 字/秒」区间表述(R15)").toContain("2.5~4 字/秒");
    // H4::204/:236(注::223 同块第二示例同改)第三槽 {时间}/{光线} → {时间}/{内外}+唯一定义注
    expect(content, "剧本手册缺「{时间}/{内外}」(H4:模板第三槽仍写光线)").toContain("{时间}/{内外}");
    expect(content, "剧本手册缺「场头格式唯一定义」注(H4)").toContain("场头格式唯一定义");
    // H8::329 句尾补桥「(对应分镜表该镜台词列写『无台词』,不补旁白)」
    expect(content, "剧本手册缺「不补旁白」桥(H8:分镜表『无台词』兼容未回写剧本侧)").toContain("不补旁白");
    // 负向:H2 旧口径/H4 旧槽位/H9 资产包残称清零(文件级)
    for (const legacy of ["150字/分", "{时间}/{光线}", "资产包"]) {
      expect(content, `剧本手册残留旧词「${legacy}」`).not.toContain(legacy);
    }
  });

  itFile("T5③ H7 台词精简阶段限定化:方法文档台词精简行与剧本手册忠实条款行各含阶段限定词(两手册同步)", () => {
    const method = readManual("method_screen_adaptation.md");
    const methodLines = findLines(method, "台词精简");
    expect(methodLines.length, "方法文档找不到「台词精简」行").toBeGreaterThan(0);
    for (const line of methodLines) {
      expect(line, `方法文档「台词精简」行缺阶段限定词(H7):${line.trim().slice(0, 40)}…`).toContain("阶段");
    }

    const script = readManual("script_execution_script.md");
    const faithLines = findLines(script, "原文台词默认照录");
    expect(faithLines.length, "剧本手册找不到「原文台词默认照录」行").toBeGreaterThan(0);
    for (const line of faithLines) {
      expect(line, `剧本手册忠实条款行缺「阶段限定」(H7):${line.trim().slice(0, 40)}…`).toContain("阶段限定");
    }
  });

  itFile("T5④ supervision:输入清单补【题材剧本规则】【自检指标】+场头唯一定义引用+严重度统一;150字/分/爽虐甜 清零(H9/H2/H4)", () => {
    const content = readManual("script_agent_supervision.md");
    // H9:审核输入清单补两节(与 script-planning.ts:207-211 实际注入对齐)
    expect(content, "审核手册缺【题材剧本规则】输入项(H9:清单缺节)").toContain("【题材剧本规则】");
    expect(content, "审核手册缺【自检指标】输入项(H9)").toContain("【自检指标】");
    // H4:场头由重述改引用剧本执行手册唯一定义
    expect(content, "审核手册缺「场头唯一定义」引用(H4:仍重述 {时间}/{光线})").toContain("场头唯一定义");
    expect(content, "审核手册残留「{时间}/{光线}」(H4)").not.toContain("{时间}/{光线}");
    // H9:严重度向上统一——强画面感(中等→严重,对齐维度表可拍摄性)、人物一致性(中等→严重,映射通用红线-5)
    const strongVisualLines = findLines(content, "强画面感");
    expect(strongVisualLines.length).toBeGreaterThan(0);
    for (const line of strongVisualLines) {
      expect(line, `「强画面感」行严重度未升严重(H9):${line.trim().slice(0, 40)}…`).toContain("严重");
    }
    const characterLines = findLines(content, "人物一致性");
    expect(characterLines.length).toBeGreaterThan(0);
    for (const line of characterLines) {
      expect(line, `「人物一致性」行严重度未升严重(H9):${line.trim().slice(0, 40)}…`).toContain("严重");
    }
    // H2 镜像+H9 残称负向
    expect(content, "审核手册残留「150字/分」(H2 镜像未同步)").not.toContain("150字/分");
    expect(content, "审核手册残留「爽/虐/甜」(H9:应为 爆/虐/爽)").not.toContain("爽/虐/甜");
  });

  itFile("T5⑤ entity_extractor.md:旁白排除(V.S.(旁白) 不计角色)+场头唯一定义引用注(H8/H4)", () => {
    const content = readManual("entity_extractor.md");
    // H8:旧句「三种说话人都是出场角色」把旁白一并计角 → 改排除句(design §6 逐字)
    expect(content, "提取手册残留「三种说话人都是出场角色」(H8:旁白仍被计为出场角色)").not.toContain(
      "三种说话人都是出场角色",
    );
    expect(content, "提取手册缺旁白排除句「唯一例外=旁白」(H8)").toContain("唯一例外=旁白");
    // H4:解析镜像保留但注明唯一定义来源
    expect(content, "提取手册缺「场头唯一定义」引用注(H4)").toContain("场头唯一定义");
  });

  itFile("T5⑥ 道劫叙事:分镜表 narrative 并入「单集节奏基准」(H3);规划 narrative 骨架/策略残称清零(H9)", () => {
    const storyboardNarrative = readManual(
      "story_skills/Daojie_xianxia/driector_skills/director_storyboard_table_narrative.md",
    );
    expect(
      storyboardNarrative,
      "道劫分镜表 narrative 缺「单集节奏基准」并入块(H3:README 口径未并入注入文件)",
    ).toContain("单集节奏基准");

    const planningNarrative = readManual(
      "story_skills/Daojie_xianxia/driector_skills/director_planning_narrative.md",
    );
    expect(
      planningNarrative,
      "道劫规划 narrative 残留「骨架/策略」残称(H9:该两层已溶解进剧本头部三行)",
    ).not.toContain("骨架/策略");
  });

  itFile("道劫九境与超越九境终态分离，终态意象不生成肉身余生", () => {
    const root = "story_skills/Daojie_xianxia/";
    const readme = readManual(`${root}README.md`);
    expect(readme).toContain("炼气 → 筑基 → 金丹 → 元婴 → 化神 → 炼虚 → 合体 → 渡劫 → 大乘\n");
    expect(readme).not.toContain("大乘 → 万道归真");
    expect(readme).not.toContain("十大境界");
    for (const module of ["README.md", "script_narrative.md", "driector_skills/director_planning_narrative.md", "driector_skills/director_storyboard_table_narrative.md", "driector_skills/director_style_card_fusion.md"]) {
      const content = readManual(`${root}${module}`);
      expect(content, module).toContain("超越九境的终极状态");
      expect(content, module).toContain("不是第十修炼境界");
      expect(content, module).toContain("不新增肉身余生");
      expect(content, module).not.toMatch(/万道归真.{0,12}终极境界/);
    }
  });

  itFile("道劫三个独立消费模块均区分整体进度与三股特指，保留早期例外", () => {
    const root = "story_skills/Daojie_xianxia/";
    for (const module of ["script_narrative.md", "driector_skills/director_planning_narrative.md", "driector_skills/director_storyboard_table_narrative.md"]) {
      const content = readManual(`${root}${module}`);
      for (const rule of ["三色驳杂→灰黑凝聚→暗金蜕变→暗金主色", "后期明确特指人、妖、鬼三股", "早期灰黑边界反应", "龙气暗金丝缕", "不按颜色反推融合进度", "五系道途不等于三股灵气"]) {
        expect(content, `${module}: ${rule}`).toContain(rule);
      }
      expect(content, module).not.toContain("镜头描述写灵气必须用三色语汇");
      expect(content, module).not.toContain("灵气融合分镜（五系剑圣觉醒）");
    }
  });

  itFile("道劫终态视听均为可选修辞，规划不越界逐镜或补事件", () => {
    const root = "story_skills/Daojie_xianxia/";
    for (const module of ["driector_skills/director_planning_narrative.md", "driector_skills/director_storyboard_table_narrative.md", "driector_skills/director_style_card_fusion.md"]) {
      const content = readManual(`${root}${module}`);
      expect(content, module).toContain("可选修辞");
      expect(content, module).toContain("不强制纯白、三音和声或拉远");
    }
    const planning = readManual(`${root}driector_skills/director_planning_narrative.md`);
    expect(planning).toContain("不生成逐镜表");
    expect(planning).toContain("不补原文未发生的事件");
  });

  itFile("T5⑦ director_plan.md ⑥示例块含复合场号决策行 Sc 1-1 → Sc 1-2(H9/D1,与 167bb90d 正则闭环)", () => {
    const content = readManual("production_execution_director_plan.md");
    expect(content, "规划手册⑥示例缺复合场号行「Sc 1-1 → Sc 1-2」(D1 补行)").toContain("Sc 1-1 → Sc 1-2");
  });

  itFile("T5⑧ 六族旧词 allowlist 扫描:assets/studio-manuals 全目录命中文件 ⊆ design §8 排除清单(AC#2 机器化)", () => {
    const files = listManualMarkdownFiles();
    expect(files.length, "assets/studio-manuals 下未发现任何 md").toBeGreaterThan(0);
    // design §8 定稿表(10-14 全目录 rg 实测);条目=合法消费方(历史对照句/题材收紧举例/条件分支),
    // 命中超出本表=注入面未清零。
    const LEGACY_FAMILIES: Array<{ label: string; pattern: RegExp; allowed: string[] }> = [
      {
        // 族1 分场三块:唯一定期消费方=director_plan.md:10 进化对照句
        // (isToonflowScriptPlan 嗅探器 director-plan.ts:319-337 为代码面现役功能,不在本扫描域)
        label: "分场三块(分场汇总表/逐场注意事项/场间过渡)",
        pattern: /分场汇总表|逐场注意事项|场间过渡/,
        allowed: ["production_execution_director_plan.md"],
      },
      {
        // 族2 竖屏:剧本/审核手册为【项目信息】目标画幅条件分支(9:16 仍合法可选,Q2 裁定);
        // lora_stack.md:16 原豁免已随 10-15 Phase 0 去除「竖屏」字样——条目随之撤销,
        // 道劫美术包再現竖屏即判非豁免命中(Q2「道劫美术包零竖屏」的机器锁)
        label: "竖屏",
        pattern: /竖屏/,
        allowed: [
          "script_execution_script.md",
          "script_agent_supervision.md",
        ],
      },
      {
        // 族3 旧人物列表:唯一命中文件=分镜表手册(H6 清零),无豁免
        label: "$ 出场人物",
        pattern: /\$ 出场人物/,
        allowed: [],
      },
      {
        // 族4 资产包:注入真源=【原著圣经】(source-bible.ts:81),无豁免
        label: "资产包",
        pattern: /资产包/,
        allowed: [],
      },
      {
        // 族5 骨架/策略残层:剧本手册:183/审核手册:78 为历史对照/合并说明句(合法)
        label: "骨架/策略",
        pattern: /骨架\/策略/,
        allowed: ["script_execution_script.md", "script_agent_supervision.md"],
      },
      {
        // 族6 150字(Q1 区间化后收窄):分镜表手册:24 的道劫豁免举例已随 R15 删除——该文件条目
        // 撤销(再現 150 字口径即判非豁免命中);README:11 与道劫 narrative:90 保留的「150 字/分钟」
        // 数值=区间 2.5~4 字/秒的保守端表述(非豁免机制,Q1 裁定「数值可留=保守端」)
        label: "150字/150 字",
        pattern: /150字|150 字/,
        allowed: [
          "story_skills/Daojie_xianxia/README.md",
          "story_skills/Daojie_xianxia/driector_skills/director_storyboard_table_narrative.md",
        ],
      },
    ];

    const problems: string[] = [];
    for (const family of LEGACY_FAMILIES) {
      const hits = files.filter((file) => family.pattern.test(readFileSync(join(MANUALS_DIR, file), "utf-8")));
      const unexpected = hits.filter((file) => !family.allowed.includes(file));
      if (unexpected.length) {
        problems.push(`[${family.label}] 非豁免命中: ${unexpected.join(", ")}`);
      }
    }
    expect(problems, "六族旧词扫描存在非豁免命中(旧词未清零)").toEqual([]);
  });

  // ── 10-14-audit4-residuals D 批增量(R15/R16/R17/R18) ─────────────────────────

  // R15/Q1 语速区间口径逐手册落点(design R15(d) 清单,行号 10-15 实证):
  // 判定面(超标判定线)=区间上限 4 字/秒;估算面=2.5~4 区间、保守端 2.5;道劫豁免措辞全链清零。
  itFile("T5⑨ R15/Q1 语速区间化:判定面=上限4/估算面=2.5~4(保守端2.5),道劫例外措辞清零", () => {
    // 判定类(design (a)):剧本手册 :327 场对账 / :329 配音总量;剧本审核手册 :118
    const script = readManual("script_execution_script.md");
    expect(script, "剧本手册缺「区间上限 4 字/秒」判定句(:327)").toContain("区间上限 4 字/秒");
    expect(script, "剧本手册 :329 缺区间表述").toContain("2.5~4 字/秒");
    const scriptSupervision = readManual("script_agent_supervision.md");
    expect(scriptSupervision, "剧本审核手册 :118 缺区间上限判定句").toContain("超标判定线");
    expect(scriptSupervision, "剧本审核手册 :118 缺区间表述").toContain("2.5~4 字/秒");
    // 估算类(design (d)):制作审核手册 :156/:254;技法手册 :165/:166
    const prodSupervision = readManual("production_agent_supervision.md");
    expect(prodSupervision, "制作审核手册估算句未区间化(:156/:254)").toContain("2.5~4 字/秒");
    expect(prodSupervision, "制作审核手册缺「保守端 2.5」").toContain("保守端 2.5");
    // 负向锚用「（~4 字/秒」带括号形态:裸「~4 字/秒」是区间「2.5~4 字/秒」的子串,不可作负向
    expect(prodSupervision, "制作审核手册残留「（~4 字/秒」旧单点口径").not.toContain("（~4 字/秒");
    const techniques = readManual("production_skills/storyboard_table_techniques.md");
    expect(techniques, "技法手册语速表未区间化(:165/:166)").toContain("2.5~4 字/秒");
    expect(techniques, "技法手册残留「| ~3 字/秒」单点口径(:166)").not.toContain("| ~3 字/秒");
    expect(techniques, "技法手册残留「| ~4 字/秒」单点口径(:165)").not.toContain("| ~4 字/秒");
    // 分镜表手册:豁免机制本体删(:24)+估时长句区间化(:98)
    const storyboardTable = readManual("production_execution_storyboard_table.md");
    expect(storyboardTable, "分镜表手册缺区间表述(:24/:98)").toContain("2.5~4 字/秒");
    expect(storyboardTable, "分镜表手册缺「保守端 2.5」").toContain("保守端 2.5");
    expect(storyboardTable, "分镜表手册残留语速豁免机制本体(:24「另有语速基准…按手册执行」)").not.toContain("另有语速基准");
    expect(storyboardTable, "分镜表手册残留道劫豁免举例(:24,全文件应零道劫)").not.toContain("道劫");
    // 道劫两处(design (d)):narrative :90 豁免措辞删改保守端;README :11 数值可留标保守端
    const narrative = readManual(
      "story_skills/Daojie_xianxia/driector_skills/director_storyboard_table_narrative.md",
    );
    expect(narrative, "道劫叙事残留豁免措辞「本包按此执行」(:90)").not.toContain("本包按此执行");
    expect(narrative, "道劫叙事残留「通用缺省 4 字/秒」旧口径指针(:90)").not.toContain("通用缺省 4 字/秒");
    expect(narrative, "道劫叙事缺「保守端」合区间表述(:90)").toContain("保守端");
    const daojieReadme = readManual("story_skills/Daojie_xianxia/README.md");
    expect(daojieReadme, "道劫 README 缺「保守端」表述(:11)").toContain("保守端");
    expect(daojieReadme, "道劫 README 缺区间表述(:11)").toContain("2.5~4 字/秒");
  });

  // R17(design 分镜表手册 :142):示例行编造旁白删除(与 storyboard-table.ts guard「禁止为凑字段
  // 编造旁白」同一律),纯视觉镜示范「无台词」;时长 5s 与 8~15s 单镜基准(2026-10-10 裁定)不合。
  itFile("T5⑩ R17 分镜表手册示例:纯视觉镜写「无台词」不编造旁白,时长合 8~15s(:142)", () => {
    const content = readManual("production_execution_storyboard_table.md");
    expect(content, "分镜表手册示例残留编造旁白「旁白：西瓜…」(:142)").not.toContain(
      "旁白：西瓜在林志强脚边砸裂",
    );
    expect(content, "分镜表手册示例缺「| 无台词 |」纯视觉示范(:142)").toContain("| 无台词 |");
    expect(content, "分镜表手册示例时长仍为 5s(不合 8~15s 单镜基准)").not.toContain(
      "西瓜筐] | 5 | 近景",
    );
    expect(content, "分镜表手册示例时长未落 8~15s 基准").toContain("西瓜筐] | 8 | 近景");
  });

  // R18/H9:get_flowData 工具层已退役(全仓代码零定义,storyboard-table.ts:26「本调用链无
  // get_flowData 工具」2026-08-22 实证),三手册残引改注入表述(T5① 已覆盖分镜表手册)。
  itFile("T5⑪ R18 get_flowData 残引清零:derive_assets/storyboard_gen/storyboard_panel 三手册", () => {
    for (const rel of [
      "production_execution_derive_assets.md",
      "production_execution_storyboard_gen.md",
      "production_execution_storyboard_panel.md",
    ]) {
      expect(readManual(rel), `${rel} 残留 get_flowData 残引(工具层已退役,数据随消息注入)`).not.toContain(
        "get_flowData",
      );
    }
  });

  // R18/H4:entity_extractor 场次标题模板与单源(script_execution_script.md:236 场头唯一定义,
  // 无粗体)对齐——「(粗体行)」特称与 `**…**` 模板撤销。
  itFile("T5⑫ R18 entity_extractor 场次标题模板与场头唯一定义同式(去粗体行特称)", () => {
    const content = readManual("entity_extractor.md");
    expect(content, "提取手册残留「粗体行」特称(与场头唯一定义单源不一致)").not.toContain("粗体行");
    expect(content, "提取手册场次标题模板残留粗体标记(单源无粗体)").not.toContain("**{场号}");
  });

  // R16/Q2(保绿锁,直绿):画幅=【项目信息】参数——两剧本手册参数化措辞在场;道劫导演/美术包
  // 零竖屏/9:16(2026-10-15 rg 实证零命中,lora_stack.md「竖屏」二字已随 Phase 0 去除)。
  itFile("T5⑬ R16/Q2 画幅=【项目信息】参数:参数化措辞在场+道劫包零竖屏/9:16", () => {
    const script = readManual("script_execution_script.md");
    expect(script, "剧本手册缺「构图符合【项目信息】的目标画幅」参数化措辞(:40)").toContain(
      "构图符合【项目信息】的目标画幅",
    );
    expect(script, "剧本手册缺「画幅适配（按【项目信息】目标画幅）」参数化节(:277)").toContain(
      "画幅适配（按【项目信息】目标画幅）",
    );
    const supervision = readManual("script_agent_supervision.md");
    expect(supervision, "剧本审核手册缺「取自【项目信息】」画幅参数措辞(:86)").toContain("取自【项目信息】");
    const daojieFiles = listManualMarkdownFiles().filter(
      (file) => file.startsWith("story_skills/Daojie_xianxia/") || file.startsWith("art_skills/daojie_ink_guofeng/"),
    );
    expect(daojieFiles.length, "道劫导演/美术包未枚举到任何 md").toBeGreaterThan(0);
    for (const file of daojieFiles) {
      expect(readManual(file), `道劫包文件残留竖屏/9:16(Q2):${file}`).not.toMatch(/竖屏|9:16/);
    }
  });
});

/** 递归枚举 studio-manuals 下全部 md(posix 相对路径)。 */
function listManualMarkdownFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".md")) {
        out.push(relative(MANUALS_DIR, full).split(sep).join("/"));
      }
    }
  };
  walk(MANUALS_DIR);
  return out.sort();
}
