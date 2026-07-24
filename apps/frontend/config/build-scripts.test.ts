import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  auditVisualContinuity,
  visualContinuityFingerprint,
} from "@/lib/studio/visual-continuity";

const appsRoot = resolve(__dirname, "../..");

function readBuildFile(relativePath: string) {
  return readFileSync(resolve(appsRoot, relativePath), "utf8");
}

function runPythonSnippet(source: string) {
  return spawnSync("python3", ["-c", source], {
    cwd: resolve(appsRoot, ".."),
    encoding: "utf8",
  });
}

function runNodeHelper(payload: unknown): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn("node", ["build/generate-storyboard-image.mjs"], {
      cwd: appsRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", rejectRun);
    child.on("close", (status) => {
      resolveRun({ status, stdout, stderr });
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

describe("desktop build scripts", () => {
  it("archives prior canonical JSON reports before writing the latest result", () => {
    const root = mkdtempSync(resolve(tmpdir(), "mystudio-report-retention-"));
    const reportPath = resolve(root, "report.json");
    const result = spawnSync("node", [
      "--input-type=module",
      "-e",
      [
        "import { writeDurableJsonReport } from './build/durable-json-report.mjs';",
        "writeDurableJsonReport(process.env.TARGET_REPORT, { generatedAt: '2026-07-17T00:00:01Z', ok: false });",
        "writeDurableJsonReport(process.env.TARGET_REPORT, { generatedAt: '2026-07-17T00:00:02Z', ok: true });",
      ].join("\n"),
    ], {
      cwd: appsRoot,
      env: { ...process.env, TARGET_REPORT: reportPath },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(readFileSync(reportPath, "utf8"))).toMatchObject({ ok: true });
    const historyDir = resolve(root, "report-history", "report");
    const archives = readdirSync(historyDir);
    expect(archives).toHaveLength(1);
    expect(JSON.parse(readFileSync(resolve(historyDir, archives[0]!), "utf8")))
      .toMatchObject({ ok: false });
  });

  it("use the current frontend build paths", () => {
    const source = readBuildFile("build/build-desktop.mjs");

    expect(source).toContain("'frontend', 'config', 'electron-builder.yml'");
    expect(source).toContain("'frontend', 'config', 'electron-vite.config.ts'");
    expect(source).toContain("'frontend', 'assets', 'brand'");
    expect(source).toContain("'frontend', 'scripts', 'generate-icon.mjs'");
    expect(source).not.toContain("src/config");
    expect(source).not.toContain("src/assets");
    expect(source).not.toContain("src/scripts");
  });

  it("does not install Python into backend during setup", () => {
    const setupSh = readBuildFile("build/setup.sh");
    const setupWin = readBuildFile("build/setup-win.ps1");

    for (const source of [setupSh, setupWin]) {
      expect(source).not.toContain("backend/python");
      expect(source).not.toContain("setup_python");
      expect(source).not.toContain("python-build-standalone");
      expect(source).not.toContain("pip install");
    }
  });

  it("routes mac helper through the current build script path", () => {
    const source = readBuildFile("build/build-mac.sh");

    expect(source).toContain("node ./build/build-desktop.mjs --mac");
    expect(source).toContain("HAS_ARCH=0");
    expect(source).toContain("BUILD_ARGS=\"${BUILD_ARGS} --arm64\"");
    expect(source).toContain("Command: node ./build/build-desktop.mjs --mac$BUILD_ARGS");
    expect(source).toContain("--install|--smoke-installed");
    expect(source).toContain("INSTALL_AFTER_BUILD=1");
    expect(source).toContain("node ./build/install-and-smoke.mjs");
    expect(source).not.toContain("ditto");
    expect(source).not.toContain("/Applications/漫影工作室.app");
    expect(source).not.toContain("backup-");
    expect(source).not.toContain(".backup");
    expect(source).not.toContain("cp -R");
    expect(source).not.toContain("mv ");
    expect(source).not.toContain("rsync");
    expect(source).not.toContain("./src/build/build-desktop.mjs");
    expect(source).not.toContain("SCRIPT_DIR/../..");
  });

  it("routes npm mac builds through the managed desktop build script", () => {
    const source = readBuildFile("package.json");

    expect(source).toContain('"build:mac": "sh ./build/build-mac.sh --arm64"');
    expect(source).toContain('"build:mac:install": "sh ./build/build-mac.sh --arm64 --install"');
    expect(source).not.toContain('"build:mac:install": "node ./build/install-and-smoke.mjs"');
    expect(source).not.toContain(
      "electron-builder --config frontend/config/electron-builder.yml --mac --arm64",
    );
  });

  it("keeps non-runtime docs, tests, and caches out without removing package runtime entrypoints", () => {
    const source = readBuildFile("frontend/config/electron-builder.yml");

    expect(source).not.toContain("!node_modules/**/src/**");

    for (const pattern of [
      "!node_modules/**/docs/**",
      "!node_modules/**/test/**",
      "!node_modules/**/tests/**",
      "!node_modules/**/__tests__/**",
      "!node_modules/**/coverage/**",
      "!node_modules/**/example/**",
      "!node_modules/**/examples/**",
      "!node_modules/**/*.map",
      "!node_modules/**/*.ts",
      "!node_modules/**/*.tsx",
    ]) {
      expect(source).toContain(pattern);
    }

    const backendResourcesStart = source.indexOf("  - from: backend");
    const studioManualResourcesStart = source.indexOf("  - from: frontend/assets/studio-manuals");
    const backendResources = source.slice(backendResourcesStart, studioManualResourcesStart);

    expect(backendResources).toContain("!tests/**");
    expect(backendResources).toContain("!**/tests/**");
    expect(backendResources).toContain("!README.md");
    expect(backendResources).toContain("!**/*.md");
    expect(source).toContain("!**/.cache/**");
    expect(source).toContain("!**/coverage/**");
  });

  it("exposes a packaged desktop smoke test for white-screen regressions", () => {
    const packageJson = readBuildFile("package.json");
    const smokeScript = readBuildFile("build/smoke-desktop.mjs");
    const workflowPreviews = readBuildFile(
      "frontend/components/panels/studio/WorkflowNodePreviews.tsx",
    );

    expect(packageJson).toContain(
      '"smoke:desktop": "node ./build/smoke-desktop.mjs"',
    );
    expect(smokeScript).toContain("dashboard-project-card");
    expect(smokeScript).toContain("项目概览");
    expect(smokeScript).toContain("bodyBg");
    expect(smokeScript).toContain("verifyRoute");
    expect(smokeScript).toContain("verifyOverviewWorkflow");
    expect(smokeScript).toContain("CORE_ROUTE_CHECKS");
    expect(smokeScript).toContain("requiredText");
    expect(smokeScript).toContain("forbiddenText");
    expect(smokeScript).toContain("verifyPythonSettings");
    expect(smokeScript).toContain("missingRequiredText");
    expect(smokeScript).toContain("verifyWorkflowEndToEnd");
    expect(smokeScript).toContain("mystudioWorkflowSmoke");
    expect(smokeScript).toContain("hasEditingProject");
    expect(smokeScript).toContain("hasTimelineRenderRecord");
    expect(smokeScript).toContain("hasCompleteTimelineEvidence");
    expect(smokeScript).toContain("seededEditingEvidence");
    expect(smokeScript).toContain("realMediaGeneration === false");
    expect(smokeScript).toContain("workflowE2E=ok");
    expect(smokeScript).toContain("MYSTUDIO_SMOKE");
    expect(smokeScript).toContain("MYSTUDIO_SMOKE_SKIP_PREKILL");
    expect(smokeScript).toContain("MYSTUDIO_SMOKE_WORKFLOW_E2E_TIMEOUT_MS");
    expect(smokeScript).toContain("WORKFLOW_E2E_TIMEOUT_MS");
    expect(smokeScript).toContain("stopExistingMYStudioInstances");
    expect(smokeScript).toContain('tell application id "com.manju2026.manying-studio" to quit');
    expect(smokeScript).toContain('runOptional("pkill", ["-x", processName])');
    expect(smokeScript).toContain('runOptional("pkill", ["-f", "漫影工作室.app/Contents"])');
    expect(smokeScript).toContain("closed existing MYStudio instances before smoke run");
    expect(smokeScript).toContain("verifyAssetVoiceFlow");
    expect(smokeScript).toContain("verifyScriptAssetGenerationVoiceFlow");
    const generationVoiceFlowStart = smokeScript.indexOf(
      "async function verifyScriptAssetGenerationVoiceFlow",
    );
    const generationVoiceFlowEnd = smokeScript.indexOf(
      "async function captureScreenshotStats",
    );
    const generationVoiceFlow = smokeScript.slice(
      generationVoiceFlowStart,
      generationVoiceFlowEnd,
    );
    expect(generationVoiceFlow).toContain("clickButtonByText('工作流', true)");
    expect(generationVoiceFlow).toContain("当前工作区：漫影工作流");
    expect(smokeScript).toContain("ASSET_VOICE_FLOW_TIMEOUT_MS");
    expect(smokeScript).toContain('"Runtime.evaluate"');
    expect(smokeScript).toContain("withTimeout(");
    expect(smokeScript).toContain("CDP_CALL_TIMEOUT_MS");
    expect(smokeScript).toContain("Smoke测试剑修");
    expect(smokeScript).toContain("searchAssetLibrary");
    expect(smokeScript).toContain("Smoke青年男声");
    expect(smokeScript).toContain("saveMaterial");
    expect(smokeScript).toContain("自动分配音频");
    expect(smokeScript).toContain("为角色「");
    expect(smokeScript).toContain("资产库音频");
    expect(smokeScript).toContain("searchVoiceAssignDialog");
    expect(smokeScript).toContain("搜索音频名称或文件名");
    expect(smokeScript).toContain("确认分配");
    expect(smokeScript).toContain("已绑定音色音频");
    expect(smokeScript).toContain("克隆音色");
    expect(smokeScript).toContain("closeTopDialog");
    expect(smokeScript).toContain("closedVoiceDialog");
    expect(smokeScript).toContain("openDialogCountBeforeAudio");
    expect(smokeScript).toContain("audio[controls]");
    expect(smokeScript).toContain("loadedmetadata");
    expect(smokeScript).toContain("AUDIO_METADATA_TIMEOUT_MS");
    expect(smokeScript).toContain("scriptAssetGenerationVoiceFlow=ok");
    expect(smokeScript).toContain(
      "script asset generation did not expose role audio assignment",
    );
    expect(smokeScript).toContain("音色");
    expect(smokeScript).toContain("开始制作");
    expect(smokeScript).toContain("进入工作流");
    expect(smokeScript).toContain("查看资产库");
    expect(smokeScript).toContain("剧本生产阶段");
    expect(smokeScript).toContain("剧本资产管理");
    expect(smokeScript).not.toContain("label: '剧本资产提取'");
    expect(smokeScript).not.toContain("label: '剧本资产生成'");
    expect(smokeScript).toContain("分镜视频生成");
    expect(smokeScript).toContain("自动排版");
    expect(smokeScript).toContain("角色/场景/道具");
    expect(smokeScript).toContain("视频工作台");
    expect(smokeScript).toContain("requiredText: ['一键成片', '旧拼接导出']");
    expect(smokeScript).not.toContain("requiredText: ['导出成片']");
    expect(smokeScript).toContain("forbiddenText");
    expect(smokeScript).toContain("workflow stage rendered removed content");
    expect(smokeScript).toContain("运行 AI 分镜计划");
    expect(smokeScript).toContain("添加分镜");
    expect(smokeScript).toContain("verifyWorkflowStages");
    expect(smokeScript).toContain("workflow stage missing required content");
    expect(smokeScript).toContain("workflow-node-canvas");
    expect(smokeScript).toContain("react-flow");
    expect(smokeScript).toContain("react-flow__edge");
    expect(smokeScript).toContain("data-flow-node-id");
    expect(smokeScript).toContain("hasTopNodeCanvas");
    expect(smokeScript).toContain("storyboardStage");
    expect(smokeScript).toContain("nodeCardTexts");
    expect(smokeScript).toContain("requiredNodePreviewText");
    expect(smokeScript).toContain("hasNodeFlowDataPreview");
    expect(smokeScript).toContain("hasDirectorPlanPreview");
    expect(smokeScript).toContain("hasToonflowDerivativeLinks");
    expect(smokeScript).toContain("clickedDerivativeImageWorkflow");
    expect(smokeScript).toContain("hasDerivativeImageWorkflowDetail");
    expect(smokeScript).toContain("hasImageWorkflowNodes");
    expect(smokeScript).toContain("hasImageWorkflowPromptNode");
    expect(smokeScript).toContain("hasNoDuplicateGeneratedPromptPanel");
    expect(smokeScript).toContain("hasVisibleImageWorkflowCanvas");
    expect(smokeScript).toContain("hasNoVisibleDuplicateGeneratedPromptPanel");
    expect(smokeScript).toContain("data-toonflow-generated-prompt-panel");
    expect(smokeScript).toContain("hasEditableImageWorkflowPrompt");
    expect(smokeScript).toContain("hasImageWorkflowSource");
    expect(smokeScript).toContain("hasImageWorkflowBackButton");
    expect(smokeScript).toContain("referenceInputValues.some((value) => value.trim().length > 0)");
    expect(workflowPreviews).toContain("data-asset-workflow-id");
    expect(workflowPreviews).toContain("data-parent-asset-id");
    expect(smokeScript).toContain("openDerivativeImageWorkflowDetail");
    expect(smokeScript).toContain("derivativeParentRefsReady");
    expect(smokeScript).toContain("derivativeFlowRefsReady");
    expect(smokeScript).toContain('data-parent-asset-id="\' + id + \'"');
    expect(smokeScript).toContain('data-asset-workflow-id="\' + id + \'"');
    expect(smokeScript).toContain("smoke-flow-scene-low-angle");
    expect(smokeScript).toContain("smoke-flow-prop-broken");
    expect(smokeScript).toContain('data-image-workflow-node-kind="reference"');
    expect(smokeScript).toContain('data-image-workflow-node-kind="generated"');
    expect(smokeScript).toContain("角色衍生 · 落魄江湖客");
    expect(smokeScript).toContain("场景衍生 · 低机位推进");
    expect(smokeScript).toContain("道具衍生 · 断剑破损版");
    expect(smokeScript).toContain("hasStoryboardImagePreview");
    expect(smokeScript).toContain("hasNoDefaultReactFlowControls");
    expect(smokeScript).toContain("hasThemeViewportControls");
    expect(smokeScript).toContain(
      "workflow node cards did not show Toonflow FlowData previews",
    );
    expect(smokeScript).toContain(
      "workflow node cards did not show director plan markdown content",
    );
    expect(smokeScript).toContain(
      "workflow node cards did not show Toonflow derivative asset links",
    );
    expect(smokeScript).toContain(
      "workflow derivative asset card did not open Toonflow image workflow detail",
    );
    expect(smokeScript).toContain(
      "storyboard workflow node did not show generated image previews",
    );
    expect(smokeScript).toContain(
      "storyboard workflow node rendered default white React Flow controls",
    );
    expect(smokeScript).toContain(
      "storyboard workflow node did not render themed viewport controls",
    );
    expect(smokeScript).toContain(
      "storyboard video generation React Flow workflow canvas did not render",
    );
    expect(smokeScript).toContain(
      "workflow node canvas rendered inside 剧本资产管理 instead of 分镜视频生成",
    );
    expect(smokeScript).toContain("Python 运行环境");
    expect(smokeScript).toContain("不随应用启动自动配置");
    expect(smokeScript).toContain("开始配置");
    expect(smokeScript).toContain("安装明细");
    expect(smokeScript).toContain("Python 使用路径");
    expect(smokeScript).toContain("制作流程推进");
    expect(smokeScript).toContain("导演造景");
    expect(smokeScript).toContain("Page.captureScreenshot");
    expect(smokeScript).toContain("screenshot");
    expect(smokeScript).toContain("withTimeout");
    expect(smokeScript).toContain("CDP_CALL_TIMEOUT_MS");
    expect(smokeScript).toContain("socket.close");
    expect(smokeScript).toContain("captureDomVisualStats");
    expect(smokeScript).toContain("captureError");
  });

  it("keeps the workflow integrity skill stepwise instead of relying only on smoke", () => {
    const skill = readFileSync(
      resolve(
        appsRoot,
        "../.agents/skills/mystudio-workflow-integrity-testing/SKILL.md",
      ),
      "utf8",
    );

    for (const requiredText of [
      "## Step-by-Step Review And Test Flow",
      "Review evidence before running the matching test",
      "Do not collapse the checklist into only `npm run smoke:desktop`",
      "Step 1 - Skill contract review",
      "Step 2 - Model contract test",
      "Step 3 - Preview contract test",
      "Step 4 - Smoke bridge seed test",
      "Step 5 - Step-by-step app execution smoke",
      "Step 6 - Build and packaged smoke test",
      "Step 7 - Visual inspection",
    ]) {
      expect(skill).toContain(requiredText);
    }
  });

  it("requires real step-by-step workflow execution instead of seed-only evidence", () => {
    const skill = readFileSync(
      resolve(
        appsRoot,
        "../.agents/skills/mystudio-workflow-integrity-testing/SKILL.md",
      ),
      "utf8",
    );
    const openaiYaml = readFileSync(
      resolve(
        appsRoot,
        "../.agents/skills/mystudio-workflow-integrity-testing/agents/openai.yaml",
      ),
      "utf8",
    );

    for (const requiredText of [
      "seedCompleteWorkflow() is only a seeded preview regression",
      "Step-by-step app execution is the only proof of workflow auto-run",
      "MYSTUDIO_SMOKE_WORKFLOW_STEPWISE=1 npm run smoke:desktop",
      "isolated smoke project",
      "真实用户项目",
      "真实《道劫》项目",
      "_p/{projectId}/...",
      "{basePath}/assets/assets.db",
      "assets/files/...",
      "Clicking a derived asset card must open the asset image workflow detail",
    ]) {
      expect(skill).toContain(requiredText);
    }
    expect(openaiYaml).toContain("step-by-step workflow execution");
  });

  it("keeps props in project split storage instead of the independent asset library", () => {
    const propsStore = readBuildFile("frontend/stores/props-library-store.ts");
    const migration = readBuildFile("frontend/lib/storage-migration.ts");

    expect(propsStore).toContain("createSplitStorage<PropLibraryPersistedState>");
    expect(propsStore).toContain("'props', splitPropLibraryDataForStorage, mergePropLibraryDataForStorage");
    expect(migration).toContain("migrateFlatStore('mystudio-props-library', 'props'");
    expect(migration).toContain("arrayKeys: ['items', 'folders']");
    expect(propsStore).not.toContain("assets/assets.db");
  });

  it("describes derived asset sync with MYStudio project stores instead of Toonflow tool names", () => {
    const manual = readBuildFile("frontend/assets/studio-manuals/production_execution_derive_assets.md");

    expect(manual).toContain("syncDerivedAssets()");
    expect(manual).toContain("character.variations");
    expect(manual).toContain("parentSceneId");
    expect(manual).toContain("parentId");
    expect(manual).not.toContain("add_deriveAsset");
    expect(manual).not.toContain("assetsId");
  });

  it("exposes a packaged stepwise workflow smoke that does not seed complete state", () => {
    const smokeScript = readBuildFile("build/smoke-desktop.mjs");
    const stepwiseStart = smokeScript.indexOf(
      "async function verifyWorkflowStepByStepExecution",
    );
    const stepwiseEnd = smokeScript.indexOf(
      "async function verifyAssetVoiceFlow",
    );
    const stepwise = smokeScript.slice(stepwiseStart, stepwiseEnd);

    expect(stepwiseStart).toBeGreaterThan(-1);
    expect(stepwiseEnd).toBeGreaterThan(stepwiseStart);
    expect(smokeScript).toContain("MYSTUDIO_SMOKE_WORKFLOW_STEPWISE");
    expect(smokeScript).toContain("workflowStepwise=ok");
    expect(stepwise).toContain("resetForStepwiseExecution");
    expect(stepwise).toContain("runStepwiseWorkflowStage");
    expect(stepwise).toContain("inspectWorkflowStages");
    expect(stepwise).toContain("clickButtonByText('工作流', true)");
    expect(stepwise).toContain("clickButtonByText('风格与导演')");
    expect(stepwise).toContain("clickButtonByText('小说导入')");
    expect(stepwise).toContain("clickButtonByText('剧本生产阶段')");
    expect(stepwise).toContain("clickButtonByText('剧本资产管理')");
    expect(stepwise).toContain("clickButtonByText('分镜视频生成')");
    expect(stepwise).toContain("clickButtonByText('视频工作台')");
    expect(stepwise).toContain("waitForStageReady");
    expect(smokeScript).toContain("storySkeletonReview=1");
    expect(smokeScript).toContain("adaptationStrategyReview=1");
    expect(smokeScript).toContain("scriptDraftReview=1");
    expect(stepwise).not.toContain("seedCompleteWorkflow");
  });

  it("persists packaged desktop smoke evidence under output automation", () => {
    const smokeScript = readBuildFile("build/smoke-desktop.mjs");

    expect(smokeScript).toContain("MYSTUDIO_SMOKE_REPORT_PATH");
    expect(smokeScript).toContain('"output", "automation", "desktop-smoke-report.json"');
    expect(smokeScript).toContain("command:");
    expect(smokeScript).toContain("reportPath: smokeReportPath");
    expect(smokeScript).toContain("smoke bridge environment check");
    expect(smokeScript).toContain("isolatedUserDataDir");
    expect(smokeScript).toContain("参考音频 1/1");
    expect(smokeScript).toContain("dialogsClosedBeforeAudio");
    expect(smokeScript).toContain("writeSmokeReport(smokeReport)");
    expect(smokeScript).toContain("report written");
  });

  it("does not fail packaged smoke on offline markdown preview CDN resources", () => {
    const smokeScript = readBuildFile("build/smoke-desktop.mjs");

    expect(smokeScript).toContain("isAllowedOfflinePreviewResourceError");
    expect(smokeScript).toContain('url.startsWith("https://unpkg.com/")');
    expect(smokeScript).toContain('text.includes("Failed to load resource")');
    expect(smokeScript).toContain('url.includes("/@highlightjs/cdn-assets@")');
    expect(smokeScript).toContain('url.includes("/katex@")');
    expect(smokeScript).toContain('url.includes("/mermaid@")');
    expect(smokeScript).toContain("allowedErrors.push(message)");
    expect(smokeScript).toContain("allowedPageErrors");
    expect(smokeScript).toContain("pageErrors: errors.map(summarizePageError)");
  });

  it("exposes a foreground packaged smoke mode for visible app startup", () => {
    const smokeScript = readBuildFile("build/smoke-desktop.mjs");
    const skill = readFileSync(
      resolve(
        appsRoot,
        "../.agents/skills/mystudio-workflow-integrity-testing/SKILL.md",
      ),
      "utf8",
    );

    expect(smokeScript).toContain("MYSTUDIO_SMOKE_FOREGROUND");
    expect(smokeScript).toContain("MYSTUDIO_SMOKE_HOLD_MS");
    expect(smokeScript).toContain("bringSmokeAppToForeground");
    expect(smokeScript).toContain("foreground smoke hold");
    expect(smokeScript).toContain("osascript");
    expect(smokeScript).toContain("System Events");
    expect(skill).toContain("MYSTUDIO_SMOKE_FOREGROUND=1");
    expect(skill).toContain("MYSTUDIO_SMOKE_HOLD_MS=15000");
  });

  it("runs desktop and workflow automation in background without accessibility focus control", () => {
    const packageJson = readBuildFile("package.json");
    const smokeScript = readBuildFile("build/smoke-desktop.mjs");
    const workflowRunner = readBuildFile("build/run-visible-workflow-smoke.mjs");
    const focusHelper = readBuildFile("build/smoke-focus.mjs");
    const videoScript = readBuildFile(
      "build/automate-daojie-chapter001-video.mjs",
    );
    const workflowSkill = readFileSync(
      resolve(
        appsRoot,
        "../.agents/skills/mystudio-workflow-integrity-testing/SKILL.md",
      ),
      "utf8",
    );
    const workflowSpec = readFileSync(
      resolve(
        appsRoot,
        "../.trellis/spec/frontend/workflow-auto-video-smoke.md",
      ),
      "utf8",
    );

    expect(packageJson).toContain(
      '"smoke:workflow:background": "node ./build/run-visible-workflow-smoke.mjs --background"',
    );
    expect(packageJson).toContain(
      '"smoke:workflow:background:daojie": "node ./build/run-visible-workflow-smoke.mjs --background --daojie"',
    );
    expect(smokeScript).toContain(
      'MYSTUDIO_SMOKE_BACKGROUND: foregroundSmoke ? "0" : "1"',
    );
    expect(smokeScript).toContain('if (foregroundSmoke) await send("Page.bringToFront")');
    expect(smokeScript).toContain('const smokeMode = foregroundSmoke ? "visible" : "background"');
    expect(smokeScript).toContain("windowVisibility");
    expect(smokeScript).toContain("documentHasFocus");
    expect(smokeScript).toContain("focusSamples");
    expect(smokeScript).toContain("foregroundViolation");
    expect(workflowRunner).toContain('process.argv.includes("--background")');
    expect(workflowRunner).toContain('MYSTUDIO_SMOKE_BACKGROUND: runInBackground ? "1" : "0"');
    expect(workflowRunner).toContain("if (!runInBackground)");
    expect(workflowRunner).toContain("focusWindowStatement");
    expect(workflowRunner).toContain("background-workflow-daojie-report.json");
    expect(workflowRunner).toContain("windowVisibility");
    expect(workflowRunner).toContain("documentHasFocus");
    expect(workflowRunner).toContain("focusSamples");
    expect(workflowRunner).toContain("foregroundViolation");
    expect(focusHelper).toContain('spawnSync("/usr/bin/lsappinfo", ["front"]');
    expect(focusHelper).not.toContain("osascript");
    expect(focusHelper).not.toContain("System Events");
    expect(videoScript).toContain("MYSTUDIO_SMOKE_BACKGROUND: '1'");
    expect(workflowSkill).toContain("npm run smoke:workflow:background");
    expect(workflowSkill).toContain("foregroundViolation=false");
    expect(workflowSpec).toContain(
      "npm run smoke:workflow:background:daojie -- --auto-video",
    );
    expect(workflowSpec).toContain("MYSTUDIO_SMOKE_BACKGROUND=1");
  });

  it("exposes a normal visible workflow app launcher that stays open", () => {
    const packageJson = readBuildFile("package.json");
    const openScript = readBuildFile("build/open-workflow-smoke-app.mjs");
    const skill = readFileSync(
      resolve(
        appsRoot,
        "../.agents/skills/mystudio-workflow-integrity-testing/SKILL.md",
      ),
      "utf8",
    );

    expect(packageJson).toContain(
      '"smoke:workflow:open": "node ./build/open-workflow-smoke-app.mjs"',
    );
    expect(openScript).toContain("mkdtempSync(resolve(tmpdir(), \"mystudio-smoke-open-\"))");
    expect(openScript).toContain("--user-data-dir=");
    expect(openScript).toContain("MYSTUDIO_SMOKE");
    expect(openScript).toContain("MYSTUDIO_SMOKE_SKIP_PREKILL");
    expect(openScript).toContain("stopExistingMYStudioInstances");
    expect(openScript).toContain('tell application id "com.manju2026.manying-studio" to quit');
    expect(openScript).toContain('runOptional("pkill", ["-x", processName])');
    expect(openScript).toContain('runOptional("pkill", ["-f", "漫影工作室.app/Contents"])');
    expect(openScript).toContain("detached: true");
    expect(openScript).toContain("child.unref()");
    expect(openScript).toContain("bringAppToForeground");
    expect(openScript).toContain("System Events");
    expect(openScript).toContain("left open");
    expect(skill).toContain("npm run smoke:workflow:open");
    expect(skill).toContain("normal visible app startup");
  });

  it("exposes a visible step-by-step workflow runner that clicks through and stays open", () => {
    const packageJson = readBuildFile("package.json");
    const runnerScript = readBuildFile("build/run-visible-workflow-smoke.mjs");
    const smokeScript = readBuildFile("build/smoke-desktop.mjs");
    const lifecycleScript = readBuildFile("build/smoke-process-lifecycle.mjs");
    const skill = readFileSync(
      resolve(
        appsRoot,
        "../.agents/skills/mystudio-workflow-integrity-testing/SKILL.md",
      ),
      "utf8",
    );

    expect(packageJson).toContain(
      '"smoke:workflow:run": "node ./build/run-visible-workflow-smoke.mjs"',
    );
    expect(runnerScript).toContain("MYSTUDIO_SMOKE_WORKFLOW_STEPWISE");
    expect(runnerScript).toContain("MYSTUDIO_SMOKE_FOREGROUND");
    expect(runnerScript).toContain("MYSTUDIO_SMOKE_KEEP_OPEN");
    expect(runnerScript).toContain("MYSTUDIO_SMOKE_SKIP_PREKILL");
    expect(runnerScript).toContain("stopExistingMYStudioInstances");
    expect(runnerScript).toContain('tell application id "com.manju2026.manying-studio" to quit');
    expect(runnerScript).toContain('runOptional("pkill", ["-x", processName])');
    expect(runnerScript).toContain('runOptional("pkill", ["-f", "漫影工作室.app/Contents"])');
    expect(runnerScript).toContain("MYSTUDIO_SMOKE_STEP_DELAY_MS");
    expect(runnerScript).toContain("const defaultStepDelayMs = runInBackground ? 250 : 2500");
    expect(runnerScript).toContain(
      "process.env.MYSTUDIO_SMOKE_STEP_DELAY_MS || defaultStepDelayMs",
    );
    expect(runnerScript).toContain("ensureAppIsForeground");
    expect(runnerScript).toContain("getFrontmostApplicationName");
    expect(runnerScript).toContain("[visible-run] stage");
    expect(runnerScript).toContain("frontmostApp");
    expect(runnerScript).toContain("writeVisibleRunReport");
    expect(runnerScript).toContain("visible-workflow-daojie-report.json");
    expect(runnerScript).toContain("reportPath");
    expect(runnerScript).toContain("primeVisibleStageForFirstClick");
    expect(runnerScript).toContain('stdio: "ignore"');
    expect(runnerScript).not.toContain("child.stdout.on");
    expect(runnerScript).not.toContain("child.stderr.on");
    expect(runnerScript).toContain("if (runPassed && !runInBackground) child.unref()");
    expect(runnerScript).toContain("terminateSpawnedApp");
    expect(smokeScript).toContain("MYSTUDIO_SMOKE_KEEP_OPEN");
    expect(smokeScript).toContain("MYSTUDIO_SMOKE_STEP_DELAY_MS");
    expect(smokeScript).toContain("visible step-by-step delay");
    expect(smokeScript).toContain("leaving app open");
    expect(smokeScript).toContain("keepSmokeAppOpen && smokePassed");
    expect(smokeScript).toContain("terminateSpawnedApp");
    expect(lifecycleScript).toContain('process.kill(-pid, signal)');
    expect(lifecycleScript).toContain('signalSpawnedApp(childProcess, "SIGKILL", detached)');
    expect(skill).toContain("npm run smoke:workflow:run");
    expect(skill).toContain("visible step-by-step workflow runner");
    expect(skill).toContain("[visible-run] stage");
    expect(skill).toContain("frontmostApp=漫影工作室");
  });

  it("exposes a visible Daojie chapter 001 workflow runner that does not use an empty smoke template", () => {
    const packageJson = readBuildFile("package.json");
    const runnerScript = readBuildFile("build/run-visible-workflow-smoke.mjs");
    const autoVideoAudit = readBuildFile(
      "build/visible-workflow-auto-video-audit.mjs",
    );
    const skill = readFileSync(
      resolve(
        appsRoot,
        "../.agents/skills/mystudio-workflow-integrity-testing/SKILL.md",
      ),
      "utf8",
    );

    expect(packageJson).toContain(
      '"smoke:workflow:run:daojie": "node ./build/run-visible-workflow-smoke.mjs --daojie"',
    );
    expect(runnerScript).toContain('process.argv.includes("--auto-video")');
    expect(runnerScript).toContain("MYSTUDIO_WORKFLOW_AUTO_VIDEO");
    expect(runnerScript).toContain("MYSTUDIO_AUTO_VIDEO_TIMEOUT_MS");
    expect(runnerScript).toContain("npm run smoke:workflow:run:daojie -- --auto-video");
    expect(runnerScript).toContain("MYSTUDIO_WORKFLOW_REAL_DAOJIE");
    expect(runnerScript).toContain("cloneRealDaojieUserData");
    expect(runnerScript).toContain("function inspectClonedDaojieProjectData(userDataDir, projectId = daojieProjectId)");
    expect(runnerScript).toContain("inspectClonedDaojieProjectData(userDataDir, realDaojieRun?.projectId)");
    expect(runnerScript).toContain("mystudio-daojie-workflow-run-");
    expect(runnerScript).toContain("copyProjectDirectoryIfExists");
    expect(runnerScript).not.toContain("symlinkSync");
    expect(runnerScript).toContain("sourceWorkflowImagesDir");
    expect(runnerScript).toContain("clonedWorkflowImagesDir");
    expect(runnerScript).toContain('"tts",');
    expect(runnerScript).toContain("chapter-001");
    expect(runnerScript).toContain("第1章：剑主夜访道口镇");
    expect(runnerScript).toContain("Daojie chapter001 clicked through");
    expect(runnerScript).toContain("real-daojie-chapter001-clone");
    expect(runnerScript).toContain("storyboards");
    expect(runnerScript).toContain("storyboardsWithWorkflow");
    expect(runnerScript).toContain("storyboardImageWorkflowsReady");
    expect(runnerScript).toContain("expectedStoryboards: chapterStoryboards.length");
    expect(runnerScript).toContain("videoCandidates");
    expect(runnerScript).toContain("derivedAssetPlan");
    expect(runnerScript).toContain("derivedAssets");
    expect(runnerScript).toContain("derivedImageWorkflowsReady");
    expect(runnerScript).toContain("const expectedStoryboards = Number(daojieRun.expectedStoryboards)");
    expect(runnerScript).toContain("data.storyboards === ${expectedStoryboards}");
    expect(runnerScript).toContain("data.storyboardsWithMediaPath === ${expectedStoryboards}");
    expect(runnerScript).toContain("data.storyboardImageWorkflowsReady === ${expectedStoryboards}");
    expect(runnerScript).toContain("hasLastStoryboardWorkflowEntry");
    expect(runnerScript).toContain("data.derivedImageWorkflowsReady >= 3");
    expect(runnerScript).toContain("openRealDaojieStoryboardImageWorkflowDetail");
    expect(runnerScript).toContain("data-storyboard-workflow-image-id");
    expect(runnerScript).toContain("data-storyboard-id");
    expect(runnerScript).toContain("openRealDaojieDerivativeImageWorkflowDetail");
    expect(runnerScript).toContain("data-asset-workflow-image-id");
    expect(runnerScript).toContain("asset-flow-chapter-001");
    expect(runnerScript).toContain('data-image-workflow-node-kind="reference"');
    expect(runnerScript).toContain('data-image-workflow-node-kind="generated"');
    expect(runnerScript).toContain("captureStoryboardPaletteImageEvidence");
    expect(runnerScript).toContain("图片加载失败");
    expect(runnerScript).toContain("naturalWidth");
    expect(runnerScript).toContain("loadedCardCount");
    expect(runnerScript).toContain("failedCards");
    expect(runnerScript).toContain("scopedDerivativePaletteAbsent");
    expect(runnerScript).toContain("storyboardPaletteImages?.sectionFound === false");
    expect(runnerScript).toContain("hasReferenceNode");
    expect(runnerScript).toContain("hasGeneratedNode");
    expect(runnerScript).toContain("hasAssetWritebackTarget");
    expect(runnerScript).toContain("hasImageWorkflowNodes");
    expect(runnerScript).toContain("hasImageWorkflowPromptNode");
    expect(runnerScript).toContain("hasNoDuplicateGeneratedPromptPanel");
    expect(runnerScript).toContain("hasVisibleImageWorkflowCanvas");
    expect(runnerScript).toContain("hasNoVisibleDuplicateGeneratedPromptPanel");
    expect(runnerScript).toContain("data-toonflow-generated-prompt-panel");
    expect(runnerScript).toContain("hasEditableImageWorkflowPrompt");
    expect(runnerScript).toContain("hasImageWorkflowSource");
    expect(runnerScript).toContain("hasImageWorkflowBackButton");
    expect(runnerScript).toContain("hasImageWorkflowRunAction");
    expect(runnerScript).toContain("hasImageWorkflowWritebackAction");
    expect(runnerScript).toContain("referenceInputValues.some((value) => value.trim().length > 0)");
    expect(runnerScript).toContain("!result.storyboardImageWorkflowDetail?.ready");
    expect(runnerScript).toContain("!result.derivativeImageWorkflowDetail?.ready");
    expect(runnerScript).toContain("!scopedDerivativePaletteAbsent");
    expect(runnerScript).toContain("const expectedStoryboards = Number(realDaojieRun?.expectedStoryboards ?? daojie.expectedStoryboards)");
    expect(runnerScript).toContain("daojie.storyboards !== expectedStoryboards");
    expect(runnerScript).toContain("daojie.storyboardsWithMediaPath !== expectedStoryboards");
    expect(runnerScript).toContain("daojie.storyboardsWithWorkflow !== expectedStoryboards");
    expect(runnerScript).toContain("daojie.storyboardImageWorkflowsReady !== expectedStoryboards");
    expect(runnerScript).toContain("daojie.derivedImageWorkflowsReady < 3");
    expect(runnerScript).toContain("productionTrackIds.has(candidate.trackId)");
    expect(runnerScript).not.toContain("storyboards >= 100");
    expect(runnerScript).not.toContain("storyboards < 100");
    expect(runnerScript).not.toContain("data.storyboards > 0");
    expect(runnerScript).not.toContain("daojie.storyboards < 1");
    expect(runnerScript).not.toContain("daojieChapter001ExpectedStoryboardCount = 43");
    expect(runnerScript).not.toContain("hasStoryboard43WorkflowEntry");
    expect(runnerScript).toContain("does not use resetForStepwiseExecution");
    expect(runnerScript).toContain("Runtime.exceptionThrown");
    expect(runnerScript).toContain("consoleAPICalled");
    expect(runnerScript).toContain("runtimeProblems.length > 0");
    expect(runnerScript).toContain("arg.description");
    expect(runnerScript).toContain("[visible-run] console.error");
    expect(runnerScript).toContain("captureVisibleWorkflowDomEvidence");
    expect(runnerScript).toContain("captureChapterAutoVideoStatus");
    expect(runnerScript).toContain("data-auto-video-stage");
    expect(runnerScript).toContain("一键第一章成片");
    expect(runnerScript).toContain("打开最终 MP4");
    expect(runnerScript).toContain("window.studioRenderer.probeMedia");
    expect(runnerScript).toContain("hasPostClickStageTransition");
    expect(runnerScript).toContain("finalVideoEvidence");
    expect(runnerScript).toContain("auditVisibleAutoVideo");
    expect(runnerScript).toContain('mode: "observation"');
    expect(runnerScript).toContain('mode: "strict"');
    expect(runnerScript).toContain("timelineEvidenceStatus");
    expect(runnerScript).toContain("terminateSpawnedApp");
    expect(autoVideoAudit).toContain('value.terminalStage !== "completed"');
    expect(autoVideoAudit).toContain("final MP4 predates the one-click action");
    expect(autoVideoAudit).toContain("final MP4 is outside the cloned studio-render root");
    expect(autoVideoAudit).toContain("evidence lacks audio or video stream");
    expect(runnerScript).toContain("verifyRealDaojieStageEvidence");
    expect(runnerScript).toContain("manualsReady");
    expect(runnerScript).toContain("workbenchReady");
    expect(runnerScript).toContain("totalStoryboardDuration");
    expect(runnerScript).toContain("totalTrackDuration");
    expect(runnerScript).toContain("daojie.totalStoryboardDuration > 180");
    expect(runnerScript).toContain("daojie.totalTrackDuration > 180");
    expect(runnerScript).toContain("buttonTexts");
    expect(runnerScript).toContain("stage switcher was not visible");
    expect(skill).toContain("npm run smoke:workflow:run:daojie");
    expect(skill).toContain("真实《道劫》第一章节项目");
    expect(skill).toContain("不是 empty smoke template");
  });

  it("rejects the one-click auto-video runner outside a real Daojie clone", () => {
    const result = spawnSync(
      "node",
      ["build/run-visible-workflow-smoke.mjs", "--auto-video"],
      {
        cwd: appsRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          MYSTUDIO_WORKFLOW_REAL_DAOJIE: "0",
          MYSTUDIO_WORKFLOW_AUTO_VIDEO: "0",
        },
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--auto-video requires --daojie");
  });

  it("keeps failed background auto-video reports from counting as media evidence", async () => {
    const auditModuleUrl = pathToFileURL(
      resolve(appsRoot, "build/visible-workflow-auto-video-audit.mjs"),
    ).href;
    const { auditVisibleAutoVideo } = await import(auditModuleUrl);
    const failedBackgroundReport = {
      mode: "background",
      source: "real-daojie-chapter001-clone",
      runChapterAutoVideo: true,
      foregroundViolation: false,
      chapterAutoVideo: {
        enabled: true,
        stageClicked: true,
        clicked: true,
        preClickStage: "idle",
        startedAtMs: Date.now(),
        hasPostClickStageTransition: true,
        terminalStage: "failed",
        timedOut: false,
        hasFinalPathButton: false,
        finalPath: "",
        finalVideoEvidence: null,
        finalVideoEvidenceError: "",
        projectId: "daojie-project",
        chapterId: "chapter-001",
        editingProjectId: "editing-1",
        editingRevision: 1,
        editingSourceSnapshotHash: "snapshot-1",
        hasCurrentTimelineEvidence: false,
        timelineArtifactPaths: null,
        timelineEvidence: null,
        timelineRenderRecord: null,
      },
    };

    expect(failedBackgroundReport).toMatchObject({
      mode: "background",
      runChapterAutoVideo: true,
      foregroundViolation: false,
      chapterAutoVideo: {
        terminalStage: "failed",
        finalPath: "",
      },
    });

    const audit = auditVisibleAutoVideo({
      chapterAutoVideo: failedBackgroundReport.chapterAutoVideo,
      userDataDir: mkdtempSync(resolve(tmpdir(), "mystudio-auto-video-failed-")),
    });

    expect(audit.ok).toBe(false);
    expect(audit.issues.map((item: { code: string }) => item.code)).toEqual(
      expect.arrayContaining([
        "auto-video.terminal",
        "auto-video.final-button",
        "auto-video.extension",
        "auto-video.file-missing",
        "auto-video.evidence-missing",
        "auto-video.timeline-evidence-missing",
        "auto-video.timeline-record-missing",
      ]),
    );
  });

  it("keeps background focus and auto-video audit failures from producing passing wrapper reports", () => {
    const runnerScript = readBuildFile("build/run-visible-workflow-smoke.mjs");

    expect(runnerScript).toMatch(
      /const focusFailure = runInBackground\s+\?\s+foregroundViolation\s+:/,
    );
    expect(runnerScript).toMatch(/autoVideoFailed\s+\|\|\s+focusFailure/);
    expect(runnerScript).toContain("ok: !failed");
    expect(runnerScript).toContain("autoVideoFailed,");
    expect(runnerScript).toContain("autoVideoAudit,");
  });

  it("rejects legacy compatibility videos as authoritative auto-video evidence", async () => {
    const auditModuleUrl = pathToFileURL(
      resolve(appsRoot, "build/visible-workflow-auto-video-audit.mjs"),
    ).href;
    const { auditVisibleAutoVideo } = await import(auditModuleUrl);
    const userDataDir = mkdtempSync(
      resolve(tmpdir(), "mystudio-auto-video-legacy-"),
    );
    const renderRoot = resolve(userDataDir, "media", "studio-render");
    mkdirSync(renderRoot, { recursive: true });
    const legacyPath = resolve(renderRoot, "legacy-python-concat.mp4");
    writeFileSync(legacyPath, "legacy compatibility video");
    const legacyStat = statSync(legacyPath);
    const legacyOnlyReport = {
      legacyCompatibilityVideo: legacyPath,
      legacyCompatibilityVideoEvidence: {
        path: legacyPath,
        sizeBytes: legacyStat.size,
        mtimeMs: legacyStat.mtimeMs,
        sha256: "b".repeat(64),
        duration: 120,
        streams: ["video", "audio"],
      },
      chapterAutoVideo: {
        enabled: true,
        stageClicked: true,
        clicked: true,
        preClickStage: "idle",
        startedAtMs: legacyStat.mtimeMs - 1,
        hasPostClickStageTransition: true,
        terminalStage: "completed",
        timedOut: false,
        hasFinalPathButton: true,
        finalPath: legacyPath,
        finalVideoEvidence: null,
        finalVideoEvidenceError: "",
        projectId: "project-1",
        chapterId: "chapter-1",
        editingProjectId: "editing-1",
        editingRevision: 1,
        editingSourceSnapshotHash: "snapshot-1",
        hasCurrentTimelineEvidence: false,
        timelineArtifactPaths: null,
        timelineEvidence: null,
        timelineRenderRecord: null,
      },
    };

    const audit = auditVisibleAutoVideo({
      chapterAutoVideo: legacyOnlyReport.chapterAutoVideo,
      userDataDir,
    });

    expect(audit.ok).toBe(false);
    expect(audit.issues.map((item: { code: string }) => item.code)).toEqual(
      expect.arrayContaining([
        "auto-video.evidence-missing",
        "auto-video.timeline-evidence-missing",
        "auto-video.timeline-record-missing",
      ]),
    );
  });

  it("executes clone-root, freshness, and final-media evidence rejection", async () => {
    const auditModuleUrl = pathToFileURL(
      resolve(appsRoot, "build/visible-workflow-auto-video-audit.mjs"),
    ).href;
    const { auditVisibleAutoVideo } = await import(auditModuleUrl);
    const userDataDir = mkdtempSync(
      resolve(tmpdir(), "mystudio-auto-video-audit-"),
    );
    const renderRoot = resolve(userDataDir, "media", "studio-render");
    mkdirSync(renderRoot, { recursive: true });
    const finalPath = resolve(renderRoot, "episode-proof.mp4");
    writeFileSync(finalPath, "non-empty smoke evidence");
    for (const artifactPath of [
      resolve(renderRoot, "editing-project.json"),
      resolve(renderRoot, "timeline-render-plan.json"),
      resolve(renderRoot, "input-manifest.json"),
      resolve(renderRoot, "filter-graph.txt"),
      resolve(renderRoot, "render.log"),
      resolve(renderRoot, "ffprobe.json"),
    ]) {
      writeFileSync(artifactPath, "non-empty timeline artifact");
    }
    const timelineArtifactPaths = {
      outputPath: finalPath,
      snapshotPath: resolve(renderRoot, "editing-project.json"),
      renderPlanPath: resolve(renderRoot, "timeline-render-plan.json"),
      inputManifestPath: resolve(renderRoot, "input-manifest.json"),
      filterGraphPath: resolve(renderRoot, "filter-graph.txt"),
      logPath: resolve(renderRoot, "render.log"),
      ffprobePath: resolve(renderRoot, "ffprobe.json"),
    };
    const finalStat = statSync(finalPath);
    const startedAtMs = Math.min(
      finalStat.mtimeMs,
      ...Object.values(timelineArtifactPaths).map((artifactPath) => statSync(artifactPath).mtimeMs),
    ) - 1;
    const base = {
      enabled: true,
      stageClicked: true,
      clicked: true,
      preClickStage: "idle",
      startedAtMs,
      hasPostClickStageTransition: true,
      terminalStage: "completed",
      timedOut: false,
      hasFinalPathButton: true,
      finalPath,
      finalVideoEvidenceError: "",
      finalVideoEvidence: {
        path: finalPath,
        sizeBytes: finalStat.size,
        mtimeMs: finalStat.mtimeMs,
        sha256: "a".repeat(64),
        duration: 120,
        streams: ["video", "audio"],
      },
      projectId: "project-1",
      chapterId: "chapter-1",
      editingProjectId: "editing-1",
      editingRevision: 1,
      editingSourceSnapshotHash: "snapshot-1",
      hasCurrentTimelineEvidence: true,
      timelineArtifactPaths,
      timelineEvidence: {
        jobId: "timeline-1",
        path: finalPath,
      },
      timelineRenderRecord: {
        projectId: "project-1",
        episodeId: "chapter-1",
        editingProjectId: "editing-1",
        editingRevision: 1,
        sourceSnapshotHash: "snapshot-1",
        evidence: { path: finalPath },
      },
    };

    expect(auditVisibleAutoVideo({ chapterAutoVideo: base, userDataDir })).toMatchObject({
      ok: true,
      issues: [],
    });

    const outsidePath = resolve(userDataDir, "stale.mp4");
    writeFileSync(outsidePath, "outside clone render root");
    const outsideStat = statSync(outsidePath);
    const outsideAudit = auditVisibleAutoVideo({
      chapterAutoVideo: {
        ...base,
        finalPath: outsidePath,
        finalVideoEvidence: {
          ...base.finalVideoEvidence,
          path: outsidePath,
          sizeBytes: outsideStat.size,
          mtimeMs: outsideStat.mtimeMs,
        },
      },
      userDataDir,
    });
    expect(outsideAudit.issues.map((item: { code: string }) => item.code)).toContain(
      "auto-video.clone-root",
    );

    const staleAudit = auditVisibleAutoVideo({
      chapterAutoVideo: {
        ...base,
        startedAtMs: finalStat.mtimeMs + 1_000,
      },
      userDataDir,
    });
    expect(staleAudit.issues.map((item: { code: string }) => item.code)).toEqual(
      expect.arrayContaining([
        "auto-video.stale-file",
        "auto-video.evidence-mtime",
        "auto-video.timeline-artifact-stale",
      ]),
    );

    const invalidEvidenceAudit = auditVisibleAutoVideo({
      chapterAutoVideo: {
        ...base,
        finalVideoEvidence: {
          ...base.finalVideoEvidence,
          sha256: "invalid",
          duration: 181,
          streams: ["video"],
        },
      },
      userDataDir,
    });
    expect(invalidEvidenceAudit.issues.map((item: { code: string }) => item.code)).toEqual(
      expect.arrayContaining([
        "auto-video.evidence-sha256",
        "auto-video.evidence-duration",
        "auto-video.evidence-streams",
      ]),
    );

    const missingTimelineAudit = auditVisibleAutoVideo({
      chapterAutoVideo: {
        ...base,
        hasCurrentTimelineEvidence: false,
        timelineRenderRecord: null,
        timelineEvidence: null,
        timelineArtifactPaths: null,
      },
      userDataDir,
    });
    expect(missingTimelineAudit.issues.map((item: { code: string }) => item.code)).toEqual(
      expect.arrayContaining([
        "auto-video.timeline-evidence-missing",
        "auto-video.timeline-record-missing",
      ]),
    );

    const missingArtifactAudit = auditVisibleAutoVideo({
      chapterAutoVideo: {
        ...base,
        timelineArtifactPaths: {
          ...base.timelineArtifactPaths,
          ffprobePath: resolve(renderRoot, "missing-ffprobe.json"),
        },
      },
      userDataDir,
    });
    expect(missingArtifactAudit.issues.map((item: { code: string }) => item.code)).toContain(
      "auto-video.timeline-artifact-missing",
    );

    const outsideArtifactPath = resolve(userDataDir, "outside-render-plan.json");
    writeFileSync(outsideArtifactPath, "outside clone render root");
    const outsideArtifactAudit = auditVisibleAutoVideo({
      chapterAutoVideo: {
        ...base,
        timelineArtifactPaths: {
          ...base.timelineArtifactPaths,
          renderPlanPath: outsideArtifactPath,
        },
      },
      userDataDir,
    });
    expect(outsideArtifactAudit.issues.map((item: { code: string }) => item.code)).toContain(
      "auto-video.timeline-artifact-root",
    );

    const staleTimelineAudit = auditVisibleAutoVideo({
      chapterAutoVideo: {
        ...base,
        timelineRenderRecord: {
          ...base.timelineRenderRecord,
          editingRevision: 2,
        },
      },
      userDataDir,
    });
    expect(staleTimelineAudit.issues.map((item: { code: string }) => item.code)).toContain(
      "auto-video.timeline-revision",
    );

    const wrongSourceTimelineAudit = auditVisibleAutoVideo({
      chapterAutoVideo: {
        ...base,
        timelineRenderRecord: {
          ...base.timelineRenderRecord,
          projectId: "other-project",
          episodeId: "other-chapter",
        },
      },
      userDataDir,
    });
    expect(wrongSourceTimelineAudit.issues.map((item: { code: string }) => item.code)).toEqual(
      expect.arrayContaining([
        "auto-video.timeline-source-project",
        "auto-video.timeline-source-episode",
      ]),
    );
  });

  it("keeps the workflow integrity skill discoverable by trigger wording", () => {
    const skill = readFileSync(
      resolve(
        appsRoot,
        "../.agents/skills/mystudio-workflow-integrity-testing/SKILL.md",
      ),
      "utf8",
    );
    const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
    const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1] ?? "";
    const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1] ?? "";

    expect(name).toBe("mystudio-workflow-integrity-testing");
    expect(description).toMatch(/^Use when /);
    expect(description.length).toBeLessThanOrEqual(500);
    for (const trigger of [
      "workflow completeness",
      "storyboard/video workflow node graph",
      "Toonflow-style node parity",
      "project-scoped persistence",
      "packaged Electron smoke coverage",
      "工作流自动运行",
      "有没有自动化测试这个工作流?",
      "资产保存路径有没有分清楚?",
    ]) {
      expect(description).toContain(trigger);
    }
  });

  it("does not mix static and runtime dynamic imports for shared studio modules", () => {
    const novelActions = readBuildFile(
      "frontend/components/panels/studio/useNovelPipelineActions.ts",
    );
    const scriptAssetActions = readBuildFile(
      "frontend/components/panels/studio/useScriptAssetGenerationActions.ts",
    );
    const assetDialog = readBuildFile(
      "frontend/components/panels/assets/StudioAssetDetailDialog.tsx",
    );
    const assetOrchestrator = readBuildFile(
      "frontend/lib/studio/asset-generation-orchestrator.ts",
    );
    const smokeBridge = readBuildFile("frontend/lib/studio/workflow-smoke-bridge.ts");

    expect(novelActions).not.toContain('await import("@/lib/studio/entity-sync")');
    expect(scriptAssetActions).not.toContain(
      'await import("@/lib/studio/asset-generation-orchestrator")',
    );
    expect(assetDialog).not.toContain('await import("@/stores/props-library-store")');
    expect(assetDialog).not.toContain(
      'await import("@/lib/studio/asset-generation-orchestrator")',
    );
    expect(assetOrchestrator).not.toContain('await import("@/lib/ai/prompt-polisher")');
    expect(smokeBridge).not.toContain('await import("@/lib/studio/workflow-readiness")');
  });

  it("keeps the packaged workflow smoke aligned with script asset generation", () => {
    const smokeScript = readBuildFile("build/smoke-desktop.mjs");
    const assetsStart = smokeScript.indexOf("id: 'assets'");
    const assetsEnd = smokeScript.indexOf("id: 'storyboard'");
    const generationStart = smokeScript.indexOf("id: 'generation'");
    const storyboardStart = smokeScript.indexOf("id: 'storyboard'");
    const storyboardEnd = smokeScript.indexOf("id: 'workbench'");
    const assetsStage = smokeScript.slice(assetsStart, assetsEnd);
    const storyboardStage = smokeScript.slice(storyboardStart, storyboardEnd);
    const assetsRequiredText =
      assetsStage.match(/requiredText: \[([^\]]+)\]/)?.[1] ?? "";

    expect(assetsStart).toBeGreaterThan(-1);
    expect(assetsEnd).toBeGreaterThan(assetsStart);
    expect(generationStart).toBe(-1);
    expect(storyboardStart).toBeGreaterThan(-1);
    expect(storyboardEnd).toBeGreaterThan(storyboardStart);
    expect(assetsStage).toContain("还没有剧本：请先在「剧本生产阶段」生成各章剧本");
    expect(assetsStage).toContain("承接本阶段已提取的角色、场景、道具");
    expect(assetsRequiredText).not.toContain("'全部润色提示词'");
    expect(assetsRequiredText).not.toContain("'生成图片'");
    expect(assetsStage).toContain("'全部润色提示词'");
    expect(assetsStage).toContain("'生成图片 ('");
    expect(assetsStage).toContain("参考音频");
    expect(assetsStage).not.toContain("requiredText: ['剧本资产提取'");
    expect(assetsStage).not.toContain("requiredText: ['剧本资产生成'");
    expect(assetsStage).toContain("'角色/场景/道具'");
    expect(storyboardStage).toContain("自动排版");
    expect(storyboardStage).not.toContain("requiredText: ['分镜视频生成'");
    expect(assetsStage).toContain("forbiddenText");
    expect(assetsStage).toContain("运行导演计划");
    expect(assetsStage).toContain("锁定剧集圣经");
    expect(assetsStage).not.toContain("创建缺失资产");
  });

  it("exposes a no-backup installed app smoke flow", () => {
    const packageJson = readBuildFile("package.json");
    const installSmokeScript = readBuildFile("build/install-and-smoke.mjs");

    expect(packageJson).toContain(
      '"smoke:installed": "node ./build/install-and-smoke.mjs"',
    );
    expect(installSmokeScript).toContain("/Applications/漫影工作室.app");
    expect(installSmokeScript).toContain("stopInstalledAppIfRunning");
    expect(installSmokeScript).toContain("MYSTUDIO_SMOKE_SKIP_PREKILL");
    expect(installSmokeScript).toContain("tell application id \"com.manju2026.manying-studio\" to quit");
    expect(installSmokeScript).toContain("pkill");
    expect(installSmokeScript).toContain("漫影工作室");
    expect(installSmokeScript).toContain("漫影工作室 Helper");
    expect(installSmokeScript).toContain("漫影工作室.app/Contents");
    expect(installSmokeScript).toContain("ditto");
    expect(installSmokeScript).toContain("app.asar");
    expect(installSmokeScript).toContain("createHash");
    expect(installSmokeScript).toContain("forbidden backup app copies");
    expect(installSmokeScript).toMatch(/漫影工作室\\\.app/);
    expect(installSmokeScript).not.toContain("name.includes('backup-*')");
    expect(installSmokeScript).toContain(
      "mkdtempSync(resolve(tmpdir(), 'mystudio-installed-smoke-'))",
    );
    expect(installSmokeScript).toContain("MYSTUDIO_SMOKE_APP_BIN");
    expect(installSmokeScript).toContain("MYSTUDIO_SMOKE_USER_DATA_DIR");
    expect(installSmokeScript).toContain("npm run smoke:desktop");
    expect(installSmokeScript).not.toMatch(
      /spawnSync\(['\"](?:mv|cp|rsync)['\"]/,
    );
    expect(installSmokeScript).not.toMatch(
      /['\"](?:mv|cp|rsync)['\"],\s*\[[^\]]*backup/,
    );
    expect(installSmokeScript).not.toContain("mv /Applications/漫影工作室.app");
    expect(installSmokeScript).not.toContain(
      "cp -R /Applications/漫影工作室.app",
    );
  });

  it("exposes an automated Daojie chapter 001 video output flow", () => {
    const packageJson = readBuildFile("package.json");
    const videoScript = readBuildFile(
      "build/automate-daojie-chapter001-video.mjs",
    );
    const timelineRunnerScript = readBuildFile(
      "build/render-daojie-editing-timeline.ts",
    );
    const timelineRunnerConfig = readBuildFile("build/vite-node.config.ts");
    const generatorScript = readFileSync(
      resolve(appsRoot, "..", "Library", "build_daojie_chapter001_workflow.py"),
      "utf8",
    );

    expect(packageJson).toContain(
      '"video:daojie:chapter001": "node ./build/automate-daojie-chapter001-video.mjs"',
    );
    expect(packageJson).toContain(
      '"video:daojie:chapter001:visual-preflight": "MYSTUDIO_DAOJIE_VISUAL_PREFLIGHT=1 ./node_modules/.bin/vite-node --config build/vite-node.config.ts build/audit-daojie-visual-continuity.ts"',
    );
    expect(packageJson).toContain(
      '"video:daojie:chapter001:probe-providers": "node ./build/automate-daojie-chapter001-video.mjs --probe-providers"',
    );
    expect(videoScript).toContain("Library");
    expect(videoScript).toContain("build_daojie_chapter001_workflow.py");
    expect(videoScript).toContain("build/render-daojie-editing-timeline.ts");
    expect(videoScript).toContain("./node_modules/.bin/vite-node");
    expect(videoScript).toContain("build/vite-node.config.ts");
    expect(videoScript).toContain("MYSTUDIO_DAOJIE_TIMELINE_RUNNER: '1'");
    expect(videoScript).toContain("daojie-chapter001-video-report.json");
    expect(videoScript).toContain("MYSTUDIO_SMOKE_SKIP_PREKILL");
    expect(videoScript).toContain("stopExistingMYStudioInstances");
    expect(videoScript).toContain("tell application id \"com.manju2026.manying-studio\" to quit");
    expect(videoScript).toContain("pkill");
    expect(videoScript).toContain("漫影工作室 Helper");
    expect(videoScript).toContain("漫影工作室.app/Contents");
    expect(videoScript).toContain("closed existing MYStudio instances before Daojie video generation");
    expect(videoScript).toContain("ffprobe");
    expect(videoScript).toContain("storyboardsWithAssetLinks");
    expect(videoScript).toContain("storyboardImageGenerationMode");
    expect(videoScript).toContain("imageGenerationProvider");
    expect(videoScript).toContain("storyboardImageWorkflowManifest");
    expect(videoScript).toContain("requireStoryboardPromptIntegrity(generated)");
    expect(videoScript).toContain("requireDaojieVisualContinuityPreflight");
    expect(videoScript).toContain("build/audit-daojie-visual-continuity.ts");
    expect(videoScript).toContain("MYSTUDIO_DAOJIE_VISUAL_PREFLIGHT");
    expect(videoScript).toContain("MYSTUDIO_DAOJIE_USE_APPROVED_STORYBOARDS");
    expect(videoScript).toContain("generatedImages !== 0 || generated.reusedImages !== storyboardCount");
    expect(videoScript).toContain("requireDirectorPlanIntegrity(generated)");
    expect(videoScript).toContain("directorPlanAuditFields(generated)");
    expect(videoScript).toContain("MIN_DAOJIE_DIRECTOR_PLAN_CHARS = 4500");
    expect(videoScript).toContain("MIN_DAOJIE_DIRECTOR_PLAN_CHINESE_CHARS = 2500");
    expect(videoScript).toContain("EXPECTED_DAOJIE_DIRECTOR_PLAN_SCENES = 5");
    expect(videoScript).toContain("导演规划正文过短");
    expect(videoScript).toContain("导演规划缺少必需 Sc 场景段");
    expect(videoScript).toContain("storyboardPromptManifest");
    expect(videoScript).toContain("storyboardPromptsWithReferenceBindings");
    expect(videoScript).toContain("storyboardPromptsWithDaojieStyleLock");
    expect(videoScript).toContain("storyboardPromptsWithLightSection");
    expect(videoScript).toContain("storyboardPromptsWithMissingVisibleCharacterRefs");
    expect(videoScript).toContain("storyboardPromptsWithRawAssetNameLeaks");
    expect(videoScript).toContain("分镜提示词参考图绑定不完整");
    expect(videoScript).toContain("分镜可见角色缺少参考图");
    expect(videoScript).toContain("分镜画面段仍泄漏原始资产名");
    expect(videoScript).toContain("分镜图片工作流明细缺失");
    expect(videoScript).toContain("分镜图片工作流缺少参考节点");
    expect(videoScript).toContain("分镜图片工作流缺少参考图到生成图连线");
    expect(videoScript).toContain("MYSTUDIO_DAOJIE_STORYBOARD_IMAGE_MODE");
    expect(videoScript).toContain("real-ai-reference-image-workflow");
    expect(videoScript).toContain("loadStoryboardImageProviderConfigsFromAppSettings");
    expect(videoScript).toContain("probeProvidersOnly");
    expect(videoScript).toContain("runImageProviderProbe");
    expect(videoScript).toContain("generationEndpointCalled: false");
    expect(videoScript).toContain("daojie-chapter001-provider-probe-report.json");
    expect(packageJson).toContain('"video:daojie:chapter001:probe-generation": "node ./build/automate-daojie-chapter001-video.mjs --probe-generation"');
    expect(packageJson).toContain('"video:daojie:chapter001:continuity-pilot": "node ./build/automate-daojie-chapter001-video.mjs --continuity-pilot"');
    expect(packageJson).toContain('"video:daojie:chapter001:continuity-full": "node ./build/automate-daojie-chapter001-video.mjs --continuity-full-chapter"');
    expect(videoScript).toContain("probeGenerationOnly");
    expect(videoScript).toContain("runImageGenerationProbe");
    expect(videoScript).toContain("providers.length !== 1 || providers[0].apiKeys.length !== 1");
    expect(videoScript).toContain("singleAttempt: true");
    expect(videoScript).toContain("isAmbiguousPaidImageFailure");
    expect(videoScript).toContain("ambiguousPaidRequest: isAmbiguousPaidImageFailure(error)");
    expect(videoScript).toContain("resubmitAllowed: false");
    expect(videoScript).toContain("generationEndpointCalled: true");
    expect(videoScript).toContain("MYSTUDIO_IMAGE_PROBE_REFERENCE_PATH");
    expect(videoScript).toContain("真实生图探针参考图必须是独立 *_thumb.png");
    expect(videoScript).toContain("actualBytes >= 1_000_000");
    expect(videoScript).toContain("await sharp(referencePath, { failOn: 'error' }).metadata()");
    expect(videoScript).toContain("MYSTUDIO_IMAGE_PROBE_OUTPUT_PATH");
    expect(videoScript).toContain("MYSTUDIO_IMAGE_PROBE_REPORT_PATH");
    expect(videoScript).toContain("MYSTUDIO_IMAGE_PROBE_ASPECT_RATIO");
    expect(videoScript).toContain("拒绝覆盖已有真实生图探针结果");
    expect(videoScript).toContain("daojie-chapter001-generation-probe-report.json");
    expect(videoScript).toContain("createProbeTransferThumbnail(outputPath)");
    expect(videoScript).toContain("_thumb.png");
    expect(videoScript).toContain("payload.length >= 1_000_000");
    expect(videoScript).toContain("transferThumbnail");
    expect(videoScript).toContain("continuityPilotOnly");
    expect(videoScript).toContain("continuityFullChapterOnly");
    expect(videoScript).toContain("generate_chapter001_continuity_sample.py");
    expect(videoScript).toContain("MYSTUDIO_CONTINUITY_PILOT_SHOTS");
    expect(videoScript).toContain("MYSTUDIO_CONTINUITY_RESTART_FROM_SHOT");
    expect(videoScript).toContain("MYSTUDIO_CONTINUITY_CONFIRM_PAID_RETRY");
    expect(videoScript).toContain("--confirm-paid-retry");
    expect(videoScript).toContain("MYSTUDIO_CONTINUITY_WATERMARK_TEST_VARIANT");
    expect(videoScript).toContain("--watermark-test-variant");
    expect(videoScript).toContain("MYSTUDIO_CONTINUITY_PILOT_REJECT_SHOT");
    expect(videoScript).toContain("MYSTUDIO_CONTINUITY_PILOT_REJECTION_REASON");
    expect(videoScript).toContain("--reject-shot");
    expect(videoScript).toContain("不能同时设置");
    expect(videoScript).toContain("if (approveShot || rejectShot)");
    expect(videoScript).toContain("humanRejections");
    expect(videoScript).toContain("人工审核持久化证据无效");
    expect(videoScript).toContain("--full-chapter");
    expect(videoScript).toContain("payload.generatedImages !== payload.processedImages");
    expect(videoScript).toContain("payload.reusedImages !== 0");
    expect(videoScript).toContain("storyboardTransferThumbnails");
    expect(videoScript).toContain("statSync(thumbnailPath).size");
    expect(videoScript).toContain("sha256File(thumbnailPath)");
    expect(videoScript).toContain("await sharp(thumbnailPath).metadata()");
    expect(videoScript).toContain("Number(thumbnail?.bytes) === actualBytes");
    expect(videoScript).toContain("thumbnail.sha256 === actualSha256");
    expect(videoScript).toContain("/v1/models");
    expect(videoScript).toContain("opencut-api-config");
    expect(videoScript).toContain("freedom_image");
    expect(videoScript).toContain("MYSTUDIO_IMAGE_PROVIDER_CONFIGS_JSON");
    expect(videoScript).toContain("MYSTUDIO_IMAGE_ASYNC_MODE: '1'");
    expect(videoScript).toContain("MYSTUDIO_CONTINUITY_PILOT_DRY_RUN");
    expect(videoScript).toContain("pilotArgs.push('--dry-run')");
    expect(videoScript).toContain("generatedFrameImages");
    expect(videoScript).toContain("matchedAssetImages");
    expect(videoScript).toContain("storyboardMediaManifest");
    expect(videoScript).toContain("assetImageManifest");
    expect(videoScript).toContain("trackCandidateManifest");
    expect(videoScript).toContain("derivedAssetPlan");
    expect(videoScript).toContain("derivedAssetManifest");
    expect(videoScript).toContain("finalVideoEvidence");
    expect(videoScript).toContain("legacyCompatibilityVideo");
    expect(videoScript).toContain("legacyCompatibilityVideoEvidence");
    expect(videoScript).toContain("let failureReportWritten = false;");
    expect(videoScript).toContain("let failureStage = 'startup';");
    expect(videoScript).toContain("failureStage,");
    expect(videoScript).toContain("if (!failureReportWritten)");
    expect(videoScript).toContain("stage=${failureStage}: ${message}");
    expect(videoScript).toContain("failureStage = 'visual-continuity-preflight';");
    expect(videoScript).toContain("failureStage = 'final-media-checks';");
    expect(videoScript).toContain("timelineRenderRecord");
    expect(videoScript).toContain(
      "const finalVideo = timelineResult.timelineRenderRecord.evidence.path;",
    );
    expect(videoScript).toContain(
      "finalVideoEvidence: timelineResult.timelineRenderRecord.evidence",
    );
    expect(videoScript).not.toContain("const finalVideo = generated.final;");
    expect(timelineRunnerScript).toContain("studio-workflow-store.json");
    expect(timelineRunnerScript).toContain("mystudio-project-store.json");
    expect(timelineRunnerScript).toContain("buildChapterEditingProject");
    expect(timelineRunnerScript).toContain("renderChapterEditingProject");
    expect(timelineRunnerScript).toContain("createTimelineRenderRecord");
    expect(timelineRunnerScript).toContain("createTimelineRenderRuntime");
    expect(timelineRunnerScript).toContain("resolveProjectFileUrl");
    expect(timelineRunnerScript).toContain("resolveLocalMediaPath");
    expect(timelineRunnerScript).toContain("editingProjectPath");
    expect(timelineRunnerScript).toContain("autoEditingRunPath");
    expect(timelineRunnerScript).toContain("timelineRenderPlanPath");
    expect(timelineRunnerScript).toContain("progressHistoryPath");
    expect(timelineRunnerScript).toContain("timelineRenderRecordPath");
    expect(timelineRunnerScript).toContain('MYSTUDIO_DAOJIE_TIMELINE_RUNNER === "1"');
    expect(timelineRunnerConfig).toContain("defineConfig");
    expect(timelineRunnerConfig).toContain("path.resolve(appsRoot, \"frontend\")");
    expect(timelineRunnerConfig).not.toContain("vite-plugin-electron");
    expect(videoScript).toContain("分镜媒体明细缺失");
    expect(videoScript).toContain("资产图片明细缺失");
    expect(videoScript).toContain("生产轨候选明细缺失");
    expect(videoScript).toContain("衍生资产预划缺失");
    expect(videoScript).toContain("衍生资产落地明细缺失");
    expect(videoScript).toContain("衍生资产图片不存在");
    expect(videoScript).toContain("REQUIRED_WORKFLOW_STEPS");
    expect(videoScript).toContain("requireWorkflowSteps(generated)");
    expect(videoScript).toContain("工作流步骤未完成");
    expect(videoScript).toContain("分镜资产链接不完整");
    expect(videoScript).toContain("分镜未关联塑角/造景/道具资产");
    expect(videoScript).toContain("storyboardSourceSegments");
    expect(videoScript).toContain("storyboardSourceKind");
    expect(videoScript).toContain("storyboardSourceWorkId");
    expect(videoScript).toContain("storyboardSourceUpdatedAt");
    expect(videoScript).toContain("requireDynamicStoryboardSource(generated)");
    expect(videoScript).toContain("禁止 bootstrap source");
    expect(videoScript).toContain("requireStoryboardCountFollowsDirectorPlan(generated)");
    expect(videoScript).toContain("分镜数量必须按导演计划源片段生成");
    expect(videoScript).toContain("MAX_DAOJIE_VIDEO_DURATION_SECONDS = 180");
    expect(videoScript).toContain("最终视频时长超过3分钟规格");
    expect(videoScript).not.toContain("MIN_DAOJIE_STORYBOARDS");
    expect(videoScript).not.toContain("EXPECTED_DAOJIE_STORYBOARDS");
    expect(videoScript).not.toContain("第一章分镜数量必须精确为");
    expect(videoScript).not.toContain("道劫第一章分镜过少");
    expect(generatorScript).toContain("EPISODE_STORYBOARD_SPECS");
    expect(generatorScript).toContain("episode_storyboard_spec");
    expect(generatorScript).toContain("STORYBOARD_IMAGE_GENERATION_MODE");
    expect(generatorScript).toContain("build_structured_script_plan");
    expect(generatorScript).toContain("audit_director_plan");
    expect(generatorScript).toContain('"directorPlanChars"');
    expect(generatorScript).toContain('"directorPlanChineseChars"');
    expect(generatorScript).toContain('"directorPlanRequiredSectionsPresent"');
    expect(generatorScript).toContain('"directorPlanStructuredSceneIntentsComplete"');
    expect(generatorScript).toContain("generate_storyboard_frame_with_references");
    expect(generatorScript).toContain("create_storyboard_image_workflow_graph");
    expect(generatorScript).toContain("MYSTUDIO_IMAGE_API_BASE_URL");
    expect(generatorScript).toContain("MYSTUDIO_IMAGE_API_KEY");
    expect(generatorScript).toContain("MYSTUDIO_IMAGE_MODEL");
    expect(generatorScript).toContain('"storyboardImageGenerationMode": STORYBOARD_IMAGE_GENERATION_MODE');
    expect(generatorScript).toContain('"imageGenerationMode": STORYBOARD_IMAGE_GENERATION_MODE');
    expect(generatorScript).toContain('"imageGenerationProvider": storyboard_image_generation_provider()');
    expect(generatorScript).toContain('"storyboardImageWorkflowManifest": storyboard_image_workflow_manifest');
    expect(generatorScript).toContain('"storyboardPromptManifest": storyboard_prompt_manifest');
    expect(generatorScript).toContain("summarize_storyboard_prompt_manifest");
    expect(generatorScript).toContain("apply_reference_bindings_to_visual_prompt");
    expect(generatorScript).toContain("missingVisibleRoleReferences");
    expect(generatorScript).toContain("rawAssetNameLeaks");
    expect(generatorScript).toContain("referenceImages");
    expect(generatorScript).toContain('"image_urls"');
    expect(generatorScript).toContain("canonical_storyboard_shots");
    expect(generatorScript).toContain("latest_storyboard_work");
    expect(generatorScript).toContain("parse_storyboard_table");
    expect(generatorScript).toContain("resolve_storyboard_source");
    expect(generatorScript).toContain("resolve_canonical_speaker_id");
    expect(generatorScript).toContain("load_project_tts_state");
    expect(generatorScript).toContain("resolve_fixed_voice_bindings");
    expect(generatorScript).toContain("voice_binding_fingerprint");
    expect(generatorScript).not.toContain("EXPECTED_STORYBOARD_COUNT = 43");
    expect(generatorScript).toContain('"storyboardSourceKind": storyboard_source["kind"]');
    expect(generatorScript).toContain('"storyboardSourceWorkId": storyboard_source["workId"]');
    expect(generatorScript).toContain('"storyboardSourceSegments": source_segment_count');
    expect(generatorScript).toContain('"storyboardMediaManifest": storyboard_media_manifest');
    expect(generatorScript).toContain('"assetImageManifest": asset_image_manifest');
    expect(generatorScript).toContain('"trackCandidateManifest": track_candidate_manifest');
    expect(generatorScript).toContain('"derivedAssetPlan": DERIVED_ASSET_PLAN');
    expect(generatorScript).toContain('"derivedAssetManifest": derived_asset_sync["manifest"]');
    expect(generatorScript).toContain('"finalVideoEvidence": final_video_evidence');
    expect(generatorScript).toContain('voiceover["durationTarget"]');
    expect(generatorScript).not.toContain("MAX_SHOT_DURATION");
    expect(generatorScript).not.toContain("units.extend(split_long_line");
    expect(generatorScript).not.toContain("for part in split_long_line(desc)");
    expect(videoScript).toContain("framesWithRealAssetImages");
    expect(videoScript).toContain("assetImagePaths");
    expect(videoScript).toContain("存在未命中的图片资产");
    expect(videoScript).toContain("voiceReferenceAudioPath");
    expect(videoScript).toContain("未绑定资产库音色参考");
    expect(videoScript).toContain("speakerVoiceMap");
    expect(videoScript).toContain("voiceoverManifest");
    expect(videoScript).toContain("requiresFixedVoice");
    expect(videoScript).toContain("audioCount");
    expect(videoScript).toContain("voiceBindingFingerprint");
    expect(videoScript).toContain("compareUnicodeCodePoints");
    expect(videoScript).toContain("calculateVoiceBindingFingerprint");
    expect(videoScript).toContain("逐镜口播 storyboardId 非唯一");
    expect(videoScript).toContain("逐镜口播 index 必须连续为 1..N");
    expect(videoScript).toContain("逐镜固定音色与 speakerVoiceMap 不一致");
    expect(videoScript).toContain("固定音色 fingerprint 与 speakerVoiceMap 不一致");
    expect(videoScript).toContain("fixedVoiceBindings");
    expect(videoScript).toContain("aiSelectedVoiceBindings");
    expect(videoScript).toContain("speakerVoiceMap 未覆盖全部 canonical speakerId");
    expect(videoScript).not.toContain("MIN_DISTINCT_VOICE_REFERENCES");
    expect(videoScript).not.toContain("MIN_DAOJIE_SPOKEN_TEXT_CHARS");
    expect(videoScript).not.toContain("MAX_DAOJIE_SPOKEN_TEXT_CHARS");
    expect(videoScript).toContain("dialogueCoverageRatio");
    expect(videoScript).toContain("台词覆盖率过低");
    expect(videoScript).toContain("speakerAudioStats");
    expect(videoScript).toContain("角色音频统计缺失");
    expect(videoScript).toContain("ttsMode");
    expect(videoScript).toContain("ttsBackend");
    expect(videoScript).toContain("ttsMocked");
    expect(videoScript).toContain("voiceEmotionProfile");
    expect(videoScript).toContain("MANYING_REQUIRE_REAL_TTS: '1'");
    expect(videoScript).toContain("MYSTUDIO_DAOJIE_ALLOW_STORYBOARD_BOOTSTRAP: '0'");
    expect(videoScript).toContain("MYSTUDIO_ALLOW_TTS_FALLBACK");
    expect(videoScript).toContain("不能使用系统朗读 fallback 作为最终音频");
    expect(videoScript).toContain("silent-visual-preview");
    expect(videoScript).toContain("不能使用静音视觉预览作为最终音频");
    expect(videoScript).toContain("分镜真实资产图片不完整");
    expect(videoScript).toContain("视频没有使用任何真实资产图片");
    expect(videoScript).toContain("真实资产图片不存在");
    expect(videoScript).toContain("真实资产图片为空");
    expect(videoScript).toContain("frameSize");
    expect(videoScript).toContain("分镜画面尺寸错误");
    expect(videoScript).toContain("最终视频缺少 video stream");
    expect(videoScript).toContain("最终视频缺少 audio stream");
    expect(videoScript).toContain("audio duration");
    expect(videoScript).toContain("finalAudioMeanVolumeDb");
    expect(videoScript).toContain("最终视频音量过低");
    expect(videoScript).toContain("speakerAudioSamples");
    expect(videoScript).toContain("角色音频样本缺失");
    expect(generatorScript).toContain("MIN_SHOT_DURATION = 3.0");
    expect(generatorScript).toContain('"targetDurationSeconds": 180.0');
    expect(generatorScript).toContain("target_chapter_duration_seconds");
    expect(generatorScript).toContain("成片时长超过目标规格");
    expect(generatorScript).toContain("MYSTUDIO_DAOJIE_REUSE_AUDIO_DIR");
    expect(generatorScript).toContain("build_workflow_steps(");
    expect(generatorScript).toContain('"novel_import"');
    expect(generatorScript).toContain('"project_writeback"');
    expect(generatorScript).toContain('"赵四": ["赵四", "监工赵四"]');
    expect(generatorScript).toContain("attach_asset_alias_catalog_entries(by_name)");
    expect(generatorScript).toContain("reused-local-tts-audio");
    expect(generatorScript).toContain("复用音频缺失，改走真实 TTS");
    expect(generatorScript).toContain("reused.resolve() != path.resolve()");
    expect(generatorScript).not.toContain("raise RuntimeError(f\"复用音频不存在或为空");
    expect(generatorScript).toContain("alimiter=limit=0.98");
    expect(generatorScript).toContain("aresample=48000");
    expect(generatorScript).toContain('"-ac", "2"');
    expect(generatorScript).toContain("motion_filter_for");
    expect(generatorScript).toContain("crop=w=1920:h=1080");
    expect(generatorScript).not.toContain("zoompan");
    expect(generatorScript).toContain("silent-visual-preview");
    expect(generatorScript).toContain("spoken_text_for");
    expect(generatorScript).toContain("spoken_text_for(speaker, text)");
    expect(generatorScript).toContain("resolve_voice_profile_for_speaker");
    expect(generatorScript).toContain("ROLE_VOICE_PREFERENCES");
    expect(generatorScript).toContain("dialogueCoverageRatio");
    expect(generatorScript).toContain("speakerVoiceMap");
    expect(generatorScript).toContain("speakerAudioStats");
    expect(generatorScript).toContain("speakerAudioSamples");
    expect(generatorScript).toContain("finalAudioMeanVolumeDb");
    expect(generatorScript).toContain("compose_frame_image_assets");
    expect(generatorScript).toContain("create_direct_tts_audio");
    expect(generatorScript).toContain("synthesize_to_wav");
    expect(generatorScript).toContain("本地端口绑定被当前环境阻止");
  });

  it("rejects asset-composite as Toonflow-style storyboard image generation evidence", () => {
    const videoScript = readBuildFile("build/automate-daojie-chapter001-video.mjs");

    expect(videoScript).toContain("real-ai-reference-image-workflow");
    expect(videoScript).toContain("storyboardImageGenerationMode");
    expect(videoScript).toContain("asset-composite");
    expect(videoScript).toContain("不能作为 Toonflow 式分镜图生成验收");
    expect(videoScript).toContain("writeFailureReport");
    expect(videoScript).toContain("ok: false");
    expect(videoScript).toContain("生成器执行失败");
    expect(videoScript).toContain("writeFailureReport(null");
    expect(videoScript.indexOf("writeFailureReport")).toBeLessThan(
      videoScript.indexOf("不能作为 Toonflow 式分镜图生成验收"),
    );
    expect(videoScript).not.toContain("generated.imageGenerationMode !== 'asset-composite'");
    expect(videoScript).not.toContain("generated.imageGenerationProvider !== 'local-pillow-ffmpeg'");
  });

  it("validates V2 continuity asset candidates before loading paid provider credentials", () => {
    const videoScript = readBuildFile("build/automate-daojie-chapter001-video.mjs");

    expect(videoScript).toContain("chapter001_continuity_asset_candidate.py");
    expect(videoScript).toContain("readContinuityAssetCandidateManifest(dryRun)");
    expect(videoScript).toContain("...(dryRun ? ['--dry-run'] : [])");
    expect(videoScript).toContain("const providers = dryRun");
    expect(videoScript).toContain("credentialLoaded: Boolean(provider.baseUrl && provider.apiKeys?.length)");
    expect(videoScript).toContain("if (!dryRun) stopExistingMYStudioInstances()");
    expect(videoScript).toContain("requestBindingSha256: manifest.requestBindingSha256");
    expect(videoScript).toContain("referenceImageSha256: manifest.referenceImageSha256");
    expect(videoScript).not.toContain("assetKind !== 'prop'");
    expect(videoScript).not.toContain("daojie-gongbi-v2-prompt-audit-v3");
  });

  it("sends GPT storyboard reference images through the standard images endpoint", async () => {
    const requests: Array<{ url: string; authorization: string; body: Record<string, unknown>; rawBody: string }> = [];
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        let parsedBody: Record<string, unknown> = {};
        try {
          parsedBody = JSON.parse(body);
        } catch {
          parsedBody = { __rawBody: body.slice(0, 120) };
        }
        requests.push({
          url: request.url || "",
          authorization: request.headers.authorization || "",
          body: parsedBody,
          rawBody: body,
        });
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({
          data: [{ b64_json: Buffer.from("storyboard-image").toString("base64") }],
          output_format: "png",
        }));
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("mock server did not bind to a TCP port");
      const result = await runNodeHelper({
        providers: [{
          providerName: "mock-provider",
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          apiKey: "key-one",
          model: "gpt-image-2",
          aspectRatio: "16:9",
          resolution: "1K",
          timeoutSeconds: 5,
        }],
        prompt: "赤练蛇皮鞭撕开河雾",
        referenceImages: [
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        ],
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({
        url: `data:image/png;base64,${Buffer.from("storyboard-image").toString("base64")}`,
      });
      expect(requests).toHaveLength(1);
      expect(requests[0].url).toBe("/v1/images/generations");
      expect(requests[0].authorization).toBe("Bearer key-one");
      expect(requests[0].body).toMatchObject({
        model: "gpt-image-2",
        prompt: expect.stringContaining("赤练蛇皮鞭撕开河雾"),
        n: 1,
        size: "1280x720",
        image_urls: expect.arrayContaining([
          expect.stringMatching(/^data:image\/jpeg;base64,/),
        ]),
      });
      const imageUrls = requests[0].body.image_urls as string[];
      expect(imageUrls).toHaveLength(2);
      expect(imageUrls.every((value) => Buffer.from(value.split(",", 2)[1], "base64").length < 1_000_000)).toBe(true);
      expect(requests[0].body).not.toHaveProperty("aspect_ratio");
      expect(requests[0].body).not.toHaveProperty("resolution");
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    }
  }, 10_000);

  it("rejects damaged storyboard references before the Node helper makes a request", async () => {
    const result = await runNodeHelper({
      providers: [{
        providerName: "unreachable-provider",
        baseUrl: "http://127.0.0.1:9/v1",
        apiKey: "key-one",
        model: "gpt-image-2",
      }],
      prompt: "损坏参考图",
      referenceImages: ["data:image/png;base64,%%%"],
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("reference image decode failed before request");
    expect(result.stderr).not.toContain("fetch failed");
  });

  it("flushes large storyboard image data URLs before exiting the helper", async () => {
    const largeBase64 = "A".repeat(2_000_000);
    const server = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({
          data: [{ b64_json: largeBase64 }],
          output_format: "png",
        }));
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("mock server did not bind to a TCP port");
      const result = await runNodeHelper({
        providers: [{
          providerName: "mock-provider",
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          apiKey: "key-one",
          model: "gpt-image-2",
          aspectRatio: "16:9",
          resolution: "1K",
          timeoutSeconds: 5,
        }],
        prompt: "大图 stdout 完整性",
        referenceImages: [],
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      const parsed = JSON.parse(result.stdout);
      expect(parsed.url).toBe(`data:image/png;base64,${largeBase64}`);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    }
  }, 10_000);

  it("reports every provider key failure for storyboard image generation", async () => {
    const server = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        const authorization = request.headers.authorization || "";
        if (authorization === "Bearer key-one") {
          response.writeHead(403, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: { message: "quota exhausted" } }));
          return;
        }
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "image unsafe" } }));
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("mock server did not bind to a TCP port");
      const result = await runNodeHelper({
        providers: [{
          providerName: "mock-provider",
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          apiKeys: ["key-one", "key-two"],
          model: "gpt-image-2",
          aspectRatio: "16:9",
          resolution: "1K",
          timeoutSeconds: 5,
        }],
        prompt: "失败摘要",
        referenceImages: ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="],
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Failed after 1 provider(s), 2 API key(s)");
      expect(result.stderr).toContain("mock-provider key 1: Image generation failed: 403");
      expect(result.stderr).toContain("quota exhausted");
      expect(result.stderr).toContain("mock-provider key 2: Image generation failed: 400");
      expect(result.stderr).toContain("image unsafe");
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    }
  }, 10_000);

  it("reports the transport cause when a storyboard image provider disconnects", async () => {
    let requestCount = 0;
    const server = createServer((request) => {
      requestCount += 1;
      request.resume();
      request.on("end", () => request.socket.destroy());
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("mock server did not bind to a TCP port");
      const result = await runNodeHelper({
        providers: [{
          providerName: "disconnecting-provider",
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          apiKeys: ["key-one", "key-two"],
          model: "gpt-image-2",
          timeoutSeconds: 5,
        }],
        prompt: "连接断开诊断",
        referenceImages: [],
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("fetch failed");
      expect(result.stderr).toContain("cause=");
      expect(result.stderr).toContain("automatic provider/key fallback stopped");
      expect(requestCount).toBe(1);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    }
  }, 10_000);

  it("uses explicit async image transport and polls the documented nested result", async () => {
    const requests: Array<{ method: string; url: string }> = [];
    const server = createServer((request, response) => {
      requests.push({ method: request.method || "", url: request.url || "" });
      request.resume();
      request.on("end", () => {
        response.writeHead(200, { "Content-Type": "application/json" });
        if (request.method === "POST") {
          response.end(JSON.stringify({ task_id: "img-task-1", status: "running" }));
          return;
        }
        response.end(JSON.stringify({
          task_id: "img-task-1",
          status: "success",
          result: { data: [{ url: "https://example.invalid/generated.png" }] },
        }));
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("mock server did not bind to a TCP port");
      const result = await runNodeHelper({
        providers: [{
          providerName: "async-provider",
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          apiKey: "key-one",
          model: "gpt-image-2",
          timeoutSeconds: 8,
          asyncMode: true,
        }],
        prompt: "异步生图",
        referenceImages: [],
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toEqual({ url: "https://example.invalid/generated.png" });
      expect(requests).toEqual([
        { method: "POST", url: "/v1/images/generations/async" },
        { method: "GET", url: "/v1/images/tasks/img-task-1" },
      ]);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    }
  }, 10_000);

  it("rejects a multi-provider or multi-key paid probe before any request", async () => {
    let requestCount = 0;
    const server = createServer((request, response) => {
      requestCount += 1;
      request.resume();
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "must not be called" }));
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("mock server did not bind to a TCP port");
      const result = await runNodeHelper({
        singleAttempt: true,
        providers: [{
          providerName: "unsafe-paid-probe",
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          apiKeys: ["key-one", "key-two"],
          model: "gpt-image-2",
        }],
        prompt: "付费生图探针必须单次提交",
        referenceImages: [],
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("requires exactly one provider and one API key before request");
      expect(requestCount).toBe(0);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    }
  }, 10_000);

  it("records a paid request fingerprint and blocks the same request across output directories", async () => {
    let postCount = 0;
    const server = createServer((request, response) => {
      if (request.method === "POST") postCount += 1;
      request.resume();
      request.on("end", () => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ url: "https://example.invalid/paid.png" }));
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const ledgerPath = resolve(mkdtempSync(resolve(tmpdir(), "mystudio-paid-ledger-")), "requests.jsonl");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("mock server did not bind to a TCP port");
      const payload = {
        singleAttempt: true,
        paidRequestLedgerPath: ledgerPath,
        paidAuthorization: true,
        logicalJob: "test-paid-job",
        logicalShot: "sb-test-001",
        providers: [{
          providerName: "ledger-provider",
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          apiKey: "key-one",
          model: "gpt-image-2",
          asyncMode: true,
          timeoutSeconds: 5,
        }],
        attemptId: "attempt-1",
        prompt: "账本去重",
        referenceImages: [],
      };
      const first = await runNodeHelper(payload);
      expect(first.status).toBe(0);
      expect(JSON.parse(first.stdout)).toMatchObject({
        url: "https://example.invalid/paid.png",
        request: { asyncMode: true, taskId: null },
      });
      expect(postCount).toBe(1);
      const ledger = readFileSync(ledgerPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
      expect(ledger.map((event) => event.status)).toEqual(["POST_SENT", "COMPLETED"]);
      expect(ledger[1]).toMatchObject({
        logicalJob: "test-paid-job",
        logicalShot: "sb-test-001",
        endpoint: `http://127.0.0.1:${address.port}/v1/images/generations/async`,
        taskId: null,
      });
      const second = await runNodeHelper({ ...payload, attemptId: "attempt-2" });
      expect(second.status).toBe(1);
      expect(second.stderr).toContain("fingerprint already has COMPLETED evidence");
      expect(postCount).toBe(1);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    }
  }, 10_000);

  it("requires explicit paid authorization before the ledger can reach a provider", async () => {
    let requestCount = 0;
    const server = createServer((request, response) => {
      requestCount += 1;
      request.resume();
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "must not be called" }));
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const ledgerPath = resolve(mkdtempSync(resolve(tmpdir(), "mystudio-paid-auth-")), "requests.jsonl");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("mock server did not bind to a TCP port");
      const result = await runNodeHelper({
        singleAttempt: true,
        paidRequestLedgerPath: ledgerPath,
        paidAuthorization: false,
        logicalJob: "test-paid-job",
        logicalShot: "sb-test-002",
        attemptId: "attempt-auth-1",
        providers: [{
          providerName: "ledger-provider",
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          apiKey: "key-one",
          model: "gpt-image-2",
        }],
        prompt: "授权门",
        referenceImages: [],
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("explicit authorization");
      expect(requestCount).toBe(0);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    }
  }, 10_000);

  it("stops provider fallback after an async image task is accepted", async () => {
    const requests: Array<{ authorization: string; method: string; url: string }> = [];
    const server = createServer((request, response) => {
      requests.push({
        authorization: request.headers.authorization || "",
        method: request.method || "",
        url: request.url || "",
      });
      request.resume();
      request.on("end", () => {
        response.writeHead(200, { "Content-Type": "application/json" });
        if (request.method === "POST") {
          response.end(JSON.stringify({ task_id: "accepted-paid-task", status: "running" }));
          return;
        }
        response.end(JSON.stringify({ task_id: "accepted-paid-task", status: "running" }));
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("mock server did not bind to a TCP port");
      const result = await runNodeHelper({
        providers: [{
          providerName: "async-provider",
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          apiKeys: ["key-one", "key-two"],
          model: "gpt-image-2",
          timeoutSeconds: 1,
          asyncMode: true,
        }],
        prompt: "异步任务受理后禁止二次扣费请求",
        referenceImages: [],
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("automatic provider/key fallback stopped");
      expect(requests.filter((request) => request.method === "POST")).toEqual([
        {
          authorization: "Bearer key-one",
          method: "POST",
          url: "/v1/images/generations/async",
        },
      ]);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    }
  }, 10_000);

  it("keeps Daojie real storyboard image requests provider-compatible", () => {
    const helperScript = readBuildFile("build/generate-storyboard-image.mjs");
    const generatorScript = readFileSync(
      resolve(appsRoot, "..", "Library", "build_daojie_chapter001_workflow.py"),
      "utf8",
    );

    expect(helperScript).toContain("imageGenerationEndpoint");
    expect(helperScript).toContain("/v1/images/generations");
    expect(helperScript).toContain("image_urls");
    expect(helperScript).toContain("b64_json");
    expect(generatorScript).toContain("generate_storyboard_image_via_node_helper");
    expect(generatorScript).toContain("generate-storyboard-image.mjs");

    const result = runPythonSnippet(`
import importlib.util
import tempfile
from pathlib import Path
from PIL import Image

spec = importlib.util.spec_from_file_location("dao", "Library/build_daojie_chapter001_workflow.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory() as tmp:
    image_path = Path(tmp) / "large-ref.png"
    Image.new("RGB", (1600, 1200), (120, 80, 40)).save(image_path)
    original = module.image_source_to_data_url(str(image_path))
    prepared = module.prepare_storyboard_model_reference_image(str(image_path))
    body = module.build_storyboard_image_request_body("水墨分镜", [prepared], {
        "model": "gpt-image-2",
        "aspectRatio": "16:9",
        "resolution": "1K",
    })
    print(len(prepared) < len(original), body.get("size"), "aspect_ratio" in body, "resolution" in body, "image_urls" in body)
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("True 1280x720 False False True");
  });

  it("enforces the Python storyboard thumbnail byte gate for local and data URI images", () => {
    const result = runPythonSnippet(`
import base64
import importlib.util
import json
import tempfile
from pathlib import Path
import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location("dao", "Library/build_daojie_chapter001_workflow.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory() as tmp:
    source = Path(tmp) / "high-entropy.png"
    pixels = np.random.default_rng(20260715).integers(0, 256, size=(1400, 1800, 4), dtype=np.uint8)
    Image.fromarray(pixels).save(source)
    source_uri = module.image_source_to_data_url(str(source))
    prepared_local = module.prepare_storyboard_model_reference_image(str(source))
    prepared_uri = module.prepare_storyboard_model_reference_image(source_uri)
    local_bytes = len(base64.b64decode(prepared_local.split(",", 1)[1]))
    uri_bytes = len(base64.b64decode(prepared_uri.split(",", 1)[1]))
    thumb = module.create_storyboard_transfer_thumbnail(source)
    malformed = "not-rejected"
    try:
        module.prepare_storyboard_model_reference_image("data:image/png;base64,%%%")
    except RuntimeError as error:
        malformed = str(error)
    boundary = []
    for size in (999_999, 1_000_000):
        try:
            module.assert_image_transfer_size(b"x" * size)
            boundary.append("accepted")
        except RuntimeError:
            boundary.append("rejected")
    print(json.dumps({
        "localBytes": local_bytes,
        "uriBytes": uri_bytes,
        "thumb": thumb,
        "malformed": malformed,
        "boundary": boundary,
        "remote": module.prepare_storyboard_model_reference_image("https://cdn.example.com/ref.png"),
    }))
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const evidence = JSON.parse(result.stdout);
    expect(evidence.localBytes).toBeLessThan(1_000_000);
    expect(evidence.uriBytes).toBeLessThan(1_000_000);
    expect(evidence.thumb.path).toMatch(/_thumb\.png$/);
    expect(evidence.thumb.width).toBeLessThanOrEqual(768);
    expect(evidence.thumb.height).toBeLessThanOrEqual(768);
    expect(evidence.thumb.bytes).toBeLessThan(1_000_000);
    expect(evidence.thumb.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.malformed).toContain("data URI 格式无效");
    expect(evidence.boundary).toEqual(["accepted", "rejected"]);
    expect(evidence.remote).toBe("https://cdn.example.com/ref.png");
  }, 20_000);

  it("routes Agnes image models through the OpenAI-compatible size contract", () => {
    const result = runPythonSnippet(`
import importlib.util

spec = importlib.util.spec_from_file_location("dao", "Library/build_daojie_chapter001_workflow.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

module.generate_storyboard_image_via_node_helper = lambda prompt, refs, config: "node-helper-result"
config = {
    "baseUrl": "https://fuhuaedu.com",
    "apiKey": "redacted",
    "apiKeys": ["redacted"],
    "model": "agnes-image-2.1-flash",
    "providerName": "fuhua-agnes-temp",
    "aspectRatio": "16:9",
    "resolution": "1K",
    "timeoutSeconds": 30,
}
print(
    module.is_gpt_image_model(config["model"]),
    module.gpt_image_size(config["aspectRatio"], config["resolution"]),
    module.request_storyboard_image_generation("prompt", ["data:image/png;base64,cmVm"], config),
)
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("True 1280x720 node-helper-result");
  });

  it("injects Daojie ink-guofeng style and reference labels into real storyboard image prompts", () => {
    const result = runPythonSnippet(`
import importlib.util

spec = importlib.util.spec_from_file_location("dao", "Library/build_daojie_chapter001_workflow.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

prompt = module.build_storyboard_image_prompt(
    {"id": "sb-1", "index": 1, "sceneNo": 1, "prompt": "独孤剑尘在金水河码头抬手，赤练蛇皮鞭撕开河雾。"},
    [
        {"title": "金水河码头", "assetType": "scene", "aliases": ["金水河码头"]},
        {"title": "独孤剑尘", "assetType": "character", "aliases": ["独孤剑尘", "独孤"]},
        {"title": "赤练蛇皮鞭", "assetType": "prop", "aliases": ["赤练蛇皮鞭", "鞭梢"]},
    ],
)
visual = module.extract_prompt_section(prompt, "画面")
audit = module.build_storyboard_prompt_audit(
    {"id": "sb-1", "index": 1},
    prompt,
    [
        {"title": "金水河码头", "assetType": "scene", "aliases": ["金水河码头"]},
        {"title": "独孤剑尘", "assetType": "character", "aliases": ["独孤剑尘", "独孤"]},
        {"title": "赤练蛇皮鞭", "assetType": "prop", "aliases": ["赤练蛇皮鞭", "鞭梢"]},
    ],
    "独孤剑尘在金水河码头抬手，赤练蛇皮鞭撕开河雾。",
)

checks = [
    "daojie-gongbi-v2" in prompt,
    "连续白描和铁线描" in prompt,
    "薄层矿物色分染与罩染" in prompt,
    "30%-70%" in prompt,
    "均匀平光宣纸照明" in prompt,
    "衣物完整可穿" in prompt,
    "无统一脏污滤镜" in prompt,
    "禁止写实摄影" in prompt,
    "3D/CGI" in prompt,
    "文字、水印、签名、logo" in prompt,
    "@图1 为金水河码头场景" in prompt,
    "@图2 为独孤剑尘角色" in prompt,
    "@图3 为赤练蛇皮鞭道具" in prompt,
    "角色一致性" in prompt,
    "场景一致性" in prompt,
    "道具一致性" in prompt,
    "只允许镜头、动作、表情按当前分镜变化" in prompt,
    "只变化当前分镜需要的景别、动作、表情" in prompt,
    "【参考继承边界】" in prompt,
    "V2媒介、综合色彩、完整衣物、当前分镜动作与构图优先" in prompt,
    "【光影】" in prompt,
    "@图2在@图1抬手，@图3撕开河雾" in visual,
    "独孤剑尘" not in visual,
    "金水河码头" not in visual,
    "赤练蛇皮鞭" not in visual,
    audit["hasReferencePrefix"],
    audit["hasVisualReferenceBinding"],
    audit["hasLightSection"],
    audit["hasDaojieStyleLock"],
    audit["hasReferenceRules"],
    audit["hasNegativeConstraints"],
    audit["missingVisibleRoleReferences"] == [],
    audit["rawAssetNameLeaks"] == [],
    audit["v2"]["status"] == "pass",
]
print(all(checks), prompt.count("@图") >= 8)
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("True True");
  });

  it("keeps Python and product continuity manifests, prompts, and fingerprints in parity", () => {
    const result = runPythonSnippet(`
import importlib.util
import json

spec = importlib.util.spec_from_file_location("dao", "Library/build_daojie_chapter001_workflow.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

anchors = {
    "faceShape": "清瘦长脸",
    "jawline": "锐利下颌线",
    "uniqueMarks": ["银白长发与右肩破损灰袍组合锚点"],
    "hairStyle": "及腰银白长发，半束高髻",
}
scene = {
    "name": "金水河码头", "kind": "场景", "assetId": "scene-dock", "imagePath": "/dock.png",
    "spatialLayout": "左岸湿木栈道通向右侧泊船区", "lightingDesign": "冷青晨雾漫射光",
    "colorPalette": "墨青、灰蓝、湿木浅褐", "keyProps": ["藤筐", "系船木桩"],
    "viewpoints": [{"id": "dock-main-axis", "imageUrl": "/dock.png"}],
}
dugu = {
    "name": "独孤剑尘", "kind": "角色", "assetId": "char-dugu", "imagePath": "/dugu.png",
    "identityAnchors": anchors, "negativePrompt": {"avoid": ["黑发", "圆脸"]},
    "views": [
        {"viewType": "front", "imageUrl": "/dugu-front.png"},
        {"viewType": "side", "imageUrl": "/dugu-side.png"},
        {"viewType": "back", "imageUrl": "/dugu-back.png"},
    ],
}
prop = {"name": "油布剑包", "kind": "道具", "assetId": "prop-sword-wrap", "imagePath": "/wrap.png"}
assets = [scene, dugu, prop]
manifest, versions = module.build_ordered_continuity_manifest(assets, "dock-main-axis")
semantics = {
    "sceneViewpointId": "dock-main-axis",
    "personFree": False,
    "visibleCharacters": [{
        "name": "独孤剑尘", "position": "左中格", "orientation": "背部三分之四朝右",
        "actionIn": "从河雾外沿沿湿木栈道入画", "actionOut": "停在左中格，右脚落地",
    }],
    "visibleProps": [{"name": "油布剑包", "position": "左后景", "state": "背负且未露剑"}],
    "actionIn": "独孤剑尘从河雾外沿进入湿木栈道",
    "actionOut": "独孤剑尘停在左中格，继续朝右",
}
group = {"groupId": "chapter-001:source:006-006", "start": 6, "end": 6, "sceneName": "金水河码头", "viewpointId": "dock-main-axis"}
state = module.build_storyboard_semantic_continuity_state(6, "独孤剑尘从河雾边走来。", assets, manifest, semantics, group)
refs = module.collect_storyboard_reference_images(module.apply_continuity_manifest_to_image_assets(assets, manifest))
final_prompt = module.build_storyboard_image_prompt({
    "id": "sb-chapter-001-006", "index": 6, "sceneNo": 1,
    "prompt": "独孤剑尘从河雾边走来。", "continuityState": state,
}, refs)
print(json.dumps({
    "manifest": manifest,
    "versionsApproved": [item["approved"] for item in versions],
    "versionsStructurallyComplete": [item["structurallyComplete"] for item in versions],
    "referenceOrder": [f"{item['assetId']}:{item.get('characterViewType') or item.get('sceneViewpointId') or 'base'}" for item in refs],
    "state": state,
    "finalPrompt": final_prompt,
}, ensure_ascii=False))
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const payload = JSON.parse(result.stdout.trim());
    expect(payload.manifest.map((item: { assetId: string }) => item.assetId)).toEqual([
      "scene-dock",
      "char-dugu",
      "prop-sword-wrap",
    ]);
    expect(payload.versionsStructurallyComplete).toEqual([true, true, true]);
    expect(payload.versionsApproved).toEqual([false, false, false]);
    expect(payload.manifest[1].referenceImagePaths).toEqual([
      "/dugu-front.png",
      "/dugu-side.png",
      "/dugu-back.png",
    ]);
    expect(payload.manifest[1].referenceViewTypes).toEqual(["front", "side", "back"]);
    expect(payload.referenceOrder).toEqual([
      "scene-dock:dock-main-axis",
      "char-dugu:front",
      "char-dugu:side",
      "char-dugu:back",
      "prop-sword-wrap:base",
    ]);
    expect(payload.finalPrompt).toContain("【资产圣经】");
    expect(payload.finalPrompt).toContain("【连续镜头组】chapter-001:source:006-006");
    expect(payload.finalPrompt).toContain("银白长发与右肩破损灰袍组合锚点");
    expect(payload.finalPrompt).toContain("左岸湿木栈道通向右侧泊船区");
    expect(payload.finalPrompt).toContain("【多视图身份锁】");
    expect(payload.finalPrompt).toContain("@图2/@图3/@图4 为独孤剑尘同一角色、同一版本的 front/side/back 参考视图");
    expect(payload.finalPrompt).toContain("不是三个人");
    expect(payload.finalPrompt).toContain("【出镜人数锁】本镜出镜角色总数：1");
    expect(payload.finalPrompt).toContain("禁止重复、克隆或因多视图参考新增人物");
    expect(payload.finalPrompt).toContain("前景、中景、远景和背景合计只能出现上述 1 个角色实例");
    expect(payload.finalPrompt).toContain("不得出现路人、工人、剪影、倒影或模糊人影");
    expect(visualContinuityFingerprint({
      prompt: "独孤剑尘从河雾边走来。",
      orderedReferenceManifest: payload.manifest,
      continuityState: payload.state,
    })).toBe(payload.state.inputFingerprint);
  });

  it("prepares pilot continuity bibles with dry-run, backups, and a sha256 manifest", () => {
    const result = runPythonSnippet(`
import importlib.util
import json
import tempfile
from pathlib import Path
from PIL import Image

spec = importlib.util.spec_from_file_location("prepare_bibles", "Library/ai/prepare_chapter001_continuity_bibles.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    project = root / "project"
    project.mkdir()
    boards = {}
    for name in ("dugu", "zhao", "helper"):
        path = root / f"{name}.png"
        Image.new("RGB", (1200, 800), (220, 215, 205)).save(path)
        boards[name] = path
    scene_ref = root / "dock.png"
    Image.new("RGB", (1200, 800), (70, 90, 105)).save(scene_ref)
    prop_names = ["油布剑包", "赤练蛇皮鞭", "灵矿藤筐", "灵矿", "残卷"]
    prop_items = []
    for index, name in enumerate(prop_names, 1):
        path = root / f"prop-{index}.png"
        Image.new("RGB", (900, 900), (80 + index, 90, 100)).save(path)
        prop_items.append({"id": f"prop-{index}", "name": name, "imageUrl": str(path)})
    ore_override = root / "spirit-ore-v5.png"
    Image.new("RGB", (900, 900), (40, 120, 150)).save(ore_override)
    characters = {
        "version": 1,
        "state": {
            "characters": [
                {"id": "dugu", "name": "独孤剑尘", "thumbnailUrl": str(boards["dugu"]), "views": [], "variations": []},
                {"id": "zhao", "name": "监工赵四", "thumbnailUrl": str(boards["zhao"]), "views": [], "variations": []},
                {"id": "helper", "name": "小杂役", "thumbnailUrl": str(boards["helper"]), "views": [], "variations": []},
            ],
            "folders": [],
        },
    }
    scenes = {
        "version": 1,
        "state": {"scenes": [{"id": "dock", "name": "金水河码头", "referenceImage": str(scene_ref)}], "folders": []},
    }
    props = {"version": 1, "state": {"items": prop_items, "folders": []}}
    (project / "characters.json").write_text(json.dumps(characters, ensure_ascii=False), encoding="utf-8")
    (project / "scenes.json").write_text(json.dumps(scenes, ensure_ascii=False), encoding="utf-8")
    (project / "props.json").write_text(json.dumps(props, ensure_ascii=False), encoding="utf-8")
    dry_run = module.prepare_bibles(
        project, boards["dugu"], boards["zhao"], boards["helper"], scene_ref, apply=False
    )
    v5_dry_run = module.prepare_bibles(
        project,
        boards["dugu"],
        boards["zhao"],
        boards["helper"],
        scene_ref,
        apply=False,
        bible_version="v5",
        prop_source_overrides={"灵矿": ore_override},
    )
    unchanged = json.loads((project / "characters.json").read_text(encoding="utf-8"))
    applied = module.prepare_bibles(
        project, boards["dugu"], boards["zhao"], boards["helper"], scene_ref, apply=True
    )
    next_characters = json.loads((project / "characters.json").read_text(encoding="utf-8"))["state"]["characters"]
    next_scene = json.loads((project / "scenes.json").read_text(encoding="utf-8"))["state"]["scenes"][0]
    next_props = json.loads((project / "props.json").read_text(encoding="utf-8"))["state"]["items"]
    overwrite_error = "missing"
    try:
        module.prepare_bibles(
            project, boards["dugu"], boards["zhao"], boards["helper"], scene_ref, apply=True
        )
    except RuntimeError as error:
        overwrite_error = str(error)
    print(json.dumps({
        "dryRun": dry_run["dryRun"],
        "bibleVersion": applied["bibleVersion"],
        "v5BibleVersion": v5_dry_run["bibleVersion"],
        "v5OreSource": v5_dry_run["propPlan"]["灵矿"]["source"],
        "v5OreOutput": v5_dry_run["propPlan"]["灵矿"]["outputPath"],
        "unchanged": all(not item.get("views") for item in unchanged["state"]["characters"]),
        "viewCounts": [len(item["views"]) for item in next_characters],
        "duguMarks": next_characters[0]["identityAnchors"]["uniqueMarks"],
        "helperAvoid": next_characters[2]["negativePrompt"]["avoid"],
        "sceneViewpoint": next_scene["viewpoints"][0]["id"],
        "propPathsV5": all("/v5/props/" in item["imageUrl"] for item in next_props),
        "backupCount": len(applied["backups"]),
        "pendingSummary": applied["approvalSummary"],
        "allUnapproved": all(item["approved"] is False and item["approval"] is None for item in applied["continuityAssetVersions"]),
        "thumbnailCount": len(applied["reviewThumbnails"]),
        "thumbnailsSafe": all(item["bytes"] < 1000000 and item["width"] <= 768 and item["height"] <= 768 for item in applied["reviewThumbnails"]),
        "overwriteBlocked": "拒绝覆盖已有 v4 Bible 目录" in overwrite_error,
        "manifestExists": Path(applied["manifestPath"]).exists(),
        "manifestSha256": len(applied["manifestSha256"]),
    }, ensure_ascii=False))
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout.trim())).toEqual({
      dryRun: true,
      bibleVersion: "v5",
      v5BibleVersion: "v5",
      v5OreSource: expect.stringContaining("spirit-ore-v5.png"),
      v5OreOutput: expect.stringContaining("/v5/props/spirit-ore/reference.png"),
      unchanged: true,
      viewCounts: [3, 3, 3],
      duguMarks: ["银白长发半束高髻", "右肩加固缝线的完整灰袍", "背负三层油布剑包"],
      helperAvoid: ["成年男子", "成年女性脸", "壮硕体型", "及踝长袍", "裙装", "华贵锦袍", "束冠高髻", "鞋靴", "现代服饰"],
      sceneViewpoint: "dock-main-axis",
      propPathsV5: true,
      backupCount: 3,
      pendingSummary: { approved: 0, pending: 9, rejected: 0 },
      allUnapproved: true,
      thumbnailCount: 15,
      thumbnailsSafe: true,
      overwriteBlocked: false,
      manifestExists: true,
      manifestSha256: 64,
    });
  });

  it("keeps repaired workflow-node versions and viewpoints in product continuity parity", () => {
    const result = runPythonSnippet(`
import importlib.util
import json
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("repair", "Library/repair_chapter001_visual_continuity.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory() as tmp:
    image_path = Path(tmp) / "dock.png"
    image_path.write_bytes(b"reference")
    state = {
        "agentWorkData": [{
            "id": "source-001", "key": "storyboardTable", "episodeId": "chapter-001", "updatedAt": 1,
            "data": """<storyboardTable>
## 场1：金水河码头
**引用资产名称**：[金水河码头]
**引用资产ID**：[scene-dock]
| 序号 | 画面描述 | 时长 | 景别 | 运镜 | 台词 | 音效 | 出镜语义JSON |
|---|---|---|---|---|---|---|---|
| 1 | 空镜建立码头。 | 3 | 远景 | 静止 | 旁白：河雾压低。 | 水声 | {\"sceneViewpointId\":\"dock-main-axis\",\"personFree\":true,\"visibleCharacters\":[],\"visibleProps\":[],\"actionIn\":\"河雾压低。\",\"actionOut\":\"木桩停在前景。\"} |
</storyboardTable>""",
        }],
        "storyboards": [{
            "id": "sb-chapter-001-001",
            "episodeId": "chapter-001",
            "index": 1,
            "trackKey": "scene-1",
            "duration": 3,
            "prompt": "独孤剑尘从金水河码头走来。",
            "videoDesc": "码头远景",
            "assetIds": ["scene-dock"],
            "shouldGenerateImage": True,
            "lines": [],
            "speakerId": "narrator",
            "mediaRef": {"path": "project-file://project/shot-001.png"},
        }],
        "imageWorkflows": [{
            "target": {"kind": "storyboard", "id": "sb-chapter-001-001"},
            "nodes": [{
                "id": "ref-1",
                "type": "reference",
                "title": "金水河码头",
                "imageUrl": str(image_path),
                "continuityVersionId": "scene-dock:dock-main-axis:v1",
                "sceneViewpointId": "dock-main-axis",
                "continuityOrder": 1,
                "source": {"kind": "asset", "assetType": "scene", "id": "scene-dock"},
            }],
        }],
    }
    report = module.repair_storyboards(state, "pending", None)
    print(json.dumps({"report": report, "storyboard": state["storyboards"][0]}, ensure_ascii=False))
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const payload = JSON.parse(result.stdout.trim());
    expect(payload.report).toMatchObject({
      storyboards: 1,
      repaired: 1,
      missingWorkflows: [],
      missingReferences: [],
      unapprovedReferences: [{
        storyboardId: "sb-chapter-001-001",
        references: ["scene-dock"],
      }],
      sceneGroupMismatches: [],
      reviewStatus: "pending",
    });
    expect(payload.storyboard.orderedReferenceManifest[0]).toMatchObject({
      versionId: "scene-dock:dock-main-axis:v1",
      sceneViewpointId: "dock-main-axis",
      approved: false,
    });
    expect(payload.storyboard.continuityState.groupId).toBe("chapter-001:source:001-001");
    expect(visualContinuityFingerprint(payload.storyboard)).toBe(
      payload.storyboard.continuityState.inputFingerprint,
    );
    const audit = auditVisualContinuity([payload.storyboard]);
    expect(audit).toMatchObject({ pending: 1, approved: 0, rejected: 0, stale: 1 });
    expect(audit.issues.map((issue) => issue.code)).toEqual(["continuity.stale", "review.missing"]);
  });

  it("forbids structural repair from writing automated visual approval", () => {
    const result = runPythonSnippet(`
import importlib.util

spec = importlib.util.spec_from_file_location("repair", "Library/repair_chapter001_visual_continuity.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

try:
    module.repair_storyboards({"storyboards": [], "imageWorkflows": []}, "approved", None)
    print("no-error")
except RuntimeError as error:
    print(str(error))
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("禁止自动批准");
  });

  it("repairs shots 23-24 to one inn-room primary scene and keeps exterior scenes secondary", () => {
    const result = runPythonSnippet(`
import importlib.util
import json
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("repair", "Library/repair_chapter001_visual_continuity.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory() as temp:
    project = Path(temp)
    room = project / "room.png"
    inn = project / "inn.png"
    school = project / "school.png"
    for path in (room, inn, school):
        path.write_bytes(path.stem.encode("utf-8"))
    (project / "scenes.json").write_text(json.dumps({"state": {"scenes": [{
        "id": "scene-room", "name": "悦来客栈斗室", "referenceImage": str(room)
    }]}}), encoding="utf-8")
    semantics = json.dumps({
        "sceneViewpointId": "inn-room-window-axis",
        "personFree": True,
        "visibleCharacters": [],
        "visibleProps": [],
        "actionIn": "斗室窗边保持静止。",
        "actionOut": "窗外塾馆屋脊停在远景。",
    }, ensure_ascii=False, separators=(",", ":"))
    prefix_rows = []
    for index in range(1, 23):
        prefix_semantics = json.dumps({
            "sceneViewpointId": f"prefix-viewpoint-{index}",
            "personFree": True,
            "visibleCharacters": [],
            "visibleProps": [],
            "actionIn": f"前置镜头 {index} 静止。",
            "actionOut": f"前置镜头 {index} 结束。",
        }, ensure_ascii=False, separators=(",", ":"))
        prefix_rows.append(
            f"| {index} | 前置镜头 | 前置场景{index} | — | 3 | 中景 | 静止 | 静止 | — | — | 克制 | 旁白：前置镜头。 | 风声 | — | {prefix_semantics} |"
        )
    source_rows = prefix_rows + [
        f"| {index} | 透过斗室窗看塾馆 | 悦来客栈斗室 | [金水塾馆] | 3 | 中景 | 静止 | 静止 | — | — | 克制 | 旁白：窗外屋脊。 | 风声 | [scene-school] | {semantics} |"
        for index in (23, 24)
    ]
    state = {
        "storyboards": [],
        "imageWorkflows": [],
        "agentWorkData": [{
            "id": "source-023-024", "key": "storyboardTable", "episodeId": "chapter-001", "updatedAt": 1,
            "data": "<storyboardTable>\\n| 序号 | 画面描述 | 场景 | 关联资产名称 | 时长 | 景别 | 运镜 | 角色动作 | 朝向 | 空间关系 | 情绪 | 台词 | 音效 | 关联资产ID | 出镜语义JSON |\\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\\n" + "\\n".join(source_rows) + "\\n</storyboardTable>",
        }],
    }
    for index in (23, 24):
        storyboard_id = f"sb-chapter-001-{index:03d}"
        state["storyboards"].append({
            "id": storyboard_id, "episodeId": "chapter-001", "index": index,
            "prompt": "透过斗室窗看塾馆", "mediaRef": {"path": f"/shot-{index}.png"},
        })
        state["imageWorkflows"].append({
            "target": {"kind": "storyboard", "id": storyboard_id},
            "nodes": [
                {"type": "reference", "title": "悦来客栈", "imageUrl": str(inn), "source": {"assetType": "scene", "id": "scene-inn"}},
                {"type": "reference", "title": "金水塾馆", "imageUrl": str(school), "source": {"assetType": "scene", "id": "scene-school"}},
            ],
        })
    report = module.repair_storyboards(state, "pending", None, project)
    print(json.dumps({"report": report, "storyboards": state["storyboards"]}, ensure_ascii=False))
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const payload = JSON.parse(result.stdout.trim());
    expect(payload.report.sceneGroupMismatches).toEqual([]);
    expect(payload.report.repairedSceneGroupMismatches).toHaveLength(2);
    for (const storyboard of payload.storyboards) {
      expect(storyboard.continuityState).toMatchObject({
        groupId: "chapter-001:source:023-024",
        sceneVersionId: "scene-room:inn-room-window-axis:v1",
        sceneViewpointId: "inn-room-window-axis",
      });
      expect(storyboard.orderedReferenceManifest.map((item: { assetName: string; referenceRole: string }) => [item.assetName, item.referenceRole])).toEqual([
        ["悦来客栈斗室", "scene-viewpoint"],
        ["金水塾馆", "secondary-scene"],
      ]);
    }
  });

  it("syncs a pending v4 asset manifest into the store and invalidates dependent shots", () => {
    const result = runPythonSnippet(`
import importlib.util
import json
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("repair", "Library/repair_chapter001_visual_continuity.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory() as temp:
    project = Path(temp) / "project"
    project.mkdir()
    views = []
    for name in ("front", "side", "back"):
        path = project / f"dugu-{name}.png"
        path.write_bytes(name.encode("utf-8"))
        views.append(str(path))
    (project / "characters.json").write_text(json.dumps({"state": {"characters": [{
        "id": "canonical-dugu", "name": "独孤剑尘"
    }]}}), encoding="utf-8")
    (project / "scenes.json").write_text(json.dumps({"state": {"scenes": []}}), encoding="utf-8")
    (project / "props.json").write_text(json.dumps({"state": {"items": []}}), encoding="utf-8")
    version = module.normalize_continuity_asset_version({
        "assetId": "canonical-dugu",
        "versionId": "canonical-dugu:grey-town:v1",
        "assetKind": "character",
        "label": "grey-town",
        "referenceImagePaths": views,
        "referenceViewTypes": ["front", "side", "back"],
        "identityAnchors": {"uniqueMarks": ["背负三层油布剑包"], "hairStyle": "银白长发"},
        "negativePrompt": {"avoid": ["腰悬完整剑"]},
        "wardrobeVersion": "grey-town",
        "source": "project-character-bible",
        "approved": False,
    })
    version["reviewStatus"] = "pending"
    version["approval"] = None
    manifest_path = project / "manifest.json"
    manifest_path.write_text(json.dumps({
        "projectDir": str(project),
        "continuityAssetVersions": [version],
    }), encoding="utf-8")
    state = {
        "continuityAssetVersions": [],
        "storyboards": [
            {
                "id": "sb-chapter-001-006", "episodeId": "chapter-001", "index": 6,
                "prompt": "独孤入画", "orderedReferenceManifest": [{
                    "order": 1, "assetId": "stale-dugu", "assetName": "独孤剑尘",
                    "assetKind": "character", "versionId": "stale-dugu:grey-town:v1",
                    "imagePath": "/old.png", "referenceRole": "canonical", "approved": True,
                }],
                "continuityState": {
                    "groupId": "dock", "sceneVersionId": "dock:v1", "sceneViewpointId": "dock-main-axis",
                    "lighting": "冷青", "palette": "灰蓝", "actionIn": "入画", "actionOut": "停步",
                    "characters": [{
                        "characterId": "stale-dugu", "versionId": "stale-dugu:grey-town:v1",
                        "position": "中景", "orientation": "向右", "actionIn": "入画", "actionOut": "停步",
                    }], "inputFingerprint": "old",
                },
            },
            {
                "id": "sb-chapter-001-007", "episodeId": "chapter-001", "index": 7,
                "prompt": "承接", "orderedReferenceManifest": [],
                "continuityState": {
                    "groupId": "dock", "previousStoryboardId": "sb-chapter-001-006",
                    "sceneVersionId": "dock:v1", "sceneViewpointId": "dock-main-axis",
                    "lighting": "冷青", "palette": "灰蓝", "actionIn": "承接", "actionOut": "继续",
                    "characters": [], "inputFingerprint": "old",
                },
            },
        ],
    }
    report = module.sync_pending_asset_manifest(state, manifest_path)
    print(json.dumps({
        "report": report,
        "version": state["continuityAssetVersions"][0],
        "first": state["storyboards"][0],
        "second": state["storyboards"][1],
    }, ensure_ascii=False))
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const payload = JSON.parse(result.stdout.trim());
    expect(payload.report).toMatchObject({ versions: 1, pending: 1, approved: 0 });
    expect(payload.version).toMatchObject({ assetId: "canonical-dugu", approved: false, approval: null });
    expect(payload.first.orderedReferenceManifest[0]).toMatchObject({
      assetId: "canonical-dugu",
      versionId: "canonical-dugu:grey-town:v1",
      approved: false,
    });
    expect(payload.first.continuityState.characters[0]).toMatchObject({
      characterId: "canonical-dugu",
      versionId: "canonical-dugu:grey-town:v1",
    });
    expect(payload.first).toMatchObject({ stale: true, visualReview: { status: "pending" } });
    expect(payload.second).toMatchObject({ stale: true, visualReview: { status: "pending" } });
  });

  it("requires explicit human confirmation and carries one approved frame into the next pilot shot", () => {
    const result = runPythonSnippet(`
import importlib.util
import json
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("pilot", "Library/generate_chapter001_continuity_sample.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory() as temp:
    output = Path(temp)
    image = output / "shot-006.png"
    thumb = output / "shot-006_thumb.png"
    image.write_bytes(b"generated-shot-6")
    thumb.write_bytes(b"safe-thumbnail")
    entry = {
        "index": 6,
        "storyboardId": "sb-chapter-001-006",
        "outputPath": str(image),
        "outputSha256": module.stable_sha256(image),
        "transferThumbnail": {"path": str(thumb), "bytes": thumb.stat().st_size},
        "styleContractVersion": "daojie-gongbi-v2",
        "colorAudit": {"status": "pass"},
    }
    (output / "report.json").write_text(json.dumps({
        "shots": [6, 7], "entries": [entry], "status": "awaiting-human-approval"
    }), encoding="utf-8")
    blocked = ""
    try:
        module.approve_generated_shot(output, 6, False, "")
    except RuntimeError as error:
        blocked = str(error)
    checklist = {field: True for field in module.daojie_gongbi_v2.HUMAN_REVIEW_CHECKLIST_FIELDS}
    receipt = module.approve_generated_shot(output, 6, True, "角色、场景与道具检查通过", checklist)
    approvals = module.load_json_file(output / "human-approvals.json", {})
    approval = module.valid_human_approval(approvals, 6, entry)
    class Generator:
        EPISODE_ID = "chapter-001"
    manifest, reference = module.previous_approved_frame_manifest(Generator, 6, entry, approval, 4)
    image.write_bytes(b"changed-after-approval")
    invalid_after_change = module.valid_human_approval(approvals, 6, entry)
    print(json.dumps({
        "blocked": blocked,
        "receipt": receipt,
        "approval": approval,
        "manifest": manifest,
        "reference": reference,
        "invalidAfterChange": invalid_after_change,
    }, ensure_ascii=False))
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const payload = JSON.parse(result.stdout.trim());
    expect(payload.blocked).toContain("--human-confirmed");
    expect(payload.receipt).toMatchObject({ status: "ready-for-next-shot", approvedShot: 6 });
    expect(payload.approval).toMatchObject({ reviewer: "human", status: "approved" });
    expect(payload.manifest).toMatchObject({
      order: 4,
      referenceRole: "previous-approved-frame",
      approved: true,
    });
    expect(payload.reference).toMatchObject({ referenceRole: "previous-approved-frame" });
    expect(payload.invalidAfterChange).toBeNull();
  });

  it("defines explicit continuity states for the complete dock sample", () => {
    const result = runPythonSnippet(`
import importlib.util
import json

spec = importlib.util.spec_from_file_location("dao", "Library/build_daojie_chapter001_workflow.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

scene = {
    "name": "金水河码头", "kind": "场景", "assetId": "scene-dock", "imagePath": "/dock.png",
    "spatialLayout": "左岸湿木栈道通向右侧泊船区", "lightingDesign": "冷青晨雾漫射光",
    "colorPalette": "墨青、灰蓝、湿木浅褐", "viewpoints": [{"id": "dock-main-axis", "imageUrl": "/dock.png"}],
}
def character(name, asset_id):
    return {
        "name": name, "kind": "角色", "assetId": asset_id, "imagePath": f"/{asset_id}.png",
        "identityAnchors": {"uniqueMarks": [name]}, "negativePrompt": {"avoid": ["身份漂移"]},
        "views": [
            {"viewType": "front", "imageUrl": f"/{asset_id}.png"},
            {"viewType": "side", "imageUrl": f"/{asset_id}.png"},
            {"viewType": "three-quarter", "imageUrl": f"/{asset_id}.png"},
        ],
    }
characters = {
    "独孤剑尘": character("独孤剑尘", "char-dugu"),
    "监工赵四": character("监工赵四", "char-zhaosi"),
    "小杂役": character("小杂役", "char-worker"),
}
visible_by_index = {
    6: ["独孤剑尘"], 7: ["独孤剑尘"], 8: ["监工赵四", "小杂役"],
    9: ["独孤剑尘", "小杂役"], 10: ["监工赵四"], 11: ["小杂役"], 12: ["独孤剑尘"],
}
states = []
group = {"groupId": "chapter-001:source:006-012", "start": 6, "end": 12, "sceneName": "金水河码头", "viewpointId": "dock-main-axis"}
for index in range(6, 13):
    names = visible_by_index[index]
    assets = [scene, *[characters[name] for name in names]]
    manifest, _versions = module.build_ordered_continuity_manifest(assets, "dock-main-axis")
    semantics = {
        "sceneViewpointId": "dock-main-axis",
        "personFree": False,
        "visibleCharacters": [{
            "name": name, "position": "左中格", "orientation": "三分之四朝右",
            "actionIn": f"{name} 承接镜头 {index - 1}", "actionOut": f"{name} 完成镜头 {index}",
        } for name in names],
        "visibleProps": [],
        "actionIn": f"镜头 {index} 的明确起始状态",
        "actionOut": f"镜头 {index} 的明确结束状态",
    }
    state = module.build_storyboard_semantic_continuity_state(index, f"shot-{index}", assets, manifest, semantics, group)
    states.append({"index": index, "state": state})
print(json.dumps(states, ensure_ascii=False))
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const states = JSON.parse(result.stdout.trim()) as Array<{
      index: number;
      state: { groupId: string; previousStoryboardId?: string; actionIn: string; actionOut: string; inputFingerprint: string };
    }>;
    expect(states.map((item) => item.index)).toEqual([6, 7, 8, 9, 10, 11, 12]);
    expect(states.every((item) => item.state.groupId === "chapter-001:source:006-012")).toBe(true);
    expect(states.every((item) => item.state.actionIn.length > 0 && item.state.actionOut.length > 0)).toBe(true);
    expect(states.every((item) => item.state.inputFingerprint.length > 0)).toBe(true);
    expect(states.at(-1)?.state.previousStoryboardId).toBe("sb-chapter-001-011");
  });

  it("plans all six chapter groups and restarts only the affected group suffix", () => {
    const result = runPythonSnippet(`
import importlib.util
import json
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("pilot", "Library/generate_chapter001_continuity_sample.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
generator = module.load_generator()
shots = list(range(1, 44))
source_shots = []
for start, end, scene, viewpoint in [
    (1, 12, "金水河码头", "dock-main-axis"),
    (13, 19, "悦来客栈", "inn-hall-counter-axis"),
    (20, 24, "悦来客栈斗室", "inn-room-window-axis"),
    (25, 40, "金水塾馆", "school-lamp-desk-axis"),
    (41, 42, "悦来客栈斗室", "inn-room-night-return"),
    (43, 43, "金水河", "river-night-long-axis"),
]:
    for index in range(start, end + 1):
        source_shots.append({
            "index": index,
            "scene": scene,
            "shotSemantics": {
                "sceneViewpointId": viewpoint,
                "personFree": True,
                "visibleCharacters": [],
                "visibleProps": [],
                "actionIn": f"镜头 {index} 起始",
                "actionOut": f"镜头 {index} 结束",
            },
        })
generator.attach_storyboard_continuity_groups(source_shots)
groups = module.selected_continuity_groups(source_shots, shots)
entries = {
    index: {"index": index, "storyboardId": f"sb-chapter-001-{index:03d}", "outputPath": f"/tmp/{index}.png"}
    for index in shots
}
approvals = {"approvals": {str(index): {"index": index, "status": "approved"} for index in shots}}
kept_entries, kept_approvals, superseded = module.invalidate_restart_state(
    source_shots, shots, entries, approvals, 9
)
blocked = ""
try:
    module.selected_continuity_groups(source_shots, [6, 8])
except RuntimeError as error:
    blocked = str(error)
with tempfile.TemporaryDirectory() as temp:
    output = Path(temp)
    (output / "shot-009.png").write_bytes(b"old")
    revision = module.next_revision_output_path(output, 9)
planned = {}
module.merge_planned_continuity_versions(planned, [{
    "assetId": "scene-dock", "versionId": "scene-dock:main:v1", "contentFingerprint": "same"
}])
version_drift = ""
try:
    module.merge_planned_continuity_versions(planned, [{
        "assetId": "scene-dock", "versionId": "scene-dock:main:v1", "contentFingerprint": "changed"
    }])
except RuntimeError as error:
    version_drift = str(error)
print(json.dumps({
    "groups": groups,
    "keptEntries": sorted(kept_entries),
    "keptApprovals": sorted(int(index) for index in kept_approvals["approvals"]),
    "superseded": sorted(item["index"] for item in superseded),
    "blocked": blocked,
    "revision": revision.name,
    "previous": {
        "pilotFirst": module.required_previous_selected_shot(
            {"previousStoryboardId": "sb-chapter-001-005"}, [6, 7, 8, 9, 10, 11, 12], 6
        ),
        "pilotNext": module.required_previous_selected_shot(
            {"previousStoryboardId": "sb-chapter-001-006"}, [6, 7, 8, 9, 10, 11, 12], 7
        ),
        "groupBoundary": module.required_previous_selected_shot({}, shots, 13),
    },
    "dryStatus": module.build_group_progress(groups, entries, approvals, True)[0]["status"],
    "versionDrift": version_drift,
}, ensure_ascii=False))
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const payload = JSON.parse(result.stdout.trim());
    expect(payload.groups.map((item: { start: number; end: number }) => [item.start, item.end])).toEqual([
      [1, 12], [13, 19], [20, 24], [25, 40], [41, 42], [43, 43],
    ]);
    expect(payload.keptEntries).toEqual([...Array.from({ length: 8 }, (_, index) => index + 1), ...Array.from({ length: 31 }, (_, index) => index + 13)]);
    expect(payload.keptApprovals).toEqual(payload.keptEntries);
    expect(payload.superseded).toEqual([9, 10, 11, 12]);
    expect(payload.blocked).toContain("连续");
    expect(payload.revision).toBe("shot-009-r02.png");
    expect(payload.previous).toEqual({ pilotFirst: null, pilotNext: 6, groupBoundary: null });
    expect(payload.dryStatus).toBe("dry-run");
    expect(payload.versionDrift).toContain("指纹冲突");
  });

  it("keeps shots 20 through 24 in the declared inn-room continuity group", () => {
    const result = runPythonSnippet(`
import importlib.util
import json

spec = importlib.util.spec_from_file_location("dao", "Library/build_daojie_chapter001_workflow.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

room = {
    "name": "悦来客栈斗室", "kind": "场景", "assetId": "scene-room", "imagePath": "/room.png",
    "spatialLayout": "斗室内窗在右侧，房门在左后方", "lightingDesign": "枯灯暖光与窗外冷光",
    "colorPalette": "墨褐、旧金、冷青", "viewpoints": [{"id": "inn-room-window-axis", "imageUrl": "/room.png"}],
}
school = {
    "name": "金水塾馆", "kind": "场景", "assetId": "scene-school", "imagePath": "/school.png",
    "spatialLayout": "窗外远处塾馆屋脊", "lightingDesign": "冷青窗外光",
    "colorPalette": "冷青、灰墨", "viewpoints": [{"id": "school-window-exterior", "imageUrl": "/school.png"}],
}
shots = module.canonical_storyboard_shots()
states = []
group = {"groupId": "chapter-001:source:020-024", "start": 20, "end": 24, "sceneName": "悦来客栈斗室", "viewpointId": "inn-room-window-axis"}
for index in range(20, 25):
    assets = [room, school] if index >= 23 else [room]
    manifest, _versions, state = module.build_storyboard_continuity_payload(
        index,
        f"shot-{index}",
        assets,
        shot_semantics={
            "sceneViewpointId": "inn-room-window-axis",
            "personFree": True,
            "visibleCharacters": [],
            "visibleProps": [],
            "actionIn": f"斗室空镜 {index} 的起始构图",
            "actionOut": f"斗室空镜 {index} 的结束构图",
        },
        continuity_group=group,
    )
    states.append({
        "index": index,
        "scene": shots[index - 1]["scene"],
        "state": state,
        "sceneRoles": [item["referenceRole"] for item in manifest if item["assetKind"] == "scene"],
    })
print(json.dumps(states, ensure_ascii=False))
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const states = JSON.parse(result.stdout.trim()) as Array<{
      index: number;
      scene: string;
      state: { groupId: string; previousStoryboardId?: string; sceneVersionId: string; sceneViewpointId: string };
      sceneRoles: string[];
    }>;
    expect(states.map((item) => item.scene)).toEqual(Array(5).fill("悦来客栈斗室"));
    expect(states.every((item) => item.state.groupId === "chapter-001:source:020-024")).toBe(true);
    expect(states.every((item) => item.state.sceneVersionId === "scene-room:inn-room-window-axis:v1")).toBe(true);
    expect(states.every((item) => item.state.sceneViewpointId === "inn-room-window-axis")).toBe(true);
    expect(states[3]?.state.previousStoryboardId).toBe("sb-chapter-001-022");
    expect(states[3]?.sceneRoles).toEqual(["scene-viewpoint", "secondary-scene"]);
    expect(states[4]?.sceneRoles).toEqual(["scene-viewpoint", "secondary-scene"]);
  });

  it("fails Daojie storyboard prompt audits when visible roles lack reference images", () => {
    const result = runPythonSnippet(`
import importlib.util

spec = importlib.util.spec_from_file_location("dao", "Library/build_daojie_chapter001_workflow.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

refs = [
    {"title": "金水塾馆", "assetType": "scene", "aliases": ["金水塾馆"]},
    {"title": "李先生", "assetType": "character", "aliases": ["李先生"]},
]
raw = "李先生提醒独孤不要给孩童妄念。"
prompt = module.build_storyboard_image_prompt({"id": "sb-missing", "index": 28, "sceneNo": 3, "prompt": raw}, refs)
audit = module.build_storyboard_prompt_audit({"id": "sb-missing", "index": 28}, prompt, refs, raw)
try:
    module.assert_storyboard_prompt_audit(audit)
    print("no-error")
except RuntimeError as error:
    print("独孤剑尘" in str(error), audit["missingVisibleRoleReferences"])
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("True ['独孤剑尘']");
  });

  it("blocks a static Daojie fixture before it can infer per-shot cast references", () => {
    const result = runPythonSnippet(`
import importlib.util

spec = importlib.util.spec_from_file_location("dao", "Library/build_daojie_chapter001_workflow.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

blocked = []
for shot in module.canonical_storyboard_shots():
    try:
        module.require_storyboard_shot_semantics(shot)
    except RuntimeError as error:
        blocked.append("缺少出镜语义JSON" in str(error))
print(len(blocked), all(blocked))
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("43 True");
  });

  it("keeps project entity IDs canonical when episode extraction IDs are stale", () => {
    const result = runPythonSnippet(`
import importlib.util
import json
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("dao", "Library/build_daojie_chapter001_workflow.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory() as temp:
    root = Path(temp)
    module.CHARACTERS_JSON = root / "characters.json"
    module.SCENES_JSON = root / "scenes.json"
    module.CHARACTERS_JSON.write_text(json.dumps({"state": {"characters": [{
        "id": "canonical-dugu", "name": "独孤剑尘", "views": [], "variations": []
    }]}}), encoding="utf-8")
    module.SCENES_JSON.write_text(json.dumps({"state": {"scenes": [{
        "id": "canonical-dock", "name": "金水河码头"
    }]}}), encoding="utf-8")
    state = {"entityExtractions": [{
        "episodeId": module.EPISODE_ID,
        "characters": [{"name": "独孤剑尘", "characterId": "stale-dugu"}],
        "scenes": [{"name": "金水河码头", "sceneId": "stale-dock"}],
        "props": [],
    }]}
    index = module.build_asset_index(state)
    catalog = module.build_asset_catalog(state)
    print(index["独孤剑尘"], index["金水河码头"], catalog["独孤剑尘"]["id"], catalog["金水河码头"]["id"])
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("canonical-dugu canonical-dock canonical-dugu canonical-dock");
  });

  it("hard-locks the dock-overseer wardrobe color in storyboard bible rules", () => {
    const result = runPythonSnippet(`
import importlib.util

spec = importlib.util.spec_from_file_location("dao", "Library/build_daojie_chapter001_workflow.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

rules = module.build_storyboard_bible_rules([{
    "assetType": "character",
    "name": "监工赵四",
    "wardrobeVersion": "dock-overseer",
    "identityAnchors": {"uniqueMarks": ["粗壮监工体型"]},
    "negativePrompt": {"avoid": ["换脸"]},
}])
print("灰白旧监工袍作为服装主色、灰腰带、粗布层次清晰" in rules)
print("胸腹、双袖和下摆必须保留可见灰白色块" in rules)
print("近黑长袍、纯黑整套服装、黑色武服、把服装主色渲染成黑色" in rules)
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("True\nTrue\nTrue");
  });

  it("requires the current project storyboard table to provide per-shot semantics", () => {
    const result = runPythonSnippet(`
import importlib.util

spec = importlib.util.spec_from_file_location("dao", "Library/build_daojie_chapter001_workflow.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

state = module.load_json(module.STORE).setdefault("state", {})
source = module.resolve_storyboard_source(state, module.EPISODE_ID)
print(
    len(source["shots"]) == 43
    and all(isinstance(shot.get("shotSemantics"), dict) for shot in source["shots"])
)
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("True");
  });

  it("reuses approved v5 canonical references when the project catalog is stale", () => {
    const result = runPythonSnippet(`
import importlib.util
import json

spec = importlib.util.spec_from_file_location("dao", "Library/build_daojie_chapter001_workflow.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

state = module.load_json(module.STORE).setdefault("state", {})
catalog = module.build_asset_catalog(state)
existing_versions = {
    f"{item.get('assetId', '')}:{item.get('versionId', '')}": item
    for item in state.get("continuityAssetVersions") or []
}
shot = {
    "index": 6,
    "scene": "金水河码头",
    "assets": ["独孤剑尘", "油布剑包"],
    "shotSemantics": {
        "sceneViewpointId": "dock-main-axis",
        "personFree": False,
        "visibleCharacters": [{
            "name": "独孤剑尘", "position": "左中格", "orientation": "背部三分之四朝右",
            "actionIn": "从河雾外沿入画", "actionOut": "停在左中格",
        }],
        "visibleProps": [{"name": "油布剑包", "position": "左后景", "state": "背负且未露剑"}],
        "actionIn": "独孤剑尘从河雾外沿入画",
        "actionOut": "独孤剑尘停在左中格",
    },
}
image_assets = module.resolve_continuity_image_assets(shot, catalog)
manifest, versions = module.build_ordered_continuity_manifest(
    image_assets,
    shot["shotSemantics"]["sceneViewpointId"],
    shot["scene"],
)
old_paths = [item.get("imagePath") for item in manifest]
manifest, versions = module.reuse_approved_continuity_versions(
    manifest,
    versions,
    existing_versions,
)
print(json.dumps({
    "approved": sum(item.get("approved") is True for item in versions),
    "reused": sum(
        item.get("referenceImagePaths")
        and item.get("referenceImagePaths") != [old_paths[index]]
        for index, item in enumerate(versions)
    ),
    "pathsMatchStore": all(
        item.get("referenceImagePaths") == existing_versions[
            f"{item.get('assetId', '')}:{item.get('versionId', '')}"
        ].get("referenceImagePaths")
        for item in versions
        if f"{item.get('assetId', '')}:{item.get('versionId', '')}" in existing_versions
        and existing_versions[f"{item.get('assetId', '')}:{item.get('versionId', '')}"].get("approved") is True
    ),
}, ensure_ascii=False))
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout.trim())).toEqual({
      approved: 3,
      reused: 3,
      pathsMatchStore: true,
    });
  });

  it("injects Daojie ink-guofeng style and reference labels into derived asset image prompts", () => {
    const result = runPythonSnippet(`
import importlib.util

spec = importlib.util.spec_from_file_location("dao", "Library/build_daojie_chapter001_workflow.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

prompt = module.build_derived_asset_image_prompt(
    "独孤剑尘",
    "灰衫入镇态",
    "灰衫沾矿尘、背负油布剑包，作为第一章默认出镜状态。",
    "character",
)
scene_prompt = module.build_derived_asset_image_prompt(
    "金水河码头",
    "夜雾版",
    "夜色压低，河雾更重。",
    "scene",
)
prop_prompt = module.build_derived_asset_image_prompt(
    "归元断剑",
    "冷光出鞘态",
    "断口冷光微亮。",
    "prop",
)

checks = [
    "daojie-gongbi-v2" in prompt,
    "连续白描和铁线描" in prompt,
    "薄层矿物色分染与罩染" in prompt,
    "30%-70%可辨彩色" in prompt,
    "衣物必须完整可穿" in prompt,
    "禁止写实摄影" in prompt,
    "3D/CGI" in prompt,
    "@图1 为独孤剑尘角色基准图" in prompt,
    "角色四视图设定图" in prompt,
    "三视图参考图" in prompt,
    "人像特写" in prompt,
    "正视图" in prompt,
    "侧视图" in prompt,
    "后视图" in prompt,
    "portrait closeup" in prompt,
    "character reference sheet" in prompt,
    "character turnaround" in prompt,
    "不要生成单张全身插画" in prompt,
    "【参考继承边界】@图1仅继承同一角色身份、面容、体态、发型和比例结构" in prompt,
    "灰衫入镇态" in prompt,
]
scene_checks = [
    "@图1 为金水河码头场景基准图" in scene_prompt,
    "16:9横版国风漫剧资产设定图" in scene_prompt,
    "三视图" not in scene_prompt,
    "四视图" not in scene_prompt,
    "character turnaround" not in scene_prompt,
]
prop_checks = [
    "@图1 为归元断剑道具基准图" in prop_prompt,
    "16:9横版国风漫剧资产设定图" in prop_prompt,
    "三视图" not in prop_prompt,
    "四视图" not in prop_prompt,
    "character turnaround" not in prop_prompt,
]
print(all(checks), all(scene_checks), all(prop_checks), prompt.count("@图"))
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("True True True 3");
  });

  it("creates character derived asset fallback previews as reference sheets only for character assets", () => {
    const result = runPythonSnippet(`
import importlib.util
import tempfile
from pathlib import Path
from PIL import Image

spec = importlib.util.spec_from_file_location("dao", "Library/build_daojie_chapter001_workflow.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    source = root / "source.png"
    Image.new("RGB", (320, 760), (210, 204, 192)).save(source)
    character_result = root / "character.jpg"
    prop_result = root / "prop.jpg"
    module.create_derived_asset_image(source, character_result, "独孤剑尘", "灰衫入镇态", "灰衫沾矿尘", "character")
    module.create_derived_asset_image(source, prop_result, "归元断剑", "冷光出鞘态", "断口冷光微亮", "prop")
    character_size = Image.open(character_result).size
    prop_size = Image.open(prop_result).size
    print(f"{character_size[0]}x{character_size[1]} {prop_size[0]}x{prop_size[1]}")
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("1600x900 1280x720");
  });

  it("reuses fresh Daojie storyboard images during real provider resume", () => {
    const result = runPythonSnippet(`
import importlib.util
import os
import tempfile
from pathlib import Path
from PIL import Image

spec = importlib.util.spec_from_file_location("dao", "Library/build_daojie_chapter001_workflow.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    module.PROJECT = root / "project"
    module.PROJECT.mkdir()
    result_file = module.PROJECT / "workflow-images/storyboards/chapter-001/shot-001.png"
    result_file.parent.mkdir(parents=True)
    Image.new("RGB", (128, 72), (24, 96, 160)).save(result_file)
    ref_image = root / "ref.png"
    Image.new("RGB", (64, 64), (160, 80, 24)).save(ref_image)
    os.environ["MYSTUDIO_DAOJIE_REUSE_STORYBOARD_IMAGES"] = "1"
    os.environ["MYSTUDIO_DAOJIE_REUSE_STORYBOARD_IMAGES_AFTER"] = "2000-01-01T00:00:00"

    def fail_provider(*args, **kwargs):
        raise RuntimeError("provider should not be called")

    module.request_storyboard_image_generation = fail_provider
    frame = root / "frame.png"
    result = module.generate_storyboard_frame_with_references(
        frame,
        {"id": "sb-chapter-001-001", "index": 1, "prompt": "赤练蛇皮鞭撕开河雾。"},
        "赤练蛇皮鞭撕开河雾。",
        [{"name": "金水河码头", "kind": "场景", "imagePath": str(ref_image)}],
        {"model": "gpt-image-2", "aspectRatio": "16:9", "resolution": "1K"},
    )

    print(
        frame.exists(),
        result["projectImageUrl"].endswith("/workflow-images/storyboards/chapter-001/shot-001.png"),
        result.get("reusedExistingImage") is True,
        "daojie-gongbi-v2" in result["workflowGraph"]["nodes"][-1]["prompt"],
    )
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("True True True True");
  });

  it("does not reuse stale Daojie storyboard images during real provider resume", () => {
    const result = runPythonSnippet(`
import base64
import importlib.util
import os
import tempfile
from pathlib import Path
from PIL import Image

spec = importlib.util.spec_from_file_location("dao", "Library/build_daojie_chapter001_workflow.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    module.PROJECT = root / "project"
    module.PROJECT.mkdir()
    result_file = module.PROJECT / "workflow-images/storyboards/chapter-001/shot-001.png"
    result_file.parent.mkdir(parents=True)
    Image.new("RGB", (128, 72), (24, 96, 160)).save(result_file)
    os.utime(result_file, (946684800, 946684800))
    ref_image = root / "ref.png"
    Image.new("RGB", (64, 64), (160, 80, 24)).save(ref_image)
    generated = root / "generated.png"
    Image.new("RGB", (128, 72), (180, 40, 40)).save(generated)
    os.environ["MYSTUDIO_DAOJIE_REUSE_STORYBOARD_IMAGES"] = "1"
    os.environ["MYSTUDIO_DAOJIE_REUSE_STORYBOARD_IMAGES_AFTER"] = "2000-01-02T00:00:00"

    def fake_provider(*args, **kwargs):
        return "data:image/png;base64," + base64.b64encode(generated.read_bytes()).decode("ascii")

    module.request_storyboard_image_generation = fake_provider
    frame = root / "frame.png"
    result = module.generate_storyboard_frame_with_references(
        frame,
        {"id": "sb-chapter-001-001", "index": 1, "prompt": "赤练蛇皮鞭撕开河雾。"},
        "赤练蛇皮鞭撕开河雾。",
        [{"name": "金水河码头", "kind": "场景", "imagePath": str(ref_image)}],
        {"model": "gpt-image-2", "aspectRatio": "16:9", "resolution": "1K"},
    )

    print(
        frame.exists(),
        result.get("reusedExistingImage") is False,
        Image.open(result_file).convert("RGB").getpixel((0, 0))[0] > 150,
    )
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("True True True");
  });

  it("splits multiline Daojie storyboard image API keys before provider calls", () => {
    const helperScript = readBuildFile("build/generate-storyboard-image.mjs");

    expect(helperScript).toContain("apiKeys");
    expect(helperScript).toContain("parseApiKeys");
    expect(helperScript).toContain("for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex += 1)");
    expect(helperScript).toContain("const apiKey = apiKeys[keyIndex]");
    expect(helperScript).toContain("timeoutSeconds");
    expect(helperScript).toContain("AbortController");
    expect(helperScript).toContain("signal: controller.signal");

    const result = runPythonSnippet(`
import importlib.util
import os

os.environ["MYSTUDIO_DAOJIE_STORYBOARD_IMAGE_MODE"] = "real-ai-reference-image-workflow"
os.environ["MYSTUDIO_IMAGE_API_BASE_URL"] = "https://example.invalid/v1"
os.environ["MYSTUDIO_IMAGE_API_KEY"] = "key-one\\nkey-two"
os.environ["MYSTUDIO_IMAGE_MODEL"] = "gpt-image-2"
os.environ["MYSTUDIO_IMAGE_ASYNC_MODE"] = "1"

spec = importlib.util.spec_from_file_location("dao", "Library/build_daojie_chapter001_workflow.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

config = module.storyboard_image_provider_config()
print(config["apiKey"], config["apiKeys"], config["timeoutSeconds"], config["asyncMode"])
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("key-one ['key-one', 'key-two'] 180.0 True");
  });

  it("keeps Daojie storyboard image provider fallback order for real-ai mode", () => {
    const helperScript = readBuildFile("build/generate-storyboard-image.mjs");

    expect(helperScript).toContain("providers");
    expect(helperScript).toContain("for (const providerConfig of providers)");

    const result = runPythonSnippet(`
import importlib.util
import json
import os

os.environ["MYSTUDIO_DAOJIE_STORYBOARD_IMAGE_MODE"] = "real-ai-reference-image-workflow"
os.environ["MYSTUDIO_IMAGE_PROVIDER_CONFIGS_JSON"] = json.dumps([
    {
        "providerName": "first-provider",
        "baseUrl": "https://first.example/v1",
        "apiKey": "first-one\\nfirst-two",
        "model": "gpt-image-2",
        "timeoutSeconds": 45,
    },
    {
        "providerName": "second-provider",
        "baseUrl": "https://second.example/v1",
        "apiKeys": ["second-one"],
        "model": "gpt-image-2",
        "timeoutSeconds": 60,
    },
])

spec = importlib.util.spec_from_file_location("dao", "Library/build_daojie_chapter001_workflow.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

config = module.storyboard_image_provider_config()
print(
    [provider["providerName"] for provider in config["providers"]],
    [provider["apiKeys"] for provider in config["providers"]],
    config["apiKey"],
    config["timeoutSeconds"],
)
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(
      "['first-provider', 'second-provider'] [['first-one', 'first-two'], ['second-one']] first-one 45.0",
    );
  });

  it("keeps the explicit chapter 001 bootstrap fixture at 43 shots", () => {
    const result = runPythonSnippet(`
import importlib.util
spec = importlib.util.spec_from_file_location("dao", "Library/build_daojie_chapter001_workflow.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
shots = module.canonical_storyboard_shots()
total_duration = sum(float(module.shot_tuple(shot)[6]) for shot in shots)
print(len(module.CHAPTER_001_SHOTS), len(shots), round(total_duration, 1))
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("43 43 169.8");
  });

  it("selects the latest episode storyboard work and derives a dynamic two-shot source", () => {
    const result = runPythonSnippet(`
import importlib.util
spec = importlib.util.spec_from_file_location("dao", "Library/build_daojie_chapter001_workflow.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
old_table = """<storyboardTable>
| 1 | 旧镜头 | 旧场景 | [旧角色] | 3 | 中景 | 静止 | 旧动作 | — | — | 平静 | 旁白：旧镜头。 | 风声 | [old] |
</storyboardTable>"""
latest_table = """<storyboardTable>
| 序号 | 画面描述 | 场景 | 关联资产名称 | 时长 | 景别 | 运镜 | 角色动作 | 朝向 | 空间关系 | 情绪 | 台词 | 音效 | 关联资产ID |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 雨落码头 | 金水河码头 | [独孤剑尘] | 3 | 中景 | 缓推 | 抬头 | — | — | 克制 | 旁白：雨落码头。 | 雨声 | [char-dugu] |
| 2 | 独孤按剑 | 金水河码头 | [独孤剑尘] | 4 | 近景 | 静止 | 按剑 | — | — | 警觉 | 独孤剑尘：谁？ | 剑鸣 | [char-dugu] |
</storyboardTable>"""
state = {
    "agentWorkData": [
        {"id": "old", "key": "storyboardTable", "episodeId": "chapter-001", "data": old_table, "updatedAt": 10},
        {"id": "latest", "key": "storyboardTable", "episodeId": "chapter-001", "data": latest_table, "updatedAt": 20},
        {"id": "other", "key": "storyboardTable", "episodeId": "chapter-002", "data": old_table, "updatedAt": 99},
    ]
}
source = module.resolve_storyboard_source(state, "chapter-001")
print(source["kind"], source["workId"], len(source["shots"]), [shot["index"] for shot in source["shots"]])
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("project-storyboard-table latest 2 [1, 2]");
  });

  it("derives all 43 shots from a project storyboard table without bootstrap fallback", () => {
    const result = runPythonSnippet(`
import importlib.util
import json
spec = importlib.util.spec_from_file_location("dao", "Library/build_daojie_chapter001_workflow.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
header = [
    "| 序号 | 画面描述 | 场景 | 关联资产名称 | 时长 | 景别 | 运镜 | 角色动作 | 朝向 | 空间关系 | 情绪 | 台词 | 音效 | 关联资产ID | 出镜语义JSON |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
]
rows = [
    "| {index} | 动态镜头{index} | 金水河码头 | [独孤剑尘] | 3 | 中景 | 静止 | 抬头 | — | — | 克制 | 旁白：第{index}镜。 | 风声 | [char-dugu] | {semantics} |".format(
        index=index,
        semantics=json.dumps({
            "sceneViewpointId": "dock-main-axis",
            "personFree": False,
            "visibleCharacters": [{
                "name": "独孤剑尘", "position": "中格", "orientation": "三分之四朝右",
                "actionIn": f"进入动态镜头{index}", "actionOut": f"结束动态镜头{index}",
            }],
            "visibleProps": [],
            "actionIn": f"动态镜头{index} 的起始状态",
            "actionOut": f"动态镜头{index} 的结束状态",
        }, ensure_ascii=False, separators=(",", ":")),
    )
    for index in range(1, 44)
]
dynamic_table = "<storyboardTable>" + chr(10) + chr(10).join(header + rows) + chr(10) + "</storyboardTable>"
state = {
    "agentWorkData": [{
        "id": "dynamic-43",
        "key": "storyboardTable",
        "episodeId": "chapter-001",
        "data": dynamic_table,
        "updatedAt": 43,
    }]
}
source = module.resolve_storyboard_source(state, "chapter-001")
print(
    source["kind"],
    source["workId"],
    len(source["shots"]),
    source["shots"][0]["desc"],
    source["shots"][-1]["desc"],
    [source["shots"][0]["index"], source["shots"][-1]["index"]],
)
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(
      "project-storyboard-table dynamic-43 43 动态镜头1 动态镜头43 [1, 43]",
    );
  });

  it("parses the latest grouped seven-column storyboard and rejects non-continuous indexes", () => {
    const result = runPythonSnippet(`
import importlib.util
import json
spec = importlib.util.spec_from_file_location("dao", "Library/build_daojie_chapter001_workflow.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
old_table = """<storyboardTable>
| 1 | 旧镜头 | 旧场景 | [旧角色] | 3 | 中景 | 静止 | 旧动作 | — | — | 平静 | 旁白：旧镜头。 | 风声 | [old] |
</storyboardTable>"""
latest_table = """<storyboardTable>
## 场 1：金水河码头｜参演角色：独孤剑尘
**引用资产名称**：[金水河码头，独孤剑尘]
**引用资产ID**：[scene-jinshui，char-dugu]
| 序号 | 画面描述 | 时长 | 景别 | 运镜 | 台词 | 音效 |
|---|---|---|---|---|---|---|
| 1 | 雨落码头 | 3秒 | 中景 | 缓推 | — | 雨声 |
## 场 2：悦来客栈｜参演角色：独孤剑尘
**引用资产名称**：[悦来客栈，独孤剑尘]
**引用资产ID**：[scene-inn，char-dugu]
| 2 | 独孤按剑 | 4秒 | 近景 | 静止 | 独孤剑尘：谁？ | 剑鸣 |
</storyboardTable>"""
state = {
    "agentWorkData": [
        {"id": "old-14", "key": "storyboardTable", "episodeId": "chapter-001", "data": old_table, "updatedAt": 10},
        {"id": "latest-7", "key": "storyboardTable", "episodeId": "chapter-001", "data": latest_table, "updatedAt": 20},
    ]
}
source = module.resolve_storyboard_source(state, "chapter-001")
voiceovers = module.build_storyboard_voiceovers(
    source["shots"],
    [{"characterId": "char-dugu", "name": "独孤剑尘", "aliases": ["剑尘"]}],
    "chapter-001",
)
bad_error = ""
try:
    module.parse_storyboard_table(
        latest_table.replace("| 2 | 独孤按剑", "| 3 | 独孤按剑"),
        "chapter-001",
    )
except RuntimeError as error:
    bad_error = str(error)
print(json.dumps({
    "kind": source["kind"],
    "workId": source["workId"],
    "indexes": [shot["index"] for shot in source["shots"]],
    "scenes": [shot["scene"] for shot in source["shots"]],
    "assets": [shot["assets"] for shot in source["shots"]],
    "assetIds": [shot["assetIds"] for shot in source["shots"]],
    "speakerIds": [item["speakerId"] for item in voiceovers],
    "badError": bad_error,
}, ensure_ascii=False))
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const payload = JSON.parse(result.stdout.trim());
    expect(payload).toMatchObject({
      kind: "project-storyboard-table",
      workId: "latest-7",
      indexes: [1, 2],
      scenes: ["金水河码头", "悦来客栈"],
      assets: [["独孤剑尘"], ["独孤剑尘"]],
      assetIds: [
        ["scene-jinshui", "char-dugu"],
        ["scene-inn", "char-dugu"],
      ],
      speakerIds: ["narrator", "character:char-dugu"],
    });
    expect(payload.badError).toContain("分镜序号必须连续为 1..N");
    expect(payload.badError).toContain("[1, 3]");
  });

  it("requires an explicit canonical alias for storyboard speakers", () => {
    const result = runPythonSnippet(`
import importlib.util
spec = importlib.util.spec_from_file_location("dao", "Library/build_daojie_chapter001_workflow.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
shot = {
    "index": 2,
    "speaker": "赵四",
    "text": "都给我跪下。",
    "duration": 3,
    "emotion": "压迫",
}
identities = [{"characterId": "char-zhao", "name": "监工赵四", "aliases": ["监工", "监工老爷"]}]
try:
    module.build_storyboard_voiceover(shot, identities)
except RuntimeError as error:
    print(str(error))
identities[0]["aliases"].append("赵四")
print(module.build_storyboard_voiceover(shot, identities)["speakerId"])
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("分镜 sb-chapter-001-002 speaker 解析失败");
    expect(result.stdout).toContain("赵四");
    expect(result.stdout.trim().endsWith("character:char-zhao")).toBe(true);
  });

  it("preserves the director-table duration budget and only estimates missing durations", () => {
    const result = runPythonSnippet(`
import importlib.util
import json
spec = importlib.util.spec_from_file_location("dao", "Library/build_daojie_chapter001_workflow.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
identities = [{"characterId": "char-zhao", "name": "监工赵四", "aliases": ["赵四"]}]
shot = {
    "index": 1,
    "speaker": "赵四",
    "text": "矿账又涨了，今夜要补齐，不够就抓人。",
    "duration": 4.2,
    "emotion": "压迫",
}
fixed = module.build_storyboard_voiceover(shot, identities)
fallback = module.build_storyboard_voiceover({**shot, "duration": 0}, identities)
print(json.dumps({
    "sourceDurationTarget": fixed["durationTarget"],
    "fallbackDurationTarget": fallback["durationTarget"],
}, ensure_ascii=False))
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const payload = JSON.parse(result.stdout.trim());
    expect(payload.sourceDurationTarget).toBe(4.2);
    expect(payload.fallbackDurationTarget).toBeGreaterThan(0);
  });

  it("persists a missing fixed binding once and keeps the second-run fingerprint stable", () => {
    const result = runPythonSnippet(`
import importlib.util
import json
import tempfile
from pathlib import Path
spec = importlib.util.spec_from_file_location("dao", "Library/build_daojie_chapter001_workflow.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as temp_dir:
    root = Path(temp_dir)
    narrator_audio = root / "narrator.wav"
    zhao_audio = root / "zhao.wav"
    narrator_audio.write_bytes(b"narrator-audio")
    zhao_audio.write_bytes(b"zhao-audio")
    tts_path = root / "tts.json"
    initial = {
        "state": {
            "activeProjectId": "project-1",
            "projects": {
                "project-1": {
                    "voiceLines": {},
                    "bindings": {
                        "narrator": {"speakerId": "narrator", "profileId": "profile-narrator"}
                    },
                }
            },
            "voiceProfiles": {
                "profile-narrator": {
                    "id": "profile-narrator",
                    "name": "固定旁白",
                    "type": "reference",
                    "language": "zh",
                    "defaultEngine": "qwen",
                    "referenceAudioPath": str(narrator_audio),
                    "referenceText": "这一夜，雨没有停。",
                    "createdAt": 111,
                    "updatedAt": 222,
                }
            },
        },
        "version": 7,
    }
    module.save_json(tts_path, initial)
    speakers = {
        "narrator": {"speaker": "旁白"},
        "character:char-zhao": {"speaker": "赵四"},
    }
    first = module.resolve_fixed_voice_bindings(
        module.load_project_tts_state(tts_path, "project-1"),
        "project-1",
        speakers,
        [{
            "name": "军士-男-低音、厚实、强壮",
            "audioPath": str(zhao_audio),
            "voice_reference_text": "都给我跪下。",
        }],
    )
    module.save_json(tts_path, first["document"])
    first_disk = module.load_json(tts_path)
    second = module.resolve_fixed_voice_bindings(
        module.load_project_tts_state(tts_path, "project-1"),
        "project-1",
        speakers,
        None,
    )
    second_disk = second["document"]
    broken = json.loads(json.dumps(first_disk))
    broken["state"]["voiceProfiles"]["profile-narrator"]["referenceAudioPath"] = str(root / "missing.wav")
    broken_before = json.dumps(broken, ensure_ascii=False, sort_keys=True)
    broken_unchanged = False
    try:
        module.resolve_fixed_voice_bindings(broken, "project-1", speakers, None)
    except RuntimeError:
        broken_unchanged = json.dumps(broken, ensure_ascii=False, sort_keys=True) == broken_before
    zhao_id = first["speakerVoiceMap"]["character:char-zhao"]["profileId"]
    print(json.dumps({
        "firstFixed": first["fixedVoiceBindings"],
        "firstSelected": first["aiSelectedVoiceBindings"],
        "secondFixed": second["fixedVoiceBindings"],
        "secondSelected": second["aiSelectedVoiceBindings"],
        "sameFingerprint": first["voiceBindingFingerprint"] == second["voiceBindingFingerprint"],
        "sameZhaoProfile": first_disk["state"]["voiceProfiles"][zhao_id] == second_disk["state"]["voiceProfiles"][zhao_id],
        "narratorUpdatedAt": second_disk["state"]["voiceProfiles"]["profile-narrator"]["updatedAt"],
        "brokenUnchanged": broken_unchanged,
    }, ensure_ascii=False))
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const payload = JSON.parse(result.stdout.trim());
    expect(payload.firstFixed).toEqual(["narrator"]);
    expect(payload.firstSelected).toEqual(["character:char-zhao"]);
    expect(payload.secondFixed).toEqual(["character:char-zhao", "narrator"]);
    expect(payload.secondSelected).toEqual([]);
    expect(payload.sameFingerprint).toBe(true);
    expect(payload.sameZhaoProfile).toBe(true);
    expect(payload.narratorUpdatedAt).toBe(222);
    expect(payload.brokenUnchanged).toBe(true);
  });

  it("generates icons from the current frontend assets directory", () => {
    const source = readBuildFile("frontend/scripts/generate-icon.mjs");

    expect(source).toContain("'..'");
    expect(source).toContain("'assets', 'brand'");
    expect(source).toContain("frontend/assets/brand/manying-studio-logo.png");
    expect(source).not.toContain("'src', 'assets', 'brand'");
  });
});
