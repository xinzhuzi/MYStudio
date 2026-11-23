import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import type { StudioWorkflowConfig } from "@/types/studio";
import type { StudioManualSkillOverrideFile } from "@/lib/studio/manuals";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const researchRoot = path.join(repoRoot, ".trellis/tasks/10-25-daojie-director-rule-conflict-validation/research");
const inputPath = process.env.DIRECTOR_QUALITY_INPUT;
const outputPath = process.env.DIRECTOR_QUALITY_OUTPUT;

type Stage = "script" | "planning" | "storyboard";
type Arm = "baseline" | "revised";
type Production = {
  manuals: typeof import("@/lib/studio/manuals");
  script: typeof import("@/lib/studio/script-planning");
  planning: typeof import("@/lib/studio/director-plan");
  storyboard: typeof import("@/lib/studio/storyboard-table");
  helpers: typeof import("@/components/panels/studio/workflow-helpers");
};
interface Job {
  caseId: string;
  arm: Arm;
  stage: Stage;
  episodeId: string;
  inputType: "chapter_excerpt" | "canonical_boundary_probe";
  chapterTitle: string;
  chapterText: string;
  bibleContext: string;
  scopeConstraint: string;
  assetsInventory: string;
  scriptText?: string;
  planRaw?: string;
  text?: string;
  tokenBudgets?: Record<Stage, number>;
}
interface ManualFile extends StudioManualSkillOverrideFile {
  sha256: string;
}
const config: Partial<StudioWorkflowConfig> = {
  directorManualId: "Daojie_xianxia", visualManualId: "", platformSpec: "16:9",
};
const budgets: Record<Stage, number> = { script: 2048, planning: 4096, storyboard: 4096 };

function requireCondition(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(label);
}

function validateJob(value: unknown): Job {
  requireCondition(value && typeof value === "object", "Invalid bridge job");
  const job = value as Record<string, unknown>;
  for (const field of ["caseId", "episodeId", "chapterTitle", "chapterText", "bibleContext", "scopeConstraint", "assetsInventory"]) {
    requireCondition(typeof job[field] === "string", `Missing job field: ${field}`);
  }
  requireCondition(job.arm === "baseline" || job.arm === "revised", "Invalid arm");
  requireCondition(["script", "planning", "storyboard"].includes(String(job.stage)), "Invalid stage");
  requireCondition(["chapter_excerpt", "canonical_boundary_probe"].includes(String(job.inputType)), "Invalid input type");
  for (const field of ["scriptText", "planRaw", "text"]) {
    requireCondition(job[field] === undefined || typeof job[field] === "string", `Invalid field: ${field}`);
  }
  return job as unknown as Job;
}

function parseOutput(job: Job, production: Production) {
  const text = production.script.parseStageOutput(job.text ?? "");
  if (!text.trim()) return { status: "failed", error: "empty_parsed_output", warnings: [] };
  if (text.startsWith("[N/A:canonical_boundary_probe]")) {
    return job.inputType === "canonical_boundary_probe"
      ? { status: "not_applicable", reason: text, warnings: [], semanticReviewRequired: true }
      : { status: "failed", error: "unexpected_na_for_chapter", warnings: [] };
  }
  if (job.stage === "script") return { status: "parsed", text, warnings: [] };
  if (job.stage === "planning") {
    const parsed = production.planning.parseDirectorPlan(text, job.episodeId);
    const audit = production.planning.auditDirectorPlanStructure(text);
    const scriptPlanContext = production.helpers.formatScriptPlanContext(parsed.plan);
    const usable = Boolean(parsed.plan.theme.trim() && parsed.plan.sceneIntents.length && scriptPlanContext.trim());
    return {
      status: usable ? "parsed" : "failed", error: usable ? null : "planning_unusable",
      ...parsed, scriptPlanContext, structureAudit: audit, semanticReviewRequired: true,
    };
  }
  const parsed = production.storyboard.parseStoryboardTable(text, job.episodeId);
  return { status: parsed.rows.length > 0 && !parsed.errors.length ? "parsed" : "failed", ...parsed, semanticReviewRequired: true };
}

function researchPath(value: string): string {
  const resolved = path.resolve(value);
  const parent = realpathSync(path.dirname(resolved));
  if (!parent.startsWith(`${realpathSync(researchRoot)}${path.sep}`)) {
    throw new Error("Bridge paths must be inside this task research directory");
  }
  if (existsSync(resolved) && !realpathSync(resolved).startsWith(`${realpathSync(researchRoot)}${path.sep}`)) {
    throw new Error("Bridge symlinks must stay inside task research");
  }
  return resolved;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function buildRequest(job: Job, files: unknown, production: Production) {
  const requestBudgets = job.tokenBudgets ?? budgets;
  requireCondition(
    JSON.stringify(requestBudgets) === JSON.stringify(budgets)
      || (requestBudgets.script === 4096 && requestBudgets.planning === 6144 && [8192, 16384].includes(requestBudgets.storyboard)),
    "Unreviewed output budget profile",
  );
  requireCondition(Array.isArray(files) && files.length === 5, "Exactly five frozen manual files required");
  const checkedFiles: ManualFile[] = files.map((file: unknown) => {
    requireCondition(file && typeof file === "object", "Invalid manual file");
    const item = file as ManualFile;
    requireCondition(typeof item.relativePath === "string" && typeof item.content === "string", "Invalid manual fields");
    requireCondition(item.sha256 === sha256(item.content), "Manual hash mismatch");
    return item;
  });
  const director = production.manuals.buildStudioManualsFromSkillFiles("director", checkedFiles);
  const manual = director.find((item) => item.id === config.directorManualId);
  requireCondition(director.length === 1 && manual?.source === "stored-copy" && manual.moduleCount === 5, "Incomplete stored-copy catalog");
  for (const file of checkedFiles) {
    const key = path.basename(file.relativePath, ".md");
    requireCondition(manual.modules[key] === file.content, "Stored-copy module differs from frozen file");
  }
  const catalog = { director, visual: [] };
  const context = job.stage === "script"
    ? production.manuals.buildScriptManualContext(config, catalog)
    : job.stage === "planning"
      ? production.manuals.buildStudioManualContext(config, catalog, { moduleCharCap: 0 })
      : production.manuals.buildStoryboardTableManualContext(config, catalog);
  const keys = job.stage === "script" ? ["script_narrative"]
    : job.stage === "planning" ? ["README", "director_planning_narrative", "director_storyboard_table_narrative"]
      : ["director_storyboard_table_narrative"];
  const moduleChecks = keys.map((key) => {
    const body = manual.modules[key].trim();
    requireCondition(body && context.includes(body) && context.includes(body.slice(-200)), "Manual module or tail truncated");
    return { key, full: true, tail: true, sha256: sha256(manual.modules[key]) };
  });
  requireCondition(!context.includes(manual.modules.director_style_card_fusion.trim()), "Unexpected default fusion injection");
  let scriptPlanContext = "";
  let planWarnings: string[] = [];
  if (job.stage === "storyboard") {
    requireCondition(typeof job.planRaw === "string", "Missing actual arm planning output");
    const parsed = parseOutput({ ...job, stage: "planning", text: job.planRaw }, production);
    requireCondition(parsed.status === "parsed" && "scriptPlanContext" in parsed, "Planning parse failed: downstream blocked");
    scriptPlanContext = parsed.scriptPlanContext;
    planWarnings = parsed.warnings;
  }
  if (job.stage !== "script") requireCondition(job.scriptText?.trim(), "Missing actual arm script output");
  const messages = job.stage === "script"
    ? production.script.buildStageMessages("scriptDraft", {
      chapterTitle: job.chapterTitle, chapterText: job.chapterText,
      originalBibleContext: job.bibleContext, directorContext: context,
      manualContext: `## 项目信息\n目标画风：未设\n目标画幅：${config.platformSpec}`,
    })
    : job.stage === "planning"
      ? production.planning.buildDirectorPlanMessages({
        episodeId: job.episodeId, scriptText: job.scriptText!, manualContext: context, bibleContext: job.bibleContext,
      })
      : production.storyboard.buildStoryboardTableMessages({
        episodeId: job.episodeId, scriptText: job.scriptText!, scriptPlanContext,
        manualContext: context, bibleContext: job.bibleContext, assetsInventory: job.assetsInventory,
      });
  const system = [messages.system, job.scopeConstraint].filter(Boolean).join("\n\n---\n\n");
  return {
    status: "prepared", config, moduleChecks, planWarnings,
    context: { manualContext: context, bibleContext: job.bibleContext, scopeConstraint: job.scopeConstraint, scriptPlanContext, assetsInventory: job.assetsInventory },
    provenance: {
      inputSha256: sha256(job.chapterText), bibleSha256: sha256(job.bibleContext),
      scriptSha256: job.scriptText ? sha256(job.scriptText) : null,
      planRawSha256: job.planRaw ? sha256(job.planRaw) : null,
      scriptPlanContextSha256: sha256(scriptPlanContext), manualContextSha256: sha256(context),
      manualFiles: checkedFiles.map(({ relativePath, sha256: digest }) => ({ relativePath, sha256: digest })),
    },
    request: { model: "glm-5.3", max_tokens: requestBudgets[job.stage], temperature: 0.2, thinking: { type: "disabled" }, system, messages: [{ role: "user", content: messages.user }] },
  };
}

it.skipIf(!inputPath || !outputPath)("explicit offline production request bridge", async () => {
  const input = JSON.parse(readFileSync(researchPath(inputPath!), "utf8"));
  const output = researchPath(outputPath!);
  const manuals = await import("@/lib/studio/manuals");
  const script = await import("@/lib/studio/script-planning");
  const planning = await import("@/lib/studio/director-plan");
  const storyboard = await import("@/lib/studio/storyboard-table");
  const helpers = await import("@/components/panels/studio/workflow-helpers");
  expect(typeof script.buildStageMessages).toBe("function");
  expect(typeof planning.parseDirectorPlan).toBe("function");
  expect(typeof storyboard.parseStoryboardTable).toBe("function");
  expect(typeof helpers.formatScriptPlanContext).toBe("function");
  const skills = manuals.listAgentSkillPresets().map(({ id, content }) => ({ id, sha256: sha256(content) })).sort((left, right) => left.id.localeCompare(right.id));
  expect(skills.length).toBeGreaterThan(0);
  requireCondition(["probe", "build", "parse"].includes(input.operation), "Unknown bridge operation");
  const production = { manuals, script, planning, storyboard, helpers };
  const results = input.operation === "probe" ? [] : (() => {
    requireCondition(Array.isArray(input.jobs), "Missing bridge jobs");
    return input.jobs.map((value: unknown) => {
      const job = validateJob(value);
      return {
        caseId: job.caseId, arm: job.arm, stage: job.stage,
        ...(input.operation === "build"
          ? buildRequest(job, input.manualArms?.[job.arm], production)
          : parseOutput(job, production)),
      };
    });
  })();
  writeFileSync(output, JSON.stringify({ schemaVersion: 1, status: "ok", skills, skillsSha256: sha256(JSON.stringify(skills)), results }, null, 2) + "\n", { flag: "wx" });
}, 120_000);
