import {
  mkdirSync,
  mkdtempSync,
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
    expect(runnerScript).toContain("MYSTUDIO_SMOKE_STEP_DELAY_MS || 2500");
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
    expect(runnerScript).toContain("if (runPassed) child.unref()");
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
    const finalStat = statSync(finalPath);
    const base = {
      enabled: true,
      stageClicked: true,
      clicked: true,
      preClickStage: "idle",
      startedAtMs: finalStat.mtimeMs - 1,
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
    const generatorScript = readFileSync(
      resolve(appsRoot, "..", "Library", "build_daojie_chapter001_workflow.py"),
      "utf8",
    );

    expect(packageJson).toContain(
      '"video:daojie:chapter001": "node ./build/automate-daojie-chapter001-video.mjs"',
    );
    expect(videoScript).toContain("Library");
    expect(videoScript).toContain("build_daojie_chapter001_workflow.py");
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
    expect(videoScript).toContain("opencut-api-config");
    expect(videoScript).toContain("freedom_image");
    expect(videoScript).toContain("MYSTUDIO_IMAGE_PROVIDER_CONFIGS_JSON");
    expect(videoScript).toContain("generatedFrameImages");
    expect(videoScript).toContain("matchedAssetImages");
    expect(videoScript).toContain("storyboardMediaManifest");
    expect(videoScript).toContain("assetImageManifest");
    expect(videoScript).toContain("trackCandidateManifest");
    expect(videoScript).toContain("derivedAssetPlan");
    expect(videoScript).toContain("derivedAssetManifest");
    expect(videoScript).toContain("finalVideoEvidence");
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
          "data:image/png;base64,cmVmMQ==",
          "data:image/png;base64,cmVmMg==",
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
        image_urls: [
          "data:image/png;base64,cmVmMQ==",
          "data:image/png;base64,cmVmMg==",
        ],
      });
      expect(requests[0].body).not.toHaveProperty("aspect_ratio");
      expect(requests[0].body).not.toHaveProperty("resolution");
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    }
  }, 10_000);

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
        referenceImages: ["data:image/png;base64,cmVm"],
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
    "《道劫》默认主风格" in prompt,
    "宣纸淡彩工笔" in prompt,
    "低饱和青绿山水" in prompt,
    "竹窗卷轴人物质感" in prompt,
    "旧金只用于衣纹" in prompt,
    "水墨国风" in prompt,
    "工笔线描" in prompt,
    "宣纸质感" in prompt,
    "高完成度国风漫剧关键帧" in prompt,
    "画面无字幕、无水印、无标题叠字" in prompt,
    "禁止写实摄影" in prompt,
    "禁止3D写实渲染" in prompt,
    "禁止偏离宣纸淡彩工笔主风格" in prompt,
    "禁止白底设定图/三视图/四视图/资料卡" in prompt,
    "@图1 为金水河码头场景" in prompt,
    "@图2 为独孤剑尘角色" in prompt,
    "@图3 为赤练蛇皮鞭道具" in prompt,
    "角色一致性" in prompt,
    "场景一致性" in prompt,
    "道具一致性" in prompt,
    "只允许镜头、动作、表情按当前分镜变化" in prompt,
    "只变化当前分镜需要的景别、动作、表情" in prompt,
    "保持所有@图N造型、结构与参考图一致" in prompt,
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
]
print(all(checks), prompt.count("@图") >= 8)
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("True True");
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

  it("audits all Daojie chapter 001 storyboard prompts for Toonflow-style bindings", () => {
    const result = runPythonSnippet(`
import importlib.util

spec = importlib.util.spec_from_file_location("dao", "Library/build_daojie_chapter001_workflow.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

state = module.load_json(module.STORE).setdefault("state", {})
catalog = module.build_asset_catalog(state)
manifest = []
for index, shot in enumerate(module.canonical_storyboard_shots(), 1):
    scene, desc, speaker, text, sound, assets, duration = module.shot_tuple(shot)
    refs = module.collect_storyboard_reference_images(module.resolve_image_assets(scene, assets, catalog))
    prompt = module.build_storyboard_image_prompt({"id": f"sb-{index}", "index": index, "sceneNo": shot.get("sceneNo", 1), "prompt": desc}, refs)
    audit = module.build_storyboard_prompt_audit({"id": f"sb-{index}", "index": index}, prompt, refs, desc)
    module.assert_storyboard_prompt_audit(audit)
    manifest.append(audit)
summary = module.summarize_storyboard_prompt_manifest(manifest)
print(
    len(manifest),
    summary["storyboardPromptsWithReferenceBindings"],
    summary["storyboardPromptsWithDaojieStyleLock"],
    summary["storyboardPromptsWithLightSection"],
    summary["storyboardPromptsWithMissingVisibleCharacterRefs"],
    summary["storyboardPromptsWithRawAssetNameLeaks"],
)
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("43 43 43 43 0 0");
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
    "水墨国风修仙" in prompt,
    "工笔线描" in prompt,
    "宣纸质感" in prompt,
    "水墨国风电影质感" in prompt,
    "画面无字幕、无水印、无标题叠字" in prompt,
    "禁止写实摄影" in prompt,
    "禁止3D写实渲染" in prompt,
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
    "保持所有@图N造型、结构与参考图一致" in prompt,
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
        "《道劫》默认主风格" in result["workflowGraph"]["nodes"][-1]["prompt"],
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

spec = importlib.util.spec_from_file_location("dao", "Library/build_daojie_chapter001_workflow.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

config = module.storyboard_image_provider_config()
print(config["apiKey"], config["apiKeys"], config["timeoutSeconds"])
`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("key-one ['key-one', 'key-two'] 180.0");
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
spec = importlib.util.spec_from_file_location("dao", "Library/build_daojie_chapter001_workflow.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
header = [
    "| 序号 | 画面描述 | 场景 | 关联资产名称 | 时长 | 景别 | 运镜 | 角色动作 | 朝向 | 空间关系 | 情绪 | 台词 | 音效 | 关联资产ID |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
]
rows = [
    f"| {index} | 动态镜头{index} | 金水河码头 | [独孤剑尘] | 3 | 中景 | 静止 | 抬头 | — | — | 克制 | 旁白：第{index}镜。 | 风声 | [char-dugu] |"
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
