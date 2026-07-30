import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { writeDurableJsonReport } from "../shared/durable-json-report.mjs";

const appsRoot = fileURLToPath(new URL("../..", import.meta.url));
const focusedRoots = [
  "frontend/electron/aitoearn",
  "frontend/electron/ipc/self-media",
  "frontend/components/panels/self-media",
];
const focusedFiles = ["build/scripts/sync-aitoearn-core.test.mjs", "frontend/config/build-scripts.test.ts"];

function discover(root) {
  if (!existsSync(root)) return [];
  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) out.push(...discover(path));
    else if (/\.test\.[cm]?[jt]sx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

export function parseArgs(argv = []) {
  const args = new Set(argv);
  const unknown = argv.filter((arg) => !["--plan", "--skip-release", "--help"].includes(arg));
  if (unknown.length) throw new Error(`Unknown argument: ${unknown[0]}`);
  return { plan: args.has("--plan"), skipRelease: args.has("--skip-release"), help: args.has("--help") };
}

export function discoverFocusedTests() {
  const files = [
    ...focusedRoots.flatMap((root) => discover(resolve(appsRoot, root))),
    ...focusedFiles.map((file) => resolve(appsRoot, file)),
  ]
    .filter((file) => existsSync(file))
    .map((file) => relative(appsRoot, file))
    .sort();
  if (files.length === 0) {
    throw new Error("No focused quality-gate tests were discovered");
  }
  return files;
}

export function buildPlan({ skipRelease = false, platform = process.platform } = {}) {
  const focused = discoverFocusedTests();
  const releaseEnabled = platform === "darwin" && !skipRelease;
  const releaseSkipReason = skipRelease
    ? "release stages skipped by --skip-release"
    : `release stages skipped on ${platform}`;
  const stages = [
    {
      name: "focused-tests",
      executable: "npx",
      args: ["vitest", "run", "--config", "frontend/config/vite.config.ts", ...focused],
    },
    { name: "typecheck", executable: "npm", args: ["run", "typecheck"] },
    { name: "lint", executable: "npm", args: ["run", "lint"] },
    { name: "test", executable: "npm", args: ["run", "test"] },
    {
      name: "smoke:aitoearn-upgrade",
      executable: "npm",
      args: ["run", "smoke:aitoearn-upgrade"],
    },
    {
      name: "build:mac",
      executable: "npm",
      args: ["run", "build:mac"],
      enabled: releaseEnabled,
      skipReason: releaseSkipReason,
    },
    {
      name: "smoke:desktop",
      executable: "npm",
      args: ["run", "smoke:desktop"],
      enabled: releaseEnabled,
      skipReason: releaseSkipReason,
    },
  ];
  return stages;
}

export function formatStageCommand(stage) {
  return [stage.executable, ...stage.args].join(" ");
}

export function createQualityGateReport({ stages, platform, releaseSkipped }) {
  return {
    generatedAt: new Date().toISOString(),
    ok: stages.every((stage) => stage.status === "passed" || stage.status === "skipped"),
    mode: "quality-gate",
    platform,
    releaseSkipped,
    stages,
  };
}

export function runQualityGate(options = {}) {
  const { skipRelease = false, plan = false, platform = process.platform } = options;
  const releaseSkipped = skipRelease || platform !== "darwin";
  const planStages = buildPlan({ skipRelease, platform });
  if (plan) return { stages: planStages, releaseSkipped };
  const results = [];
  for (const stage of planStages) {
    const command = formatStageCommand(stage);
    if (stage.enabled === false) {
      results.push({
        name: stage.name,
        command,
        status: "skipped",
        durationMs: 0,
        exitCode: null,
        reason: stage.skipReason,
      });
      console.log(`[quality-gate] skipped ${stage.name}: ${stage.skipReason}`);
      continue;
    }
    const started = Date.now();
    console.log(`[quality-gate] running ${stage.name}: ${command}`);
    const result = spawnSync(stage.executable, stage.args, {
      cwd: appsRoot,
      stdio: "inherit",
      env: process.env,
    });
    const status = result.status === 0 ? "passed" : "failed";
    results.push({
      name: stage.name,
      command,
      status,
      durationMs: Date.now() - started,
      exitCode: result.status ?? 1,
      ...(status === "failed"
        ? { error: result.error?.message || `exit code ${result.status}` }
        : {}),
    });
    if (status === "failed") break;
  }
  const report = createQualityGateReport({ stages: results, platform, releaseSkipped });
  writeDurableJsonReport(resolve(appsRoot, "output/automation/quality-gate-report.json"), report);
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) { console.log("Usage: node run-quality-gate.mjs [--plan] [--skip-release]"); process.exit(0); }
    const result = runQualityGate(args);
    if (args.plan) {
      console.log(
        result.stages
          .map((stage) => `${stage.name}: ${formatStageCommand(stage)}${stage.enabled === false ? ` [skipped: ${stage.skipReason}]` : ""}`)
          .join("\n"),
      );
    }
    else if (!result.ok) process.exit(1);
  } catch (error) { console.error(error.message); process.exit(2); }
}
