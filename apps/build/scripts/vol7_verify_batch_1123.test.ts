/** 第七卷三件套批量验证器(vol7 1123 役工具,门规格与 vol1~vol4 逐字同构,役毕删)。 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseStoryboardTable, toStoryboardItems } from "@/lib/studio/storyboard-table";
import { extractScriptVoiceLines } from "@/lib/studio/script-draft-metrics";
import { runScriptPrecheck } from "@/lib/studio/script-precheck";
import { DAOJIE_STRICT_DURATION_SECONDS } from "@/lib/studio/daojie-duration-policy";

const ROOT = "/Users/zhengbingjin/Library/Caches/mystudio/three-artifacts/vol7_batch/ch";
const CHAPTERS = (process.env.VOL7_CH ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const BAD_WORDS = ["电影级", "杰作", "获奖", "超高清", "8K"];
const EMO_WORDS = ["绝望", "愤怒", "悲伤", "开心", "恐惧", "狂喜", "痛哭"];

interface EntityExtraction {
  characters: Array<{ characterId: string; name: string; aliases: string[] }>;
}

for (const ch of CHAPTERS) {
  const dir = `${ROOT}/${ch}`;
  const ts = 1794822000000 + Number(ch.slice(8)) * 1000;
  const sourceScript = { entryId: `work-${ts}-ep${ch.slice(8)}v1`, updatedAt: ts };

  describe(`vol7 ${ch}`, () => {
    it("parse → precheck → rows → voiceStyle 全绿", () => {
      for (const f of ["drama.md", "entities.json", "sbt.md", "directorPlan.md", "voicestyle.json", "novel.md"]) {
        expect(existsSync(`${dir}/${f}`), `${ch} 缺 ${f}`).toBe(true);
      }
      const drama = readFileSync(`${dir}/drama.md`, "utf-8");
      const novel = readFileSync(`${dir}/novel.md`, "utf-8");
      const sbt = readFileSync(`${dir}/sbt.md`, "utf-8");
      const plan = readFileSync(`${dir}/directorPlan.md`, "utf-8");
      const entity = JSON.parse(readFileSync(`${dir}/entities.json`, "utf-8"))
        .state.entityExtractions[0] as EntityExtraction;
      const vsMap = JSON.parse(readFileSync(`${dir}/voicestyle.json`, "utf-8")) as Record<string, string>;

      // 导演计划骨架:七段+自检尾(scriptPlan 包裹)
      expect(plan.startsWith("<scriptPlan>")).toBe(true);
      expect(plan.trimEnd().endsWith("</scriptPlan>")).toBe(true);
      for (const section of ["① 主题立意与叙事核心", "② 视觉风格与画面基调", "③ 叙事结构与节奏规划", "④ 分场景情绪与画面意图", "⑤ 声音方向", "⑥ 转场与视觉连续性", "⑦ 衍生资产预划清单"]) {
        expect(plan.includes(section), `${ch} directorPlan 缺 ${section}`).toBe(true);
      }

      const parsed = parseStoryboardTable(sbt, ch);
      expect(parsed.errors, `${ch} parse errors`).toEqual([]);
      expect(parsed.warnings, `${ch} parse warnings(含 LIGHTING_TERMS 入三列)`).toEqual([]);
      expect(parsed.rows.length).toBeGreaterThanOrEqual(16);
      expect(parsed.rows.length).toBeLessThanOrEqual(24);

      const precheck = runScriptPrecheck({
        rows: parsed.rows.map((r) => ({ index: r.index, duration: r.duration, lines: r.lines })),
        scriptVoiceLines: extractScriptVoiceLines(drama),
        durationCapSeconds: DAOJIE_STRICT_DURATION_SECONDS,
        sourceTextForExemption: novel,
      });
      console.log(`[${ch}] rows=${parsed.rows.length} Σ=${precheck.checks.durationCap.totalSeconds.toFixed(1)}s RED=${precheck.red.length} YELLOW=${precheck.yellow.length} cov=${precheck.checks.dialogueCoverage.coveredRatio}`);
      expect(precheck.red, JSON.stringify(precheck.red)).toEqual([]);
      expect(precheck.yellow, JSON.stringify(precheck.yellow)).toEqual([]);
      expect(precheck.checks.dialogueCoverage.coveredRatio).toBe(1);

      const items = toStoryboardItems(
        parsed.rows,
        ch,
        entity.characters,
        { sourceId: ch, revision: 1 },
        { unknownSpeaker: "narrator", sourceScript },
      );
      expect(items.length).toBe(parsed.rows.length);

      // voiceStyle 后处理:逐镜过程参数,全覆盖,零过期词零情绪结果词
      for (const item of items) {
        const vs = vsMap[String(item.index)];
        expect(vs, `${ch} 镜${item.index} voicestyle.json 缺条目`).toBeTruthy();
        for (const bad of [...BAD_WORDS, ...EMO_WORDS]) {
          expect(vs.includes(bad), `${ch} 镜${item.index} voiceStyle 含违词「${bad}」: ${vs}`).toBe(false);
        }
        expect(vs.length).toBeGreaterThanOrEqual(14);
        item.voiceStyle = vs;
      }
      // 硬门A:标签逗号陷阱——speaker=旁白 但 lines 以「名（…）:」标签开头 = 括注带逗号致解析回退,标签漏进 TTS
      for (const item of items) {
        const trapped = item.speaker === "旁白" && /^([^：:（）]{1,40})（[^）]+）[：:]/.test(item.lines ?? "");
        expect(trapped, `${ch} 镜${item.index} 标签逗号陷阱(括注内逗号致旁白回退+TTS标签泄漏): ${(item.lines ?? "").slice(0, 24)}`).toBe(false);
      }
      // 硬门C:双说话人同格——句末(。！？…)后出现第二个「名(注)?:」标签 = 第二说话人标签漏进 TTS
      const SECOND_LABEL_RE = /(?:。|！|？|…)\s*(?:V\.S\.|OS|旁白)?[^：:，。！？\s]{1,12}(?:（[^）]{1,24}）)?[：:]/;
      for (const row of parsed.rows) {
        const m = (row.lines ?? "").match(SECOND_LABEL_RE);
        expect(m, `${ch} 镜${row.index} 双说话人同格(标签漏进 TTS): ${(row.lines ?? "").slice(0, 30)}`).toBeNull();
      }
      // 硬门B:J5 环境因果句下限(宽口径)
      const j5 = items.filter((item) => /(因[^。]{2,20}(便|就|而|凝|沉|渗|浸|晕)|越[^。]{1,8}越|色层|色深|之处)/.test(item.prompt)).length;
      console.log(`[${ch}] J5=${j5}/${items.length}`);
      expect(j5, `${ch} J5 环境因果句 ${j5} 条低于下限 3`).toBeGreaterThanOrEqual(3);
      const total = items.reduce((acc, item) => acc + item.duration, 0);
      console.log(`[${ch}] items=${items.length} Σ=${total.toFixed(1)}s ids ${items[0]!.id}→${items.at(-1)!.id}`);

      writeFileSync(`${dir}/rows.json`, JSON.stringify(items, null, 1), "utf-8");
      writeFileSync(`${dir}/verify.json`, JSON.stringify({
        chapter: ch,
        rows: parsed.rows.length,
        totalSeconds: total,
        red: precheck.red,
        yellow: precheck.yellow,
        coverage: precheck.checks.dialogueCoverage.coveredRatio,
        osRatio: precheck.checks.osBudget.osRatio,
        voiceLines: extractScriptVoiceLines(drama).length,
        sourceScript,
      }, null, 1), "utf-8");
    });
  });
}
if (!CHAPTERS.length) {
  describe("vol7 batch", () => { it("no chapters given", () => { expect(true).toBe(true); }); });
}
