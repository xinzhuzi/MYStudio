import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { buildStudioManualsFromSkillFiles, buildScriptManualContext, buildStudioManualContext, buildStoryboardTableManualContext } from "@/lib/studio/manuals";
import { buildStageMessages, parseStageOutput } from "@/lib/studio/script-planning";
import { auditDirectorPlanStructure, buildDirectorPlanMessages, parseDirectorPlan } from "@/lib/studio/director-plan";
import { buildStoryboardTableMessages, parseStoryboardTable } from "@/lib/studio/storyboard-table";
import { formatScriptPlanContext } from "@/components/panels/studio/workflow-helpers";
import { buildDaojieAuditMessages, reviewDaojieGeneration, type DaojieAuditInput, type DaojieGenerationStage } from "@/lib/studio/daojie-generation-audit";
const inputFile = process.env.DIRECTOR_CHAIN_INPUT;
const outputFile = process.env.DIRECTOR_CHAIN_OUTPUT;
const research = path.resolve("../.trellis/tasks/10-25-daojie-director-rule-conflict-validation/research");
function checkPath(file: string) { expect(realpathSync(path.dirname(file)).startsWith(research + path.sep)).toBe(true); return file; }
it.skipIf(!inputFile || !outputFile)("offline bridge for current production generation and audit", async () => {
  const job = JSON.parse(readFileSync(checkPath(inputFile!), "utf8"));
  const stage = job.stage as DaojieGenerationStage;
  expect(["script", "planning", "storyboard"]).toContain(stage);
  const source = job.input;
  expect(typeof source.chapterText).toBe("string");
  const config = { directorManualId: "Daojie_xianxia" };
  const files = job.manualFiles as { relativePath: string; content: string; sha256: string }[];
  expect(files).toHaveLength(5);
  for (const file of files) expect(createHash("sha256").update(file.content).digest("hex")).toBe(file.sha256);
  const catalog = { director: buildStudioManualsFromSkillFiles("director", files) };
  const outputText = job.outputText ?? "";
  let structurePassed = true;
  let totalDurationSeconds: number | undefined;
  let parsed: unknown;
  if (stage === "planning" && outputText) { const audit = auditDirectorPlanStructure(outputText); structurePassed = audit.passed; parsed = audit; }
  if (stage === "storyboard" && outputText) {
    const board = parseStoryboardTable(outputText, source.episodeId, { requireShotSemantics: true });
    structurePassed = board.errors.length === 0 && board.rows.length > 0;
    totalDurationSeconds = board.rows.reduce((total, row) => total + row.duration, 0); parsed = board;
  }
  const auditInput: DaojieAuditInput = { stage, sourceText: source.chapterText, bibleContext: source.bibleContext, scriptText: job.scriptText, planText: job.planRaw, outputText, totalDurationSeconds };
  let messages: { system: string; user: string };
  let review: unknown;
  if (job.operation === "audit") messages = buildDaojieAuditMessages(auditInput);
  else if (job.operation === "parse-audit") {
    messages = buildDaojieAuditMessages(auditInput);
    review = await reviewDaojieGeneration(auditInput, async () => ({ success: job.responseSuccess !== false, text: job.reviewText, error: job.responseError }));
  } else {
    const common = { episodeId: source.episodeId, scriptText: job.scriptText ?? "", sourceText: source.chapterText, strictDaojieAdaptation: true, bibleContext: source.bibleContext };
    if (stage === "script") messages = buildStageMessages("scriptDraft", { chapterTitle: source.chapterTitle, chapterText: source.chapterText, originalBibleContext: source.bibleContext, directorContext: buildScriptManualContext(config, catalog), strictDaojieAdaptation: true });
    else if (stage === "planning") messages = buildDirectorPlanMessages({ ...common, manualContext: buildStudioManualContext(config, catalog, { moduleCharCap: 0 }) });
    else {
      const plan = parseDirectorPlan(job.planRaw, source.episodeId);
      messages = buildStoryboardTableMessages({ ...common, manualContext: buildStoryboardTableManualContext(config, catalog), scriptPlanContext: formatScriptPlanContext(plan.plan), assetsInventory: source.assetsInventory });
    }
  }
  const request = { model: "glm-5.3", max_tokens: job.operation === "build" ? ({ script: 4096, planning: 6144, storyboard: 16384 }[stage]) : 4096, temperature: 0.2, thinking: { type: "disabled" }, system: messages.system, messages: [{ role: "user", content: messages.user }] };
  writeFileSync(checkPath(outputFile!), JSON.stringify({ request, structurePassed, totalDurationSeconds, parsed, review, parsedText: parseStageOutput(outputText) }, null, 2) + "\n", { flag: "wx" });
});
