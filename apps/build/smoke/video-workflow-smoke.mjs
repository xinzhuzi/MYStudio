import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { terminateSpawnedApp } from "./smoke-process-lifecycle.mjs";

const REQUIRED_PLUGIN_IDS = ["remotion", "video-use", "hyperframes", "seedance-prompt"];
const EXECUTION_PLUGIN_IDS = ["remotion", "video-use", "hyperframes"];
const DEFAULT_TIMEOUT_MS = 30_000;

export function evaluateVideoWorkflowStatus(reply) {
  const issues = [];
  if (!reply || typeof reply !== "object" || Array.isArray(reply)) {
    return { ok: false, state: "invalid", issues: [{ code: "status.invalid", message: "status reply 必须是对象" }] };
  }
  if (reply.schemaVersion !== 1) issues.push({ code: "status.schema", message: "status schemaVersion 必须为 1" });
  if (!Number.isFinite(reply.checkedAt) || reply.checkedAt <= 0) issues.push({ code: "status.checked-at", message: "status checkedAt 无效" });
  const plugins = Array.isArray(reply.plugins) ? reply.plugins : [];
  if (plugins.length !== REQUIRED_PLUGIN_IDS.length) issues.push({ code: "status.plugins", message: `插件数量必须为 ${REQUIRED_PLUGIN_IDS.length}` });
  const byId = new Map();
  for (const plugin of plugins) {
    if (!plugin || typeof plugin !== "object" || typeof plugin.pluginId !== "string") {
      issues.push({ code: "status.plugin-entry", message: "插件状态项无效" });
      continue;
    }
    if (byId.has(plugin.pluginId)) issues.push({ code: "status.plugin-duplicate", message: `插件重复: ${plugin.pluginId}` });
    byId.set(plugin.pluginId, plugin);
    if (plugin.checkedAt !== reply.checkedAt) issues.push({ code: "status.plugin-time", message: `${plugin.pluginId} checkedAt 与顶层不一致` });
  }
  for (const pluginId of REQUIRED_PLUGIN_IDS) {
    if (!byId.has(pluginId)) issues.push({ code: "status.plugin-missing", message: `缺少插件状态: ${pluginId}` });
  }
  if (issues.length > 0) return { ok: false, state: "invalid", issues };

  const videoUse = byId.get("video-use");
  if (videoUse.runtimeState === "blocked" && videoUse.runtimeCode === "alignment-model-missing") {
    return {
      ok: false,
      state: "blocked",
      code: "alignment-model-missing",
      message: videoUse.message || "本地 Whisper/Tokenizer 模型缺失；只读探针停止，不下载模型",
      issues: [{ code: "video-use.alignment-model-missing", message: videoUse.message || "alignment-model-missing" }],
      videoUse,
      plugins: Object.fromEntries(byId),
    };
  }
  if (videoUse.runtimeState !== "ready") {
    return {
      ok: false,
      state: "blocked",
      code: videoUse.runtimeCode || "video-use-not-ready",
      message: videoUse.message || "video-use 未就绪",
      issues: [{ code: "video-use.not-ready", message: videoUse.message || "video-use 未就绪" }],
      videoUse,
      plugins: Object.fromEntries(byId),
    };
  }
  const notReady = EXECUTION_PLUGIN_IDS
    .map((pluginId) => byId.get(pluginId))
    .filter((plugin) => plugin.runtimeState !== "ready");
  if (notReady.length > 0) {
    return {
      ok: false,
      state: "blocked",
      code: "plugin-runtime-not-ready",
      message: notReady.map((plugin) => `${plugin.pluginId}: ${plugin.message || plugin.runtimeState}`).join("; "),
      issues: notReady.map((plugin) => ({ code: `plugin.${plugin.pluginId}.not-ready`, message: plugin.message || plugin.runtimeState })),
      videoUse,
      plugins: Object.fromEntries(byId),
    };
  }
  return { ok: true, state: "ready", message: "四项视频工作流插件状态均已就绪", issues: [], videoUse, plugins: Object.fromEntries(byId) };
}

function readJson(url) {
  return new Promise((resolveJson, reject) => {
    const request = http.get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try { resolveJson(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    request.on("error", reject);
  });
}

async function waitForPageTarget(debugPort, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await readJson(`http://127.0.0.1:${debugPort}/json/list`);
      const page = Array.isArray(targets) ? targets.find((target) => target.type === "page") : null;
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // Electron exposes the debugging endpoint shortly after launch.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`未找到 Electron page target: ${debugPort}`);
}

async function evaluateInPage(pageTarget, expression) {
  const socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", rejectOpen, { once: true });
  });
  let messageId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const callback = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) callback.reject(new Error(JSON.stringify(message.error)));
    else callback.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolveResult, reject) => {
    const id = ++messageId;
    pending.set(id, { resolve: resolveResult, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  try {
    const result = await send("Runtime.evaluate", { awaitPromise: true, returnByValue: true, expression });
    return result?.result?.value;
  } finally {
    for (const callback of pending.values()) callback.reject(new Error("CDP socket closed"));
    pending.clear();
    socket.close();
  }
}

function resolveAppBinary() {
  const candidates = [
    process.env.MYSTUDIO_SMOKE_APP_BIN,
    resolve(process.cwd(), "release", "build", "mac-arm64", "mac-arm64", "漫影工作室.app", "Contents", "MacOS", "漫影工作室"),
    resolve(process.cwd(), "release", "build", "mac-arm64", "漫影工作室.app", "Contents", "MacOS", "漫影工作室"),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || candidates[0];
}

function parseArgs(argv) {
  const result = { reportPath: process.env.MYSTUDIO_VIDEO_WORKFLOW_SMOKE_REPORT_PATH || resolve(process.cwd(), "output", "automation", "video-workflow-smoke-report.json") };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--status-file") result.statusFile = resolve(argv[++index]);
    else if (argv[index] === "--debug-port") result.debugPort = Number(argv[++index]);
    else if (argv[index] === "--user-data-dir") result.userDataDir = resolve(argv[++index]);
    else if (argv[index] === "--report") result.reportPath = resolve(argv[++index]);
    else if (argv[index] === "--help") result.help = true;
    else throw new Error(`未知参数: ${argv[index]}`);
  }
  return result;
}

export async function runVideoWorkflowSmoke(options = {}) {
  if (options.statusFile) {
    const status = JSON.parse(readFileSync(options.statusFile, "utf8"));
    return { ...evaluateVideoWorkflowStatus(status), source: "status-file", mutatingCalls: 0 };
  }
  const debugPort = Number(options.debugPort || process.env.MYSTUDIO_VIDEO_WORKFLOW_DEBUG_PORT || (9400 + Math.floor(Math.random() * 400)));
  const appBin = options.appBin || resolveAppBinary();
  if (!appBin || !existsSync(appBin)) throw new Error(`Packaged app 不存在: ${appBin || "empty"}`);
  const userDataDir = options.userDataDir || process.env.MYSTUDIO_VIDEO_WORKFLOW_SMOKE_USER_DATA_DIR || mkdtempSync(resolve(tmpdir(), "mystudio-video-workflow-smoke-"));
  const child = spawn(appBin, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${userDataDir}`], {
    cwd: process.cwd(), detached: true, env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" }, stdio: "ignore",
  });
  try {
    const page = await waitForPageTarget(debugPort, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
    const status = await evaluateInPage(page, "window.videoWorkflowPlugins?.status?.() || null");
    const evaluated = evaluateVideoWorkflowStatus(status);
    return { ...evaluated, source: "packaged-electron-cdp", appBin, userDataDir, debugPort, status, probeCalls: 1, mutatingCalls: 0 };
  } finally {
    await terminateSpawnedApp(child, { force: true }).catch(() => undefined);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node ./build/smoke/video-workflow-smoke.mjs [--status-file file] [--debug-port port] [--user-data-dir dir] [--report file]");
    return;
  }
  const startedAt = Date.now();
  let report;
  try {
    report = { schemaVersion: 1, generatedAt: new Date().toISOString(), startedAt, ...(await runVideoWorkflowSmoke(args)) };
  } catch (error) {
    report = { schemaVersion: 1, generatedAt: new Date().toISOString(), startedAt, ok: false, state: "error", issues: [{ code: "smoke.error", message: error instanceof Error ? error.message : String(error) }], mutatingCalls: 0 };
  }
  mkdirSync(dirname(args.reportPath), { recursive: true });
  writeFileSync(args.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.url.replace("file://", ""))) await main();
