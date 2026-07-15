import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import { homedir, tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { terminateSpawnedApp } from "./smoke-process-lifecycle.mjs";
import { auditVisibleAutoVideo } from "./visible-workflow-auto-video-audit.mjs";
import {
  hasMYStudioForegroundViolation,
  sampleFrontmostApplication,
} from "./smoke-focus.mjs";

const appBinCandidates = [
  process.env.MYSTUDIO_SMOKE_APP_BIN,
  resolve(
    process.cwd(),
    "release",
    "build",
    "mac-arm64",
    "mac-arm64",
    "漫影工作室.app",
    "Contents",
    "MacOS",
    "漫影工作室",
  ),
  resolve(
    process.cwd(),
    "release",
    "build",
    "mac-arm64",
    "漫影工作室.app",
    "Contents",
    "MacOS",
    "漫影工作室",
  ),
].filter(Boolean);
const appBin =
  appBinCandidates.find((candidate) => existsSync(candidate)) ??
  appBinCandidates[0];
const debugPort = Number(
  process.env.MYSTUDIO_SMOKE_DEBUG_PORT ||
    String(9400 + Math.floor(Math.random() * 400)),
);
const skipPrekill = process.env.MYSTUDIO_SMOKE_SKIP_PREKILL === "1";
const runInBackground =
  process.argv.includes("--background") ||
  process.env.MYSTUDIO_SMOKE_BACKGROUND === "1";
const runMode = runInBackground ? "background" : "visible";
const defaultStepDelayMs = runInBackground ? 250 : 2500;
const stepDelayMs = Number(
  process.env.MYSTUDIO_SMOKE_STEP_DELAY_MS || defaultStepDelayMs,
);
const safeStepDelayMs = Number.isFinite(stepDelayMs)
  ? Math.max(0, stepDelayMs)
  : defaultStepDelayMs;
const appProcessName = "漫影工作室";
const smokeAudioPath = "/tmp/mystudio-smoke-voice.wav";
const smokeVideoPath = "/tmp/mystudio-smoke-final.mp4";
const runRealDaojie =
  process.argv.includes("--daojie") ||
  process.env.MYSTUDIO_WORKFLOW_REAL_DAOJIE === "1";
const runChapterAutoVideo =
  process.argv.includes("--auto-video") ||
  process.env.MYSTUDIO_WORKFLOW_AUTO_VIDEO === "1";
const autoVideoTimeoutMs = Number(
  process.env.MYSTUDIO_AUTO_VIDEO_TIMEOUT_MS || 600_000,
);
if (runChapterAutoVideo && !runRealDaojie) {
  throw new Error("--auto-video requires --daojie or MYSTUDIO_WORKFLOW_REAL_DAOJIE=1");
}
if (runChapterAutoVideo && (!Number.isFinite(autoVideoTimeoutMs) || autoVideoTimeoutMs <= 0)) {
  throw new Error("MYSTUDIO_AUTO_VIDEO_TIMEOUT_MS must be a positive number");
}
const safeAutoVideoTimeoutMs = Number.isFinite(autoVideoTimeoutMs) && autoVideoTimeoutMs > 0
  ? Math.floor(autoVideoTimeoutMs)
  : 600_000;
const daojieProjectName = "道劫";
const daojieChapterId = "chapter-001";
const daojieChapterTitle = "第1章：剑主夜访道口镇";
const daojieProjectId =
  process.env.MYSTUDIO_DAOJIE_PROJECT_ID ||
  "49dce4c1-64b1-42de-85c2-9f266698aec0";
const daojieSourceUserDataDir =
  process.env.MYSTUDIO_DAOJIE_USER_DATA_DIR ||
  resolve(homedir(), "Library", "Application Support", appProcessName);
const visibleRunReportPath =
  (runInBackground
    ? process.env.MYSTUDIO_BACKGROUND_WORKFLOW_REPORT_PATH
    : process.env.MYSTUDIO_VISIBLE_WORKFLOW_REPORT_PATH) ||
  resolve(
    process.cwd(),
    "output",
    "automation",
    runRealDaojie
      ? runInBackground
        ? "background-workflow-daojie-report.json"
        : "visible-workflow-daojie-report.json"
      : runInBackground
        ? "background-workflow-smoke-report.json"
        : "visible-workflow-smoke-report.json",
  );

if (!existsSync(appBin)) {
  console.error(
    `Packaged app was not found. Checked:\n${appBinCandidates.join("\n")}`,
  );
  process.exit(1);
}

function runOptional(command, args) {
  spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    stdio: "ignore",
  });
}

function stopExistingMYStudioInstances() {
  if (skipPrekill) {
    console.log("[visible-run] skipping pre-run MYStudio instance cleanup");
    return;
  }
  if (process.platform === "darwin") {
    runOptional("osascript", [
      "-e",
      'tell application id "com.manju2026.manying-studio" to quit',
    ]);
  }
  for (const processName of [
    "漫影工作室",
    "漫影工作室 Helper",
    "manying-studio",
  ]) {
    runOptional("pkill", ["-x", processName]);
  }
  runOptional("pkill", ["-f", "漫影工作室.app/Contents"]);
  console.log("[visible-run] closed existing MYStudio instances before workflow run");
}

function prepareSmokeMedia() {
  if (runRealDaojie) return;
  rmSync(smokeAudioPath, { force: true });
  rmSync(smokeVideoPath, { force: true });

  const audio = spawnSync(
    "ffmpeg",
    [
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=24000:cl=mono",
      "-t",
      "0.2",
      "-acodec",
      "pcm_s16le",
      "-y",
      smokeAudioPath,
    ],
    { stdio: "ignore" },
  );
  if (audio.status !== 0 || !existsSync(smokeAudioPath)) {
    console.warn("[visible-run] failed to create smoke wav fixture");
  }

  const video = spawnSync(
    "ffmpeg",
    [
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=320x180:d=0.2",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-y",
      smokeVideoPath,
    ],
    { stdio: "ignore" },
  );
  if (video.status !== 0 || !existsSync(smokeVideoPath)) {
    console.warn("[visible-run] failed to create smoke mp4 fixture");
  }
}

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeVisibleRunReport(report) {
  mkdirSync(dirname(visibleRunReportPath), { recursive: true });
  writeFileSync(
    visibleRunReportPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        command: runInBackground
          ? runRealDaojie
            ? runChapterAutoVideo
              ? "npm run smoke:workflow:background:daojie -- --auto-video"
              : "npm run smoke:workflow:background:daojie"
            : "npm run smoke:workflow:background"
          : runRealDaojie
            ? runChapterAutoVideo
              ? "npm run smoke:workflow:run:daojie -- --auto-video"
              : "npm run smoke:workflow:run:daojie"
            : "npm run smoke:workflow:run",
        reportPath: visibleRunReportPath,
        mode: runMode,
        ...report,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`[visible-run] report written ${visibleRunReportPath}`);
}

function copyIfExists(sourcePath, targetPath) {
  if (!existsSync(sourcePath)) return;
  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
}

function copyProjectDirectoryIfExists(sourcePath, targetPath) {
  if (!existsSync(sourcePath) || existsSync(targetPath)) return;
  mkdirSync(dirname(targetPath), { recursive: true });
  cpSync(sourcePath, targetPath, {
    recursive: true,
    dereference: true,
    preserveTimestamps: true,
  });
}

function cloneRealDaojieUserData() {
  const sourceProjectsDir = resolve(daojieSourceUserDataDir, "projects");
  const projectStorePath = resolve(sourceProjectsDir, "mystudio-project-store.json");
  if (!existsSync(projectStorePath)) {
    throw new Error(`Daojie project store was not found: ${projectStorePath}`);
  }

  const projectStore = readJsonFile(projectStorePath);
  const projects = projectStore?.state?.projects || [];
  const project =
    projects.find((candidate) => candidate.id === daojieProjectId) ||
    projects.find((candidate) => String(candidate.name || "").includes(daojieProjectName));
  if (!project) {
    throw new Error(`Daojie project was not found in ${projectStorePath}`);
  }

  const projectDir = resolve(sourceProjectsDir, "_p", project.id);
  const workflowStorePath = resolve(projectDir, "studio-workflow-store.json");
  if (!existsSync(workflowStorePath)) {
    throw new Error(`Daojie workflow store was not found: ${workflowStorePath}`);
  }

  const workflowStore = readJsonFile(workflowStorePath);
  const workflowState = workflowStore?.state || {};
  const chapter = (workflowState.novelChapters || []).find(
    (candidate) => candidate.id === daojieChapterId,
  );
  if (!chapter || chapter.title !== daojieChapterTitle) {
    throw new Error(
      `Daojie ${daojieChapterId} was not found or had an unexpected title in ${workflowStorePath}`,
    );
  }
  const chapterStoryboards = (workflowState.storyboards || []).filter(
    (candidate) => candidate.episodeId === daojieChapterId,
  );
  if (!(chapterStoryboards.length > 0)) {
    throw new Error(
      `Daojie ${daojieChapterId} has no source storyboards in ${workflowStorePath}`,
    );
  }
  const sourceDerivedPlans = (workflowState.scriptPlans || []).flatMap(
    (plan) => plan.derivedAssetPlan || [],
  );
  const sourceDerivedWorkflows = (workflowState.imageWorkflows || []).filter((graph) =>
    String(graph.id || "").startsWith("asset-flow-chapter-001"),
  );
  if (sourceDerivedPlans.length < 3 || sourceDerivedWorkflows.length < 3) {
    throw new Error(
      `Daojie derived asset evidence is incomplete in ${workflowStorePath}: plans=${sourceDerivedPlans.length}, workflows=${sourceDerivedWorkflows.length}`,
    );
  }

  const clonedUserDataDir = mkdtempSync(resolve(tmpdir(), "mystudio-daojie-workflow-run-"));
  const clonedProjectsDir = resolve(clonedUserDataDir, "projects");
  const clonedProjectDir = resolve(clonedProjectsDir, "_p", project.id);
  mkdirSync(clonedProjectDir, { recursive: true });

  for (const fileName of [
    "mystudio-app-settings.json",
    "mystudio-media-store.json",
    "mystudio-project-store.json",
  ]) {
    copyIfExists(resolve(sourceProjectsDir, fileName), resolve(clonedProjectsDir, fileName));
  }

  for (const storeName of [
    "scenes",
    "sclass",
    "script",
    "characters",
    "props",
    "studio-workflow-store",
    "director",
    "media",
    "tts",
  ]) {
    copyIfExists(
      resolve(projectDir, `${storeName}.json`),
      resolve(clonedProjectDir, `${storeName}.json`),
    );
  }

  for (const storeName of ["scenes", "characters", "media"]) {
    copyIfExists(
      resolve(sourceProjectsDir, "_shared", `${storeName}.json`),
      resolve(clonedProjectsDir, "_shared", `${storeName}.json`),
    );
  }

  const sourceExportsDir = resolve(projectDir, "exports");
  const clonedExportsDir = resolve(clonedProjectDir, "exports");
  copyProjectDirectoryIfExists(sourceExportsDir, clonedExportsDir);

  const sourceWorkflowImagesDir = resolve(projectDir, "workflow-images");
  const clonedWorkflowImagesDir = resolve(clonedProjectDir, "workflow-images");
  copyProjectDirectoryIfExists(sourceWorkflowImagesDir, clonedWorkflowImagesDir);

  return {
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    expectedStoryboards: chapterStoryboards.length,
    projectId: project.id,
    projectName: project.name,
    sourceProjectsDir,
    userDataDir: clonedUserDataDir,
  };
}

function inspectClonedDaojieProjectData(userDataDir) {
  const projectDir = resolve(userDataDir, "projects", "_p", daojieProjectId);
  const workflowState = readJsonFile(resolve(projectDir, "studio-workflow-store.json")).state || {};
  const characters = existsSync(resolve(projectDir, "characters.json"))
    ? readJsonFile(resolve(projectDir, "characters.json")).state?.characters || []
    : [];
  const scenes = existsSync(resolve(projectDir, "scenes.json"))
    ? readJsonFile(resolve(projectDir, "scenes.json")).state?.scenes || []
    : [];
  const props = existsSync(resolve(projectDir, "props.json"))
    ? readJsonFile(resolve(projectDir, "props.json")).state?.items || []
    : [];
  const scriptPlans = (workflowState.scriptPlans || []).filter(
    (candidate) => !candidate.episodeId || candidate.episodeId === daojieChapterId,
  );
  const derivedAssetPlan = scriptPlans.flatMap((plan) => plan.derivedAssetPlan || []);
  const derivedCharacterVariations = characters.flatMap((character) =>
    (character.variations || []).filter((variation) =>
      Boolean(variation.imageWorkflowId && variation.referenceImage),
    ),
  );
  const derivedScenes = scenes.filter((scene) =>
    Boolean(scene.parentSceneId && scene.imageWorkflowId && scene.referenceImage),
  );
  const derivedProps = props.filter((prop) =>
    Boolean(prop.parentId && prop.imageWorkflowId && prop.imageUrl),
  );
  const derivedImageWorkflows = (workflowState.imageWorkflows || []).filter((graph) =>
    String(graph.id || "").startsWith("asset-flow-chapter-001"),
  );
  const derivedImageWorkflowsReady = derivedImageWorkflows.filter((graph) =>
    (graph.nodes || []).some((node) => node.type === "reference" && node.imageUrl) &&
    (graph.nodes || []).some((node) => node.type === "generated" && node.resultUrl) &&
    (graph.edges || []).length > 0,
  );
  const chapterStoryboards = (workflowState.storyboards || []).filter(
    (candidate) => candidate.episodeId === daojieChapterId,
  );
  const storyboardImageWorkflows = (workflowState.imageWorkflows || []).filter((graph) =>
    String(graph.id || "").startsWith(`storyboard-flow-${daojieChapterId}-`),
  );
  const storyboardImageWorkflowsReady = storyboardImageWorkflows.filter((graph) => {
    const referenceNodes = (graph.nodes || []).filter((node) => node.type === "reference" && node.imageUrl);
    const generatedNode = (graph.nodes || []).find((node) => node.type === "generated" && node.resultUrl);
    if (!generatedNode || referenceNodes.length === 0) return false;
    const edgeKeys = new Set((graph.edges || []).map((edge) => `${edge.source}->${edge.target}`));
    return referenceNodes.every((node) => edgeKeys.has(`${node.id}->${generatedNode.id}`));
  });
  return {
    storyboardsWithWorkflow: chapterStoryboards.filter((storyboard) =>
      Boolean(storyboard.imageWorkflowId || storyboard.mediaRef?.imageWorkflowId),
    ).length,
    storyboardImageWorkflows: storyboardImageWorkflows.length,
    storyboardImageWorkflowsReady: storyboardImageWorkflowsReady.length,
    derivedAssetPlan: derivedAssetPlan.length,
    derivedAssets:
      derivedCharacterVariations.length + derivedScenes.length + derivedProps.length,
    derivedCharacterVariations: derivedCharacterVariations.length,
    derivedScenes: derivedScenes.length,
    derivedProps: derivedProps.length,
    derivedImageWorkflows: derivedImageWorkflows.length,
    derivedImageWorkflowsReady: derivedImageWorkflowsReady.length,
  };
}

const realDaojieRun = runRealDaojie ? cloneRealDaojieUserData() : null;
const userDataDir =
  realDaojieRun?.userDataDir ||
  process.env.MYSTUDIO_SMOKE_USER_DATA_DIR ||
  mkdtempSync(resolve(tmpdir(), "mystudio-smoke-visible-run-"));

stopExistingMYStudioInstances();
prepareSmokeMedia();
const focusSamples = [];
if (runInBackground) {
  focusSamples.push(sampleFrontmostApplication("before app launch"));
}

function readJson(url) {
  return new Promise((resolveJson, reject) => {
    const req = http.get(url, (response) => {
      let data = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        data += chunk;
      });
      response.on("end", () => {
        try {
          resolveJson(JSON.parse(data));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
  });
}

async function waitForPageTarget() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const targets = await readJson(`http://127.0.0.1:${debugPort}/json/list`);
      const page = Array.isArray(targets)
        ? targets.find((target) => target.type === "page")
        : null;
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // Electron opens the debugging port after startup.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error("No Electron page target appeared on the debugging port.");
}

function bringAppToForeground(pid) {
  if (process.platform !== "darwin" || !pid) return;
  const script = `tell application "System Events" to set frontmost of first process whose unix id is ${pid} to true`;
  const result = spawnSync("osascript", ["-e", script], { stdio: "ignore" });
  if (result.status !== 0) {
    console.warn(
      "[visible-run] failed to bring app to foreground; macOS may require Automation or Accessibility permission",
    );
  }
}

function getFrontmostApplicationName() {
  if (process.platform !== "darwin") return "";
  const result = spawnSync(
    "osascript",
    [
      "-e",
      'tell application "System Events" to get name of first application process whose frontmost is true',
    ],
    { encoding: "utf8" },
  );
  return result.status === 0 ? result.stdout.trim() : "";
}

async function ensureAppIsForeground(pid, reason) {
  if (process.platform !== "darwin" || !pid) return "";
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    bringAppToForeground(pid);
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    const frontmostApp = getFrontmostApplicationName();
    if (frontmostApp === appProcessName) {
      console.log(`[visible-run] foreground ok: ${reason}`);
      return frontmostApp;
    }
  }
  const frontmostApp = getFrontmostApplicationName();
  console.warn(
    `[visible-run] app is not foreground after ${reason}: frontmostApp=${frontmostApp || "unknown"}`,
  );
  return frontmostApp;
}

function nudgeAppToForeground(pid, reason) {
  if (process.platform !== "darwin" || !pid) return;
  bringAppToForeground(pid);
  console.log(`[visible-run] foreground request: ${reason}`);
}

function connectWebSocket(url) {
  return new Promise((resolveSocket, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => resolveSocket(socket));
    socket.addEventListener("error", reject);
  });
}

function rejectPending(pending, reason) {
  for (const [, callback] of pending.entries()) {
    callback.reject(reason);
  }
  pending.clear();
}

function withTimeout(promise, label, timeoutMs = 120_000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runVisibleWorkflow(pageTarget, childPid, focusSamples) {
  const socket = await connectWebSocket(pageTarget.webSocketDebuggerUrl);
  let messageId = 0;
  const pending = new Map();
  const runtimeProblems = [];

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.consoleAPICalled") {
      const text = (message.params?.args || [])
        .map((arg) => arg.value ?? arg.description ?? arg.unserializableValue)
        .filter((value) => typeof value === "string")
        .join(" ");
      if (text.startsWith("[visible-run]")) {
        if (text.includes("stage")) {
          if (runInBackground) {
            focusSamples.push(sampleFrontmostApplication(text));
          } else {
            nudgeAppToForeground(childPid, text);
          }
        }
        console.log(text);
      }
      if (message.params?.type === "error") {
        runtimeProblems.push(text || "consoleAPICalled error");
        console.error(`[visible-run] console.error ${text || "unknown"}`);
      }
      return;
    }
    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params?.exceptionDetails;
      const exceptionText =
        details?.exception?.description ||
        details?.exception?.value ||
        details?.text ||
        "Runtime.exceptionThrown";
      runtimeProblems.push(String(exceptionText));
      console.error(`[visible-run] Runtime.exceptionThrown ${exceptionText}`);
      return;
    }
    if (message.method === "Log.entryAdded") {
      const entry = message.params?.entry;
      if (entry?.level === "error") {
        const text = entry.text || "Log.entryAdded error";
        runtimeProblems.push(String(text));
        console.error(`[visible-run] Log.entryAdded ${text}`);
      }
      return;
    }
    if (!message.id || !pending.has(message.id)) return;
    const callback = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      callback.reject(new Error(JSON.stringify(message.error)));
    } else {
      callback.resolve(message.result);
    }
  });
  socket.addEventListener("close", () => {
    rejectPending(pending, new Error("CDP socket closed during visible workflow run"));
  });
  socket.addEventListener("error", () => {
    rejectPending(pending, new Error("CDP socket errored during visible workflow run"));
  });

  const send = (method, params = {}) =>
    new Promise((resolveResult, reject) => {
      const id = ++messageId;
      pending.set(id, { resolve: resolveResult, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  try {
    await send("Runtime.enable");
    await send("Log.enable");
    await send("Page.enable");
    if (!runInBackground) {
      await send("Page.bringToFront");
      await ensureAppIsForeground(childPid, "before workflow clicks");
    }
    const expression = runRealDaojie
      ? realDaojieWorkflowExpression(
          safeStepDelayMs,
          realDaojieRun,
          runChapterAutoVideo,
          safeAutoVideoTimeoutMs,
          !runInBackground,
        )
      : visibleWorkflowExpression(safeStepDelayMs, !runInBackground);
    const evaluated = await withTimeout(
      send("Runtime.evaluate", {
        awaitPromise: true,
        returnByValue: true,
        expression,
      }),
      "visible step-by-step workflow run",
      runChapterAutoVideo ? safeAutoVideoTimeoutMs + 180_000 : 120_000,
    );
    const pageFocus = await send("Runtime.evaluate", {
      returnByValue: true,
      expression: `({
        windowVisibility: document.visibilityState,
        documentHasFocus: document.hasFocus(),
      })`,
    });
    return {
      ...evaluated.result.value,
      ...pageFocus.result.value,
      runtimeProblems,
    };
  } finally {
    rejectPending(pending, new Error("CDP socket closed during visible workflow cleanup"));
    socket.close();
  }
}

function visibleWorkflowExpression(delayMs, focusWindow) {
  const focusWindowStatement = focusWindow ? "window.focus();" : "";
  return `(async () => {
    const backgroundMode = ${!focusWindow};
    const normalize = (node) => (node.textContent || '').replace(/\\s+/g, ' ').trim();
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const visibleDelay = () => wait(${delayMs});
    const activate = (node) => {
      if (!node) return false;
      node.scrollIntoView?.({ block: 'center', inline: 'center' });
      if (backgroundMode && typeof node.click === 'function') {
        node.click();
      } else {
        node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, pointerType: 'mouse' }));
        node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, view: window }));
        node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 0, pointerType: 'mouse' }));
        node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, view: window }));
        node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, view: window }));
      }
      return true;
    };
    const clickText = (text, exact = false) => {
      const candidates = Array.from(document.querySelectorAll('button, [role="menuitem"], [cmdk-item], .dashboard-project-card'));
      const node = candidates.find((candidate) => {
        const normalized = normalize(candidate);
        return exact ? normalized === text : normalized.includes(text);
      });
      return { clicked: activate(node), text: node ? normalize(node) : '' };
    };
    const waitFor = async (predicate, timeout = 10_000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await wait(200);
      }
      return null;
    };
    const clickStage = async (stage) => {
      if (backgroundMode) {
        const changed = await window.mystudioWorkflowSmoke?.setWorkflowStage?.(stage.id);
        await visibleDelay();
        return { clicked: Boolean(changed), text: changed ? 'background-bridge:' + stage.label : '' };
      }
      console.info('[visible-run] stage ' + stage.id + ' opening switcher');
      ${focusWindowStatement}
      const switcherClick = clickText('切换阶段');
      console.info('[visible-run] stage ' + stage.id + ' switcher=' + Boolean(switcherClick.clicked));
      await visibleDelay();
      await waitFor(() => Array.from(document.querySelectorAll('button, [role="menuitem"], [cmdk-item]')).some((node) => normalize(node).includes(stage.label)), 2_000);
      const clicked =
        stage.id === 'manuals' ? clickText('风格与导演') :
        stage.id === 'novel' ? clickText('小说导入') :
        stage.id === 'script' ? clickText('剧本生产阶段') :
        stage.id === 'assets' ? clickText('剧本资产管理') :
        stage.id === 'storyboard' ? clickText('分镜视频生成') :
        stage.id === 'workbench' ? clickText('视频工作台') :
        { clicked: false, text: '' };
      console.info('[visible-run] stage ' + stage.id + ' clicked ' + (clicked.text || 'missing'));
      await window.mystudioWorkflowSmoke?.setWorkflowStage?.(stage.id);
      await visibleDelay();
      return clicked;
    };
    const primeVisibleStageForFirstClick = async () => {
      console.info('[visible-run] stage prime workbench before first click');
      await window.mystudioWorkflowSmoke?.setWorkflowStage?.('workbench');
      await visibleDelay();
    };

    const projectCard = await waitFor(() => document.querySelector('.dashboard-project-card'), 15_000);
    if (projectCard) {
      activate(projectCard);
      await visibleDelay();
    }
    await waitFor(() => Array.from(document.querySelectorAll('button, [role="button"]')).some((node) => normalize(node) === '工作流'), 15_000);
    const workflowClick = clickText('工作流', true);
    await visibleDelay();
    await waitFor(() => Array.from(document.querySelectorAll('button, [role="button"]')).some((node) => normalize(node).includes('切换阶段')), 15_000);
    await waitFor(() => window.mystudioWorkflowSmoke?.resetForStepwiseExecution, 15_000);
    const reset = await window.mystudioWorkflowSmoke?.resetForStepwiseExecution?.();
    await visibleDelay();
    await primeVisibleStageForFirstClick();

    const stages = [
      { id: 'manuals', label: '风格与导演' },
      { id: 'novel', label: '小说导入' },
      { id: 'script', label: '剧本生产阶段' },
      { id: 'assets', label: '剧本资产管理' },
      { id: 'storyboard', label: '分镜视频生成' },
      { id: 'workbench', label: '视频工作台' },
    ];
    const results = [];
    for (const stage of stages) {
      console.info('[visible-run] stage ' + stage.id + ' start ' + stage.label);
      const stageClick = await clickStage(stage);
      const before = await window.mystudioWorkflowSmoke?.inspectWorkflowStages?.();
      const run = await window.mystudioWorkflowSmoke?.runStepwiseWorkflowStage?.(stage.id);
      await visibleDelay();
      const ready = await waitFor(async () => {
        const inspected = await window.mystudioWorkflowSmoke?.inspectWorkflowStages?.();
        const item = inspected?.stages?.find((candidate) => candidate.id === stage.id);
        return item?.status === 'ready' ? inspected : null;
      }, 8_000);
      await visibleDelay();
      console.info('[visible-run] stage ' + stage.id + ' ready=' + Boolean(ready) + ' progress=' + (ready?.progress ?? run?.progress ?? 'unknown'));
      results.push({
        id: stage.id,
        label: stage.label,
        clicked: Boolean(stageClick.clicked),
        clickedText: stageClick.text,
        beforeProgress: before?.progress ?? null,
        afterProgress: ready?.progress ?? run?.progress ?? null,
        ready: Boolean(ready?.stages?.find((item) => item.id === stage.id && item.status === 'ready')),
        evidence: run?.evidence?.summary || '',
      });
    }
    const finalInspection = await window.mystudioWorkflowSmoke?.inspectWorkflowStages?.();
    return {
      source: finalInspection?.source || reset?.source || 'missing',
      clickedWorkflow: workflowClick.clicked,
      progress: finalInspection?.progress ?? null,
      completed: finalInspection?.progress === 100,
      results,
    };
  })()`;
}

function realDaojieWorkflowExpression(
  delayMs,
  daojieRun,
  autoVideoEnabled,
  autoVideoTimeoutMs,
  focusWindow,
) {
  const projectId = JSON.stringify(daojieRun.projectId);
  const projectName = JSON.stringify(daojieRun.projectName);
  const chapterId = JSON.stringify(daojieRun.chapterId);
  const chapterTitle = JSON.stringify(daojieRun.chapterTitle);
  const expectedStoryboards = Number(daojieRun.expectedStoryboards);
  const focusWindowStatement = focusWindow ? "window.focus();" : "";
  return `(async () => {
    // Daojie mode does not use resetForStepwiseExecution or seed smoke data.
    const backgroundMode = ${!focusWindow};
    const projectId = ${projectId};
    const projectName = ${projectName};
    const chapterId = ${chapterId};
    const chapterTitle = ${chapterTitle};
    const expectedStoryboards = ${expectedStoryboards};
    const autoVideoEnabled = ${Boolean(autoVideoEnabled)};
    const autoVideoTimeoutMs = ${Number(autoVideoTimeoutMs)};
    const normalize = (node) => (node.textContent || '').replace(/\\s+/g, ' ').trim();
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const visibleDelay = () => wait(${delayMs});
    const activate = (node) => {
      if (!node) return false;
      node.scrollIntoView?.({ block: 'center', inline: 'center' });
      if (backgroundMode && typeof node.click === 'function') {
        node.click();
      } else {
        node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, pointerType: 'mouse' }));
        node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, view: window }));
        node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 0, pointerType: 'mouse' }));
        node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, view: window }));
        node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, view: window }));
      }
      return true;
    };
    const clickText = (text, exact = false) => {
      const candidates = Array.from(document.querySelectorAll('button, [role="menuitem"], [cmdk-item], [role="button"], .dashboard-project-card'));
      const node = candidates.find((candidate) => {
        const normalized = normalize(candidate);
        return exact ? normalized === text : normalized.includes(text);
      });
      return { clicked: activate(node), text: node ? normalize(node) : '' };
    };
    const captureVisibleWorkflowDomEvidence = () => {
      const interactive = Array.from(document.querySelectorAll('button, [role="menuitem"], [cmdk-item], [role="button"], .dashboard-project-card'));
      const buttonTexts = interactive.map(normalize).filter(Boolean).slice(0, 80);
      const bodyText = normalize(document.body).slice(0, 1600);
      const storyboardWorkflowEntries = Array.from(document.querySelectorAll('[data-storyboard-id]'));
      const storyboardWorkflowEntryIds = [...new Set(storyboardWorkflowEntries.map((entry) => entry.getAttribute('data-storyboard-id') || '').filter(Boolean))];
      return {
        buttonTexts,
        bodyText,
        storyboardWorkflowEntryCount: storyboardWorkflowEntryIds.length,
        hasLastStoryboardWorkflowEntry: Boolean(document.querySelector('[aria-label="打开分镜 ' + expectedStoryboards + ' 图片工作流"]')),
        hasStageSwitcher: buttonTexts.some((text) => text.includes('切换阶段')),
        hasWorkflowTab: buttonTexts.some((text) => text === '工作流' || text.includes('工作流')),
        hasProjectCard: Boolean(document.querySelector('.dashboard-project-card')),
        title: document.title,
        url: location.href,
      };
    };
    const captureStoryboardPaletteImageEvidence = () => {
      const section = Array.from(document.querySelectorAll('section')).find((candidate) => {
        const title = candidate.querySelector('h4');
        return title ? normalize(title) === '分镜成图' : false;
      });
      const cards = Array.from(section?.querySelectorAll('button') || []);
      const firstCards = cards.slice(0, 24).map((card, index) => {
        const text = normalize(card);
        const img = card.querySelector('img');
        const naturalWidth = img?.naturalWidth || 0;
        const naturalHeight = img?.naturalHeight || 0;
        const hasFailureText = text.includes('图片加载失败');
        const loaded = Boolean(img && img.complete && naturalWidth > 0 && naturalHeight > 0 && !hasFailureText);
        const failureReason = hasFailureText
          ? '图片加载失败'
          : !img
            ? 'missing image element'
            : img.complete && (naturalWidth <= 0 || naturalHeight <= 0)
              ? 'zero natural size'
              : '';
        return {
          index,
          text,
          src: img?.currentSrc || img?.src || '',
          hasImage: Boolean(img),
          complete: Boolean(img?.complete),
          naturalWidth,
          naturalHeight,
          loaded,
          failureReason,
        };
      });
      const failedCards = firstCards.filter((card) => card.failureReason);
      const loadedCardCount = firstCards.filter((card) => card.loaded).length;
      const hasFailureText = Boolean(section && normalize(section).includes('图片加载失败'));
      const requiredVisibleCards = Math.min(expectedStoryboards, 24);
      return {
        ready: Boolean(section) && cards.length >= requiredVisibleCards && loadedCardCount >= requiredVisibleCards && failedCards.length === 0 && !hasFailureText,
        sectionFound: Boolean(section),
        cardCount: cards.length,
        loadedCardCount,
        requiredVisibleCards,
        failedCards,
        firstCards: firstCards.slice(0, 4),
        hasFailureText,
      };
    };
    const waitFor = async (predicate, timeout = 15_000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await wait(250);
      }
      return null;
    };
    const readJsonStore = async (key) => {
      const raw = await window.fileStorage?.getItem?.(key);
      return raw ? JSON.parse(raw) : null;
    };
    const inspectDaojieProjectData = async () => {
      const projectStore = await readJsonStore('mystudio-project-store');
      const workflowStore = await readJsonStore('_p/' + projectId + '/studio-workflow-store');
      const charactersStore = await readJsonStore('_p/' + projectId + '/characters');
      const scenesStore = await readJsonStore('_p/' + projectId + '/scenes');
      const propsStore = await readJsonStore('_p/' + projectId + '/props');
      const workflowState = workflowStore?.state || {};
      const characters = charactersStore?.state?.characters || [];
      const scenes = scenesStore?.state?.scenes || [];
      const props = propsStore?.state?.items || [];
      const workflowConfig = workflowState.workflowConfig || {};
      const project = (projectStore?.state?.projects || []).find((candidate) => candidate.id === projectId);
      const chapter = (workflowState.novelChapters || []).find((candidate) => candidate.id === chapterId);
       const storyboards = (workflowState.storyboards || []).filter((candidate) => candidate.episodeId === chapterId);
       const productionTracks = (workflowState.productionTracks || []).filter((candidate) => candidate.episodeId === chapterId);
      const productionTrackIds = new Set(productionTracks.map((track) => track.id));
      const videoCandidates = (workflowState.videoCandidates || []).filter(
        (candidate) =>
          productionTrackIds.has(candidate.trackId) ||
          String(candidate.id || '').includes(chapterId) ||
          String(candidate.trackId || '').includes(chapterId),
      );
      const scriptPlans = (workflowState.scriptPlans || []).filter((candidate) => !candidate.episodeId || candidate.episodeId === chapterId);
      const entityExtractions = (workflowState.entityExtractions || []).filter((candidate) => !candidate.episodeId || candidate.episodeId === chapterId);
      const agentWorkData = (workflowState.agentWorkData || []).filter((candidate) => !candidate.episodeId || candidate.episodeId === chapterId);
       const storyboardsWithMediaPath = storyboards.filter((candidate) => Boolean(candidate.mediaRef?.path));
       const storyboardsWithWorkflow = storyboards.filter((candidate) => Boolean(candidate.imageWorkflowId || candidate.mediaRef?.imageWorkflowId));
       const totalStoryboardDuration = storyboards.reduce((sum, storyboard) => sum + Number(storyboard.duration || 0), 0);
      const totalTrackDuration = productionTracks.reduce((sum, track) => sum + Number(track.duration || 0), 0);
      const derivedAssetPlan = scriptPlans.flatMap((plan) => plan.derivedAssetPlan || []);
      const derivedCharacterVariations = characters.flatMap((character) =>
        (character.variations || []).filter((variation) => Boolean(variation.imageWorkflowId && variation.referenceImage)),
      );
      const derivedScenes = scenes.filter((scene) => Boolean(scene.parentSceneId && scene.imageWorkflowId && scene.referenceImage));
      const derivedProps = props.filter((prop) => Boolean(prop.parentId && prop.imageWorkflowId && prop.imageUrl));
      const derivedWorkflows = (workflowState.imageWorkflows || []).filter((graph) =>
        String(graph.id || '').startsWith('asset-flow-chapter-001'),
      );
       const derivedWorkflowsWithReferenceAndResult = derivedWorkflows.filter((graph) =>
         (graph.nodes || []).some((node) => node.type === 'reference' && node.imageUrl) &&
         (graph.nodes || []).some((node) => node.type === 'generated' && node.resultUrl) &&
         (graph.edges || []).length > 0,
       );
       const storyboardImageWorkflows = (workflowState.imageWorkflows || []).filter((graph) =>
         String(graph.id || '').startsWith('storyboard-flow-' + chapterId + '-'),
       );
       const storyboardImageWorkflowsReady = storyboardImageWorkflows.filter((graph) => {
         const referenceNodes = (graph.nodes || []).filter((node) => node.type === 'reference' && node.imageUrl);
         const generatedNode = (graph.nodes || []).find((node) => node.type === 'generated' && node.resultUrl);
         if (!generatedNode || referenceNodes.length === 0) return false;
         const edgeKeys = new Set((graph.edges || []).map((edge) => edge.source + '->' + edge.target));
         return referenceNodes.every((node) => edgeKeys.has(node.id + '->' + generatedNode.id));
       });
       return {
        source: 'real-daojie-chapter001-clone',
        projectId,
        projectName: project?.name || projectName,
        activeProjectId: projectStore?.state?.activeProjectId || '',
        chapterId: chapter?.id || '',
        chapterTitle: chapter?.title || '',
        sourceLength: chapter?.sourceText?.length || 0,
        manualsReady: Boolean(workflowConfig.visualManualId || workflowConfig.directorManualId),
        scriptPlans: scriptPlans.length,
        entityExtractions: entityExtractions.length,
        agentWorkItems: agentWorkData.length,
         storyboards: storyboards.length,
         expectedStoryboards,
         storyboardsWithMediaPath: storyboardsWithMediaPath.length,
         storyboardsWithWorkflow: storyboardsWithWorkflow.length,
         storyboardImageWorkflows: storyboardImageWorkflows.length,
         storyboardImageWorkflowsReady: storyboardImageWorkflowsReady.length,
         totalStoryboardDuration,
        totalTrackDuration,
        productionTracks: productionTracks.length,
        videoCandidates: videoCandidates.length,
        derivedAssetPlan: derivedAssetPlan.length,
        derivedAssets: derivedCharacterVariations.length + derivedScenes.length + derivedProps.length,
        derivedCharacterVariations: derivedCharacterVariations.length,
        derivedScenes: derivedScenes.length,
        derivedProps: derivedProps.length,
        derivedImageWorkflows: derivedWorkflows.length,
        derivedImageWorkflowsReady: derivedWorkflowsWithReferenceAndResult.length,
        firstFramePath: storyboards[0]?.mediaRef?.path || '',
        finalVideoPath: videoCandidates.find((candidate) => String(candidate.filePath || '').includes('toonflow_workflow'))?.filePath || videoCandidates[0]?.filePath || '',
        hasSmokeTemplate: normalize(document.body).includes('Smoke 第一章') || chapter?.title?.includes('Smoke') || false,
      };
    };
    const verifyRealDaojieStageEvidence = (stage, data) => {
      const domEvidence = captureVisibleWorkflowDomEvidence();
      const body = domEvidence.bodyText;
      const manualsReady = data.manualsReady || body.includes('视觉') || body.includes('导演');
      const novelReady = data.chapterId === chapterId && data.chapterTitle === chapterTitle && data.sourceLength >= 9000;
      const scriptReady = data.scriptPlans > 0 || data.agentWorkItems > 0 || body.includes('故事骨架') || body.includes('剧本');
      const derivedReady =
        data.derivedAssetPlan >= 3 &&
        data.derivedAssets >= 3 &&
        data.derivedImageWorkflows >= 3 &&
        data.derivedImageWorkflowsReady >= 3;
      const assetsReady = data.entityExtractions > 0 || body.includes('资产生成') || body.includes('剧本资产');
      const storyboardReady =
        data.storyboards === ${expectedStoryboards} &&
        data.storyboardsWithMediaPath === ${expectedStoryboards} &&
        data.storyboardsWithWorkflow === ${expectedStoryboards} &&
        data.storyboardImageWorkflowsReady === ${expectedStoryboards} &&
        domEvidence.storyboardWorkflowEntryCount >= ${expectedStoryboards} &&
        domEvidence.hasLastStoryboardWorkflowEntry &&
        Boolean(data.firstFramePath);
      const workbenchReady = data.productionTracks >= 1 && data.videoCandidates >= 1 && (body.includes('添加 track') || body.includes('导出成片') || Boolean(data.finalVideoPath));
      const ready =
        stage.id === 'manuals' ? manualsReady :
        stage.id === 'novel' ? novelReady :
        stage.id === 'script' ? scriptReady :
        stage.id === 'assets' ? assetsReady :
        stage.id === 'storyboard' ? storyboardReady :
        stage.id === 'workbench' ? workbenchReady :
        false;
      return { ready, domEvidence, manualsReady, workbenchReady, derivedReady };
    };
    const clickStage = async (stage) => {
      if (backgroundMode) {
        const changed = await window.mystudioWorkflowSmoke?.setWorkflowStage?.(stage.id);
        await visibleDelay();
        return { clicked: Boolean(changed), text: changed ? 'background-bridge:' + stage.label : '' };
      }
      console.info('[visible-run] stage ' + stage.id + ' opening switcher');
      ${focusWindowStatement}
      const switcherClick = clickText('切换阶段');
      console.info('[visible-run] stage ' + stage.id + ' switcher=' + Boolean(switcherClick.clicked));
      await visibleDelay();
      await waitFor(() => Array.from(document.querySelectorAll('button, [role="menuitem"], [cmdk-item], [role="button"]')).some((node) => normalize(node).includes(stage.label)), 2_000);
      const clicked =
        stage.id === 'manuals' ? clickText('风格与导演') :
        stage.id === 'novel' ? clickText('小说导入') :
        stage.id === 'script' ? clickText('剧本生产阶段') :
        stage.id === 'assets' ? clickText('剧本资产管理') :
        stage.id === 'storyboard' ? clickText('分镜视频生成') :
        stage.id === 'workbench' ? clickText('视频工作台') :
        { clicked: false, text: '' };
      await visibleDelay();
      console.info('[visible-run] stage ' + stage.id + ' clicked ' + (clicked.text || 'missing'));
      return clicked;
    };
    const captureChapterAutoVideoStatus = () => {
      const statusNode = document.querySelector('[data-auto-video-stage]');
      const finalPathButton = Array.from(document.querySelectorAll('button[title]'))
        .find((node) => normalize(node).includes('打开最终 MP4'));
      return {
        stage: statusNode?.getAttribute('data-auto-video-stage') || '',
        statusText: statusNode ? normalize(statusNode) : '',
        finalPath: finalPathButton?.getAttribute('title') || '',
        hasFinalPathButton: Boolean(finalPathButton),
      };
    };
    const runChapterAutoVideoFlow = async () => {
      if (!autoVideoEnabled) return { enabled: false };
      const storyboardClick = await clickStage({ id: 'storyboard', label: '分镜视频生成' });
      const preClickStatus = captureChapterAutoVideoStatus();
      const startedAtMs = Date.now();
      const actionClick = clickText('一键第一章成片', true);
      const stageHistory = [];
      let lastStage = '';
      const terminal = actionClick.clicked
        ? await waitFor(() => {
            const current = captureChapterAutoVideoStatus();
            if (current.stage && current.stage !== lastStage) {
              lastStage = current.stage;
              stageHistory.push({
                stage: current.stage,
                text: current.statusText,
                observedAt: new Date().toISOString(),
              });
              console.info('[visible-run] auto-video stage ' + current.stage + ' ' + current.statusText);
            }
            return current.stage === 'completed' || current.stage === 'failed'
              ? current
              : null;
          }, autoVideoTimeoutMs)
        : null;
      const finalStatus = terminal || captureChapterAutoVideoStatus();
      let finalVideoEvidence = null;
      let finalVideoEvidenceError = '';
      if (finalStatus.stage === 'completed' && finalStatus.finalPath) {
        try {
          if (!window.studioRenderer?.probeMedia) {
            throw new Error('studioRenderer.probeMedia is unavailable');
          }
          finalVideoEvidence = await window.studioRenderer.probeMedia(finalStatus.finalPath);
        } catch (error) {
          finalVideoEvidenceError = error instanceof Error ? error.message : String(error);
        }
      }
      return {
        enabled: true,
        stageClicked: Boolean(storyboardClick.clicked),
        clicked: Boolean(actionClick.clicked),
        clickedText: actionClick.text,
        preClickStage: preClickStatus.stage,
        startedAtMs,
        stageHistory,
        hasPostClickStageTransition: stageHistory.some(
          (entry) => entry.stage && entry.stage !== preClickStatus.stage,
        ),
        terminalStage: finalStatus.stage,
        statusText: finalStatus.statusText,
        finalPath: finalStatus.finalPath,
        hasFinalPathButton: finalStatus.hasFinalPathButton,
        finalVideoEvidence,
        finalVideoEvidenceError,
        timedOut: Boolean(actionClick.clicked && !terminal),
      };
    };
    const openRealDaojieDerivativeImageWorkflowDetail = async () => {
      const storyboardClick = await clickStage({ id: 'storyboard', label: '分镜视频生成' });
      await visibleDelay();
      const workflowEntry = Array.from(document.querySelectorAll('[data-asset-workflow-image-id]'))
        .find((node) => String(node.getAttribute('data-asset-workflow-image-id') || '').startsWith('asset-flow-chapter-001'));
      const workflowId = workflowEntry?.getAttribute('data-asset-workflow-image-id') || '';
      const workflowName = workflowEntry?.getAttribute('data-asset-workflow-name') || '';
      const clicked = activate(workflowEntry);
      if (!clicked) {
        return {
          ready: false,
          clicked: false,
          workflowId,
          workflowName,
          stageClicked: Boolean(storyboardClick.clicked),
          reason: 'real Daojie derived asset workflow image entry was not found',
        };
      }
      const captureDetail = () => {
        const text = document.body.innerText || '';
        const visibleRect = (node) => {
          if (!node) return null;
          const rect = node.getBoundingClientRect();
          const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
          const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
          return {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            visible:
              rect.width > 0 &&
              rect.height > 0 &&
              rect.right > 0 &&
              rect.bottom > 0 &&
              rect.left < viewportWidth &&
              rect.top < viewportHeight,
          };
        };
        const buttonTexts = Array.from(document.querySelectorAll('button')).map((node) => normalize(node));
        const inputValues = Array.from(document.querySelectorAll('input')).map((node) => node.value || '');
        const referenceNode = document.querySelector('[data-image-workflow-node-kind="reference"]');
        const generatedNode = document.querySelector('[data-image-workflow-node-kind="generated"]');
        const referenceNodeText = referenceNode ? normalize(referenceNode) : '';
        const generatedNodeText = generatedNode ? normalize(generatedNode) : '';
        const referenceInputValues = referenceNode
          ? Array.from(referenceNode.querySelectorAll('input')).map((node) => node.value || '')
          : [];
        const generatedInputValues = generatedNode
          ? Array.from(generatedNode.querySelectorAll('input')).map((node) => node.value || '')
          : [];
        const hasReferenceNode = Boolean(referenceNode) && (
          referenceNodeText.includes('参考') ||
          referenceInputValues.some((value) => value.trim().length > 0) ||
          Boolean(referenceNode.querySelector('img'))
        );
        const hasGeneratedNode = Boolean(generatedNode) && (
          generatedNodeText.includes('成图') ||
          generatedNodeText.includes('生成结果') ||
          generatedInputValues.some((value) => value.includes('成图') || value.includes('生成结果'))
        );
        const hasAssetWritebackTarget = text.includes('回写目标');
        const hasImageWorkflowCanvas = Boolean(document.querySelector('.react-flow'));
        const imageWorkflowNodeCount = document.querySelectorAll('.react-flow__node').length;
        const hasImageWorkflowNodes = imageWorkflowNodeCount >= 3;
        const hasImageWorkflowPromptNode = Boolean(document.querySelector('[data-image-workflow-node-kind="prompt"]'));
        const generatedPromptPanel = generatedNode?.querySelector('[data-toonflow-generated-prompt-panel]');
        const canvasRect = visibleRect(document.querySelector('.react-flow'));
        const generatedNodeRect = visibleRect(generatedNode);
        const generatedPromptPanelRect = visibleRect(generatedPromptPanel);
        const hasVisibleImageWorkflowCanvas = Boolean(canvasRect?.visible && canvasRect.width >= 480 && canvasRect.height >= 320);
        const hasVisibleGeneratedNode = Boolean(generatedNodeRect?.visible && generatedNodeRect.width >= 180 && generatedNodeRect.height >= 120);
        const hasVisibleDuplicateGeneratedPromptPanel = hasImageWorkflowPromptNode && Boolean(generatedPromptPanelRect?.visible && generatedPromptPanelRect.width >= 180 && generatedPromptPanelRect.height >= 80);
        const generatedPromptTextValues = generatedPromptPanel
          ? Array.from(generatedPromptPanel.querySelectorAll('textarea')).map((node) => node.value || '')
          : [];
        const promptNodeTextValues = Array.from(document.querySelectorAll('[data-image-workflow-node-kind="prompt"] textarea')).map((node) => node.value || '');
        const promptTextValues = hasImageWorkflowPromptNode ? promptNodeTextValues : generatedPromptTextValues;
        const hasNoDuplicateGeneratedPromptPanel = !(hasImageWorkflowPromptNode && Boolean(generatedPromptPanel));
        const hasNoVisibleDuplicateGeneratedPromptPanel = !hasVisibleDuplicateGeneratedPromptPanel;
        const hasEditableImageWorkflowPrompt = promptTextValues.some((value) => value.trim().length > 0);
        const hasDaojieDerivativePromptStyle = promptTextValues.some((value) =>
          value.includes('水墨国风修仙') &&
          value.includes('@图1') &&
          value.includes('禁止写实摄影') &&
          value.includes('禁止3D写实渲染')
        );
        const hasImageWorkflowSource = text.includes('来源') && text.includes('分镜视频生成') && text.includes('衍生资产');
        const imageWorkflowScope = document.querySelector('[data-scoped-image-workflow-summary]')?.closest('section') || document;
        const scopedButtonTexts = Array.from(imageWorkflowScope.querySelectorAll('button')).map((node) => normalize(node));
        const scopedText = imageWorkflowScope.innerText || '';
        const hasScopedImageWorkflowSummary = Boolean(imageWorkflowScope.querySelector('[data-scoped-image-workflow-summary]'));
        const hasNoGlobalImageWorkflowControls =
          !imageWorkflowScope.querySelector('[data-image-workflow-selector]') &&
          !imageWorkflowScope.querySelector('[data-image-workflow-global-action]');
        const hasNoGlobalImageWorkflowPalettes = !scopedText.includes('项目参考图');
        const hasImageWorkflowBackButton = scopedButtonTexts.some((text) => text === '返回');
        const hasImageWorkflowRunAction = scopedButtonTexts.some((text) => text.includes('运行生成'));
        const hasImageWorkflowWritebackAction = scopedButtonTexts.some((text) => text.includes('写回目标'));
        const checks = {
          hasReferenceNode,
          hasGeneratedNode,
          hasAssetWritebackTarget,
          hasImageWorkflowCanvas,
          hasVisibleImageWorkflowCanvas,
          hasImageWorkflowNodes,
          hasImageWorkflowPromptNode,
          hasNoDuplicateGeneratedPromptPanel,
          hasVisibleGeneratedNode,
          hasNoVisibleDuplicateGeneratedPromptPanel,
          hasEditableImageWorkflowPrompt,
          hasDaojieDerivativePromptStyle,
          hasImageWorkflowSource,
          hasScopedImageWorkflowSummary,
          hasNoGlobalImageWorkflowControls,
          hasNoGlobalImageWorkflowPalettes,
          hasImageWorkflowBackButton,
          hasImageWorkflowRunAction,
          hasImageWorkflowWritebackAction,
        };
        const missingChecks = Object.entries(checks)
          .filter(([, passed]) => !passed)
          .map(([name]) => name);
        return { ready: missingChecks.length === 0, ...checks, missingChecks, imageWorkflowNodeCount, canvasRect, generatedNodeRect, generatedPromptPanelRect, inputValues, promptTextValues, generatedPromptTextValues, referenceNodeText, generatedNodeText };
      };
      const detail = await waitFor(() => {
        const evidence = captureDetail();
        return evidence.ready ? evidence : null;
      }, 20_000) || captureDetail();
      const storyboardPaletteImages = await waitFor(() => {
        const evidence = captureStoryboardPaletteImageEvidence();
        return evidence.ready ? evidence : null;
      }, 8_000) || captureStoryboardPaletteImageEvidence();
      return {
        ready: Boolean(detail?.ready) && !storyboardPaletteImages.sectionFound,
        clicked: true,
        workflowId,
        workflowName,
        stageClicked: Boolean(storyboardClick.clicked),
        detail,
        storyboardPaletteImages,
      };
    };
    const openRealDaojieStoryboardImageWorkflowDetail = async () => {
      const storyboardClick = await clickStage({ id: 'storyboard', label: '分镜视频生成' });
      await visibleDelay();
      const workflowEntry = document.querySelector('[data-storyboard-workflow-image-id]');
      const workflowId = workflowEntry?.getAttribute('data-storyboard-workflow-image-id') || '';
      const storyboardId = workflowEntry?.getAttribute('data-storyboard-id') || '';
      const clicked = activate(workflowEntry);
      if (!clicked) {
        return {
          ready: false,
          clicked: false,
          workflowId,
          storyboardId,
          stageClicked: Boolean(storyboardClick.clicked),
          reason: 'real Daojie storyboard image workflow image entry was not found',
        };
      }
      const detail = await waitFor(() => {
        const text = document.body.innerText || '';
        const visibleRect = (node) => {
          if (!node) return null;
          const rect = node.getBoundingClientRect();
          const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
          const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
          return {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            visible:
              rect.width > 0 &&
              rect.height > 0 &&
              rect.right > 0 &&
              rect.bottom > 0 &&
              rect.left < viewportWidth &&
              rect.top < viewportHeight,
          };
        };
        const buttonTexts = Array.from(document.querySelectorAll('button')).map((node) => normalize(node));
        const inputValues = Array.from(document.querySelectorAll('input')).map((node) => node.value || '');
        const referenceNode = document.querySelector('[data-image-workflow-node-kind="reference"]');
        const generatedNode = document.querySelector('[data-image-workflow-node-kind="generated"]');
        const referenceNodeText = referenceNode ? normalize(referenceNode) : '';
        const generatedNodeText = generatedNode ? normalize(generatedNode) : '';
        const referenceInputValues = referenceNode
          ? Array.from(referenceNode.querySelectorAll('input')).map((node) => node.value || '')
          : [];
        const generatedInputValues = generatedNode
          ? Array.from(generatedNode.querySelectorAll('input')).map((node) => node.value || '')
          : [];
        const hasReferenceNode = Boolean(referenceNode) && (
          referenceNodeText.includes('参考') ||
          referenceInputValues.some((value) => value.trim().length > 0) ||
          Boolean(referenceNode.querySelector('img'))
        );
        const hasGeneratedNode = Boolean(generatedNode) && (
          (generatedNodeText.includes('分镜') && generatedNodeText.includes('成图')) ||
          generatedNodeText.includes('生成结果') ||
          generatedInputValues.some((value) => (value.includes('分镜') && value.includes('成图')) || value.includes('生成结果'))
        );
        const hasStoryboardWriteback = text.includes('选择回写分镜') || text.includes('分镜成图');
        const hasImageWorkflowCanvas = Boolean(document.querySelector('.react-flow'));
        const imageWorkflowNodeCount = document.querySelectorAll('.react-flow__node').length;
        const hasImageWorkflowNodes = imageWorkflowNodeCount >= 3;
        const hasImageWorkflowPromptNode = Boolean(document.querySelector('[data-image-workflow-node-kind="prompt"]'));
        const generatedPromptPanel = generatedNode?.querySelector('[data-toonflow-generated-prompt-panel]');
        const canvasRect = visibleRect(document.querySelector('.react-flow'));
        const generatedNodeRect = visibleRect(generatedNode);
        const generatedPromptPanelRect = visibleRect(generatedPromptPanel);
        const hasVisibleImageWorkflowCanvas = Boolean(canvasRect?.visible && canvasRect.width >= 480 && canvasRect.height >= 320);
        const hasVisibleGeneratedNode = Boolean(generatedNodeRect?.visible && generatedNodeRect.width >= 180 && generatedNodeRect.height >= 120);
        const hasVisibleDuplicateGeneratedPromptPanel = hasImageWorkflowPromptNode && Boolean(generatedPromptPanelRect?.visible && generatedPromptPanelRect.width >= 180 && generatedPromptPanelRect.height >= 80);
        const generatedPromptTextValues = generatedPromptPanel
          ? Array.from(generatedPromptPanel.querySelectorAll('textarea')).map((node) => node.value || '')
          : [];
        const promptNodeTextValues = Array.from(document.querySelectorAll('[data-image-workflow-node-kind="prompt"] textarea')).map((node) => node.value || '');
        const promptTextValues = hasImageWorkflowPromptNode ? promptNodeTextValues : generatedPromptTextValues;
        const hasNoDuplicateGeneratedPromptPanel = !(hasImageWorkflowPromptNode && Boolean(generatedPromptPanel));
        const hasNoVisibleDuplicateGeneratedPromptPanel = !hasVisibleDuplicateGeneratedPromptPanel;
        const hasEditableImageWorkflowPrompt = promptTextValues.some((value) => value.trim().length > 0);
        const hasDaojieStoryboardPromptStyle = promptTextValues.some((value) =>
          value.includes('水墨国风修仙') &&
          value.includes('@图1') &&
          value.includes('禁止写实摄影') &&
          value.includes('禁止3D写实渲染')
        );
        const hasImageWorkflowSource = text.includes('来源') && text.includes('分镜视频生成') && text.includes('分镜成图');
        const imageWorkflowScope = document.querySelector('[data-scoped-image-workflow-summary]')?.closest('section') || document;
        const scopedButtonTexts = Array.from(imageWorkflowScope.querySelectorAll('button')).map((node) => normalize(node));
        const scopedText = imageWorkflowScope.innerText || '';
        const hasScopedImageWorkflowSummary = Boolean(imageWorkflowScope.querySelector('[data-scoped-image-workflow-summary]'));
        const hasNoGlobalImageWorkflowControls =
          !imageWorkflowScope.querySelector('[data-image-workflow-selector]') &&
          !imageWorkflowScope.querySelector('[data-image-workflow-global-action]');
        const hasNoGlobalImageWorkflowPalettes = !scopedText.includes('项目参考图');
        const hasImageWorkflowBackButton = scopedButtonTexts.some((text) => text === '返回');
        const hasImageWorkflowRunAction = scopedButtonTexts.some((text) => text.includes('运行生成'));
        const hasImageWorkflowWritebackAction = scopedButtonTexts.some((text) => text.includes('写回目标'));
        return hasReferenceNode && hasGeneratedNode && hasStoryboardWriteback && hasImageWorkflowCanvas && hasVisibleImageWorkflowCanvas && hasImageWorkflowNodes && hasImageWorkflowPromptNode && hasNoDuplicateGeneratedPromptPanel && hasVisibleGeneratedNode && hasNoVisibleDuplicateGeneratedPromptPanel && hasEditableImageWorkflowPrompt && hasDaojieStoryboardPromptStyle && hasImageWorkflowSource && hasScopedImageWorkflowSummary && hasNoGlobalImageWorkflowControls && hasNoGlobalImageWorkflowPalettes && hasImageWorkflowBackButton && hasImageWorkflowRunAction && hasImageWorkflowWritebackAction
          ? { hasReferenceNode, hasGeneratedNode, hasStoryboardWriteback, hasImageWorkflowCanvas, hasVisibleImageWorkflowCanvas, hasImageWorkflowNodes, imageWorkflowNodeCount, hasImageWorkflowPromptNode, hasNoDuplicateGeneratedPromptPanel, hasVisibleGeneratedNode, hasNoVisibleDuplicateGeneratedPromptPanel, hasEditableImageWorkflowPrompt, hasDaojieStoryboardPromptStyle, hasImageWorkflowSource, hasScopedImageWorkflowSummary, hasNoGlobalImageWorkflowControls, hasNoGlobalImageWorkflowPalettes, hasImageWorkflowBackButton, hasImageWorkflowRunAction, hasImageWorkflowWritebackAction, canvasRect, generatedNodeRect, generatedPromptPanelRect, inputValues, promptTextValues, generatedPromptTextValues, referenceNodeText, generatedNodeText }
          : null;
      }, 8_000);
      return {
        ready: Boolean(detail),
        clicked: true,
        workflowId,
        storyboardId,
        stageClicked: Boolean(storyboardClick.clicked),
        detail,
      };
    };

    await waitFor(() => normalize(document.body).includes(projectName), 20_000);
    const projectClick = clickText(projectName);
    await visibleDelay();
    await waitFor(() => captureVisibleWorkflowDomEvidence().hasWorkflowTab, 20_000);
    const workflowClick = clickText('工作流', true);
    const workflowFallbackClick = workflowClick.clicked
      ? { clicked: false, text: '' }
      : clickText('工作流');
    await visibleDelay();
    const switcherEvidence = await waitFor(() => {
      const evidence = captureVisibleWorkflowDomEvidence();
      return evidence.hasStageSwitcher ? evidence : null;
    }, 20_000);
    await waitFor(async () => {
      const data = await inspectDaojieProjectData();
      return data.chapterId === chapterId && data.chapterTitle === chapterTitle ? data : null;
    }, 20_000);
    if (!switcherEvidence) {
      const daojie = await inspectDaojieProjectData();
      const domEvidence = captureVisibleWorkflowDomEvidence();
      return {
        source: daojie.source,
        clickedWorkflow: Boolean(workflowClick.clicked || workflowFallbackClick.clicked || normalize(document.body).includes('工作流')),
        clickedProject: Boolean(projectClick.clicked),
        completed: false,
        progress: 0,
        results: [],
        chapterAutoVideo: { enabled: autoVideoEnabled },
        daojie,
        error: 'stage switcher was not visible',
        domEvidence,
      };
    }

    const stages = [
      { id: 'manuals', label: '风格与导演' },
      { id: 'novel', label: '小说导入' },
      { id: 'script', label: '剧本生产阶段' },
      { id: 'assets', label: '剧本资产管理' },
      { id: 'storyboard', label: '分镜视频生成' },
      { id: 'workbench', label: '视频工作台' },
    ];
    const results = [];
    for (const stage of stages) {
      console.info('[visible-run] stage ' + stage.id + ' start ' + stage.label);
      const stageClick = await clickStage(stage);
      const evidence = await waitFor(async () => {
        const data = await inspectDaojieProjectData();
        const checked = verifyRealDaojieStageEvidence(stage, data);
        return checked.ready ? { ...checked, data } : null;
      }, 8_000);
      const data = evidence?.data || await inspectDaojieProjectData();
      console.info('[visible-run] stage ' + stage.id + ' ready=' + Boolean(evidence?.ready) + ' storyboards=' + data.storyboards + ' videoCandidates=' + data.videoCandidates);
      results.push({
        id: stage.id,
        label: stage.label,
        clicked: Boolean(stageClick.clicked),
        clickedText: stageClick.text,
        ready: Boolean(evidence?.ready),
        domEvidence: evidence?.domEvidence || captureVisibleWorkflowDomEvidence(),
      });
    }

    const chapterAutoVideo = await runChapterAutoVideoFlow();
    const stopAfterAutoVideo = autoVideoEnabled && (
      chapterAutoVideo.terminalStage !== 'completed'
      || chapterAutoVideo.timedOut
      || chapterAutoVideo.finalVideoEvidenceError
      || !chapterAutoVideo.finalVideoEvidence
    );
    const storyboardImageWorkflowDetail = stopAfterAutoVideo
      ? { ready: false, skippedAfterAutoVideoFailure: true }
      : await openRealDaojieStoryboardImageWorkflowDetail();
    const derivativeImageWorkflowDetail = stopAfterAutoVideo
      ? { ready: false, skippedAfterAutoVideoFailure: true }
      : await openRealDaojieDerivativeImageWorkflowDetail();
    const daojie = await inspectDaojieProjectData();
    return {
      source: daojie.source,
      clickedWorkflow: Boolean(workflowClick.clicked || workflowFallbackClick.clicked || normalize(document.body).includes('工作流')),
      clickedProject: Boolean(projectClick.clicked),
      completed: results.every((item) => item.clicked && item.ready),
      progress: results.filter((item) => item.ready).length / results.length * 100,
      results,
      chapterAutoVideo,
      storyboardImageWorkflowDetail,
      derivativeImageWorkflowDetail,
      daojie,
      domEvidence: captureVisibleWorkflowDomEvidence(),
    };
  })()`;
}

const childEnv = {
  ...process.env,
  ELECTRON_ENABLE_LOGGING: "1",
  MYSTUDIO_SMOKE_STEP_DELAY_MS: String(safeStepDelayMs),
  MYSTUDIO_SMOKE_BACKGROUND: runInBackground ? "1" : "0",
};
if (runRealDaojie) {
  childEnv.MYSTUDIO_WORKFLOW_REAL_DAOJIE = "1";
  if (runInBackground) childEnv.MYSTUDIO_SMOKE = "1";
} else {
  childEnv.MYSTUDIO_SMOKE = "1";
  childEnv.MYSTUDIO_SMOKE_WORKFLOW_STEPWISE = "1";
  if (!runInBackground) {
    childEnv.MYSTUDIO_SMOKE_FOREGROUND = "1";
    childEnv.MYSTUDIO_SMOKE_KEEP_OPEN = "1";
  }
}

const child = spawn(
  appBin,
  [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${userDataDir}`],
  {
    cwd: process.cwd(),
    detached: true,
    env: childEnv,
    stdio: "ignore",
  },
);
let runPassed = false;

try {
  const page = await waitForPageTarget();
  if (runInBackground) {
    focusSamples.push(sampleFrontmostApplication("after CDP target appeared"));
  } else {
    await ensureAppIsForeground(child.pid, "after app launch");
  }
  const result = await runVisibleWorkflow(page, child.pid, focusSamples);
  if (runInBackground) {
    focusSamples.push(sampleFrontmostApplication("after workflow clicks"));
  }
  const frontmostApp = runInBackground
    ? ""
    : await ensureAppIsForeground(child.pid, "after workflow clicks");
  const foregroundViolation = hasMYStudioForegroundViolation(focusSamples);
  const focusFailure = runInBackground
    ? foregroundViolation
    : process.platform === "darwin" && frontmostApp !== appProcessName;
  const failedStages = result.results.filter((stage) => !stage.clicked || !stage.ready);
  const runtimeProblems = Array.isArray(result.runtimeProblems)
    ? result.runtimeProblems
    : [];
  const baseReport = {
    mode: runMode,
    appBin,
    userDataDir,
    debugPort,
    runRealDaojie,
    runChapterAutoVideo,
    chapterAutoVideo: result.chapterAutoVideo,
    frontmostApp,
    windowVisibility: result.windowVisibility,
    documentHasFocus: result.documentHasFocus,
    focusSamples,
    foregroundViolation,
    result,
    failedStages,
    runtimeProblems,
  };
  if (runRealDaojie) {
    const diskDaojie = inspectClonedDaojieProjectData(userDataDir);
    const daojie = { ...(result.daojie || {}), ...diskDaojie };
    const expectedStoryboards = Number(realDaojieRun?.expectedStoryboards ?? daojie.expectedStoryboards);
    const storyboardPaletteImages = result.derivativeImageWorkflowDetail?.storyboardPaletteImages;
    const scopedDerivativePaletteAbsent = storyboardPaletteImages?.sectionFound === false;
    const chapterAutoVideo = result.chapterAutoVideo || { enabled: false };
    const autoVideoAudit = runChapterAutoVideo
      ? auditVisibleAutoVideo({ chapterAutoVideo, userDataDir })
      : { ok: true, expectedRoot: "", issues: [] };
    const autoVideoFailed = runChapterAutoVideo && !autoVideoAudit.ok;
    const failed =
      !(expectedStoryboards > 0) ||
      result.source !== "real-daojie-chapter001-clone" ||
      !result.clickedWorkflow ||
      !result.completed ||
      failedStages.length > 0 ||
      runtimeProblems.length > 0 ||
      daojie.projectName !== daojieProjectName ||
      daojie.chapterId !== daojieChapterId ||
      daojie.chapterTitle !== daojieChapterTitle ||
      daojie.sourceLength < 9000 ||
      daojie.storyboards !== expectedStoryboards ||
      daojie.storyboardsWithMediaPath !== expectedStoryboards ||
      daojie.storyboardsWithWorkflow !== expectedStoryboards ||
      daojie.storyboardImageWorkflowsReady !== expectedStoryboards ||
      daojie.totalStoryboardDuration > 180 ||
      daojie.totalTrackDuration > 180 ||
      daojie.derivedAssetPlan < 3 ||
      daojie.derivedAssets < 3 ||
      daojie.derivedImageWorkflows < 3 ||
      daojie.derivedImageWorkflowsReady < 3 ||
      !result.storyboardImageWorkflowDetail?.ready ||
      !result.derivativeImageWorkflowDetail?.ready ||
      !scopedDerivativePaletteAbsent ||
      daojie.productionTracks < 1 ||
      daojie.videoCandidates < 1 ||
      daojie.hasSmokeTemplate ||
      autoVideoFailed ||
      focusFailure;
    writeVisibleRunReport({
      ...baseReport,
      source: result.source,
      ok: !failed,
      autoVideoFailed,
      autoVideoAudit,
      daojie: { ...daojie, expectedStoryboards },
    });
    if (failed) {
      console.error(JSON.stringify({ ...result, frontmostApp }, null, 2));
      process.exitCode = 1;
    } else {
      runPassed = true;
      console.log(
        `[${runMode}-run] Daojie chapter001 clicked through${runInBackground ? " in background" : " and left open"}: pid=${child.pid}, project=${daojie.projectName}, chapter=${daojie.chapterId}, storyboards=${daojie.storyboards}/${expectedStoryboards}, derivedAssets=${daojie.derivedAssets}, derivedImageWorkflows=${daojie.derivedImageWorkflowsReady}/${daojie.derivedImageWorkflows}, videoCandidates=${daojie.videoCandidates}, autoVideoStage=${chapterAutoVideo.terminalStage || "disabled"}, frontmostApp=${frontmostApp || "unchanged"}, userDataDir=${userDataDir}`,
      );
    }
  } else if (
    result.source !== "isolated-smoke-project" ||
    !result.clickedWorkflow ||
    !result.completed ||
    failedStages.length > 0 ||
    runtimeProblems.length > 0 ||
    focusFailure
  ) {
    writeVisibleRunReport({
      ...baseReport,
      source: result.source,
      ok: false,
    });
    console.error(JSON.stringify({ ...result, frontmostApp }, null, 2));
    process.exitCode = 1;
  } else {
    writeVisibleRunReport({
      ...baseReport,
      source: result.source,
      ok: true,
    });
    runPassed = true;
    console.log(
      `[${runMode}-run] workflow clicked through${runInBackground ? " in background" : " and left open"}: pid=${child.pid}, progress=${result.progress}, frontmostApp=${frontmostApp || "unchanged"}, userDataDir=${userDataDir}`,
    );
  }
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(errorMessage);
  if (runInBackground) {
    focusSamples.push(sampleFrontmostApplication("after workflow failure"));
  }
  try {
    writeVisibleRunReport({
      ok: false,
      mode: runMode,
      source: runRealDaojie
        ? "real-daojie-chapter001-clone"
        : "isolated-smoke-project",
      appBin,
      userDataDir,
      debugPort,
      runRealDaojie,
      runChapterAutoVideo,
      windowVisibility: null,
      documentHasFocus: null,
      focusSamples,
      foregroundViolation: hasMYStudioForegroundViolation(focusSamples),
      error: errorMessage,
    });
  } catch (reportError) {
    console.error(
      `[visible-run] failed to write failure report: ${reportError instanceof Error ? reportError.message : String(reportError)}`,
    );
  }
  process.exitCode = 1;
} finally {
  if (runPassed && !runInBackground) child.unref();
  else await terminateSpawnedApp(child, { logPrefix: `[${runMode}-run]` });
}
