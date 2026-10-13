import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 四审D·手册↔注入口径对齐文案契约(10-13-audit4-manual-alignment,TDD RED 先行)。
 *
 * 锁「手册真源文案」本体(node:fs 直读 assets,仿 daojie-manual-contract.test.ts 模式),
 * 覆盖 design.md §9-T5 ①-⑧:H1 分镜表手册对齐规划①-⑦、H2 语速唯一口径 4 字/秒、
 * H4 场头槽位唯一定义、H5 竖屏→16:9、H6 旧格式清理、H7 台词精简阶段限定化、
 * H8 旁白排除三处同批、H9 手册类杂项;⑧=design §8 六族旧词 allowlist 扫描(AC#2 机器化)。
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
  itFile("T5① storyboard_table.md 对齐规划①-⑦+16:9+4字/秒,旧三块/竖屏/$ 出场人物/【BGM】/get_flowData 清零(H1/H5/H6/H9)", () => {
    const content = readManual("production_execution_storyboard_table.md");
    // H1:第 2 步对齐对象=注入摘要的七块(F2,formatScriptPlanContext 逐字标签)
    for (const label of PLAN_BLOCK_LABELS) {
      expect(content, `分镜表手册缺规划块标签「${label}」(H1:仍按废弃三块书写)`).toContain(label);
    }
    // H5(G36 全链 16:9)::14/:16 两处竖屏表述改 16:9
    expect(content, "分镜表手册缺 16:9(H5:竖屏表述未改)").toContain("16:9");
    // 裁定②维持锁:4 字/秒口径零改(F17 含道劫题材收紧举例一并维持)
    expect(content, "分镜表手册缺「4字/秒」(裁定②维持项,不应漂移)").toContain("4字/秒");
    // H1/H5/H6/H9 负向:六族旧词在本文件清零
    for (const legacy of ["分场汇总表", "逐场注意事项", "场间过渡", "竖屏", "$ 出场人物", "【BGM】", "get_flowData"]) {
      expect(content, `分镜表手册残留旧词「${legacy}」`).not.toContain(legacy);
    }
  });

  itFile("T5② script_execution_script.md:4字/秒+{时间}/{内外}+无台词桥+场头唯一定义;150字/分/{时间}/{光线}/资产包 清零(H2/H4/H8/H9)", () => {
    const content = readManual("script_execution_script.md");
    // H2 裁定①::327「×2.5(按 150字/分钟)」→「×4(按 4字/秒)」;:329「≤150字/分钟」→「≤4字/秒」
    expect(content, "剧本手册缺「4字/秒」(H2:仍按 150字/分 旧口径)").toContain("4字/秒");
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
        // 族2 竖屏:剧本/审核手册为【项目信息】目标画幅条件分支(9:16 仍合法可选);
        // lora_stack.md:16 为 Lora 分辨率描述(异义,且 art_skills 为禁改域)
        label: "竖屏",
        pattern: /竖屏/,
        allowed: [
          "script_execution_script.md",
          "script_agent_supervision.md",
          "art_skills/daojie_ink_guofeng/art_prompt/lora_stack.md",
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
        // 族6 150字:分镜表手册:24=裁定②维持的题材收紧举例;README:11=道劫人读文档(H3 已并入注入文件,
        // 本体零改);道劫分镜表 narrative=H3 并入块的同一内容落地处(design §4 逐字文本自带
        // 「150 字/分钟≈2.5 字/秒」,与 :24/README:11 同为「道劫题材收紧基准」豁免类,通用缺省 4 字/秒
        // 已在块内显式声明,不构成口径漂移)
        label: "150字/150 字",
        pattern: /150字|150 字/,
        allowed: [
          "production_execution_storyboard_table.md",
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
