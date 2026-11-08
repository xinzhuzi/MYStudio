/**
 * 预审判断腿实弹探针(1105)——真模型原文 + stats + 发现 + verdict 落盘,不回写 App、不动用户设置。
 *
 * Usage(必须走 vite-node:本件用无扩展名相对 import,裸 `node` 直接 ERR_MODULE_NOT_FOUND,
 * 别据此判这条腿已死):
 *   npx vite-node --config build/timeline/vite-node.config.ts \
 *       build/scripts/qc-vision-live-probe.ts --manifest <json> --output <json>
 * manifest 形如 {model, cases:[{id, provenance, frames, decisions}]};前置=本机 LM Studio 服务在跑。
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { runVisionPreflight, type VisionPreflightDecisionInput, type VisionPreflightFrameInput } from "../../frontend/lib/studio/qc/vision-preflight-runner";
import { buildChapterQcRequirements } from "../../frontend/electron/rendering/plugins/videoqc/chapter-qc-verdicts";

const { values } = parseArgs({ options: { manifest: { type: "string" }, output: { type: "string" } } });
if (!values.manifest || !values.output) throw new Error("需要 --manifest <json> --output <json>");

const manifest = JSON.parse(await readFile(values.manifest, "utf8")) as {
  model: string;
  cases: Array<{
    id: string;
    provenance: string;
    frames: VisionPreflightFrameInput[];
    decisions: VisionPreflightDecisionInput[];
  }>;
};
const outputPath = resolve(values.output);
const report = { startedAt: new Date().toISOString(), model: manifest.model, results: [] as unknown[] };
await writeFile(outputPath, JSON.stringify(report, null, 2), { flag: "wx" });

for (const sample of manifest.cases) {
  const replies: Array<{ content: string; elapsedMs: number }> = [];
  const outcome = await runVisionPreflight({
    frames: sample.frames,
    decisions: sample.decisions,
    readFrameDataUrl: async (path) => {
      const mime = path.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
      return `data:${mime};base64,${(await readFile(path)).toString("base64")}`;
    },
    call: async (messages) => {
      const started = Date.now();
      const response = await fetch("http://127.0.0.1:1234/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: manifest.model, messages, temperature: 0, max_tokens: 2048, stream: false }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw new Error(`Local vision HTTP ${response.status}`);
      const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("本机视觉服务未返回文本");
      replies.push({ content, elapsedMs: Date.now() - started });
      return content;
    },
  });
  const requirements = buildChapterQcRequirements({
    layers: {
      structural: { status: "skipped" }, ffmpegScan: { status: "skipped" }, aesthetic: { status: "skipped" },
      semantic: { status: "skipped" }, vision: { status: "passed" },
    },
    findings: outcome.findings,
    vision: {
      frames: sample.frames, decisions: sample.decisions, frameCount: sample.frames.length,
      densityChecked: 0, frameErrors: 0, preflight: { ...outcome.stats, finishedAt: Date.now() },
    },
  }).filter((item) => ["character-integrity", "text-integrity", "vision-reviewed", "cross-shot-coherence"].includes(item.requirementId));
  report.results.push({ ...sample, replies, outcome, requirements });
  await writeFile(outputPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ id: sample.id, stats: outcome.stats, findings: outcome.findings.map((item) => item.code), requirements: requirements.map((item) => ({ id: item.requirementId, verdict: item.verdict })) }));
}
console.log(`证据已保存 ${outputPath}；本探针不回写 App，未标注样本不提供准确率。`);
