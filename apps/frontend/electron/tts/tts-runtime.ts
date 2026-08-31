import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { ChildProcess, spawn } from "node:child_process";
import { captureSidecarOutput } from "../diagnostics/sidecar-log-capture";
import { createTtsRuntimePaths } from "./tts-runtime-paths";
import { createTtsRuntimeMigration } from "./tts-runtime-migration";
import { createTtsRuntimePython } from "./tts-runtime-python";
import { assertSafeTarMembers } from "./archive-safety";
import { getErrorMessage, isRecord, parseJsonString } from "./tts-runtime-utils";
import type { BackendModelStatus, TtsRuntimeCommandResult, TtsRuntimeConfig, TtsRuntimeInstalledItem, TtsRuntimeStatus } from "@/types/tts";
import { ALIGNMENT_MODEL_NAME, BackendHealth, DEFAULT_ALIGNMENT_MODEL_POLL_ATTEMPTS, DEFAULT_ALIGNMENT_MODEL_POLL_INTERVAL_MS, DEFAULT_TTS_HOST, DEFAULT_TTS_PORT, DEFAULT_TTS_REQUEST_TIMEOUT_MS, FetchJsonOptions, SpawnedProcess, TtsRuntimeController, TtsRuntimeControllerDeps, TtsRuntimeError, createTtsBackendHttpError, defaultFetchBytes, defaultFetchJson, defaultFetchRuntimeArchive, defaultFindListeningPids, defaultKillProcess, defaultPythonDownloadUrl, execFileAsync, expandHome, fetchWithTtsDeadline, isValidPythonRuntimeSha256, isValidPythonRuntimeUrl, makeStatus, normalizeRoutePath, normalizeUserPath, resolveHfHubCacheDir, sidecarMainPath, uniquePaths, withTtsRequestContext } from "./tts-runtime-shared";

export function createTtsRuntimeController(deps: TtsRuntimeControllerDeps): TtsRuntimeController {
  const port = deps.port ?? DEFAULT_TTS_PORT;
  const host = deps.host ?? DEFAULT_TTS_HOST;
  const baseUrl = `http://${host}:${port}`;
  const fileExists = deps.fileExists ?? fs.existsSync;
  const ensureDir = deps.ensureDir ?? ((dirPath: string) => fs.mkdirSync(dirPath, { recursive: true }));
  const readTextFile = deps.readTextFile ?? ((filePath: string) => {
    try {
      return fs.readFileSync(filePath, "utf8");
    } catch {
      return null;
    }
  });
  const writeTextFile = deps.writeTextFile ?? ((filePath: string, value: string) => fs.writeFileSync(filePath, value));
  const writeBinaryFile = deps.writeBinaryFile ?? ((filePath: string, value: Uint8Array) => fs.writeFileSync(filePath, value));
  const renameFile = deps.renameFile ?? ((from: string, to: string) => fs.renameSync(from, to));
  const removeFile = deps.removeFile ?? ((filePath: string) => fs.rmSync(filePath, { force: true }));
  const extractArchive = deps.extractArchive ?? (async (archivePath: string, destinationDir: string) => {
    // 解压网络归档前先校验成员,拒绝 ../、绝对路径等穿越写法(见 archive-safety.ts)。
    const listing = await execFileAsync("tar", ["-tzf", archivePath], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }) as { stdout?: string };
    assertSafeTarMembers((listing.stdout ?? "").split("\n").map((line) => line.trim()).filter(Boolean));
    await execFileAsync("tar", ["-xzf", archivePath, "-C", destinationDir], { timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
  });
  const runPython = deps.runPython ?? ((command: string, args: string[], options?: Parameters<typeof execFileAsync>[2]) => execFileAsync(command, args, options));
  const spawnProcess = deps.spawnProcess ?? ((command, args, options) => spawn(command, args, options));
  const fetchJson = deps.fetchJson ?? defaultFetchJson;
  const fetchBytes = deps.fetchBytes ?? defaultFetchBytes;
  const fetchRuntimeArchive = deps.fetchRuntimeArchive ?? defaultFetchRuntimeArchive;
  const findListeningPids = deps.findListeningPids ?? defaultFindListeningPids;
  const killProcess = deps.killProcess ?? defaultKillProcess;
  const requestTimeoutMs = Number.isFinite(deps.requestTimeoutMs) && (deps.requestTimeoutMs ?? 0) > 0
    ? Math.max(1, Math.floor(deps.requestTimeoutMs ?? DEFAULT_TTS_REQUEST_TIMEOUT_MS))
    : DEFAULT_TTS_REQUEST_TIMEOUT_MS;
  const sleep = deps.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const alignmentModelPollIntervalMs = Number.isFinite(deps.alignmentModelPollIntervalMs)
    ? Math.max(0, Math.floor(deps.alignmentModelPollIntervalMs ?? DEFAULT_ALIGNMENT_MODEL_POLL_INTERVAL_MS))
    : DEFAULT_ALIGNMENT_MODEL_POLL_INTERVAL_MS;
  const alignmentModelPollAttempts = Number.isFinite(deps.alignmentModelPollAttempts)
    ? Math.max(1, Math.floor(deps.alignmentModelPollAttempts ?? DEFAULT_ALIGNMENT_MODEL_POLL_ATTEMPTS))
    : DEFAULT_ALIGNMENT_MODEL_POLL_ATTEMPTS;
  const sidecarRoots = uniquePaths([
    ...(deps.sidecarRoots ?? []),
    path.join(deps.appRoot, "..", "backend"),
    typeof process.resourcesPath === "string" ? path.join(process.resourcesPath, "backend") : "",
  ]);

  const pathsApi = createTtsRuntimePaths(deps, { readTextFile, writeTextFile, ensureDir });
  const {
    runtimeDataDir,
    runtimePythonDir,
    defaultModelCacheDir, readConfig, writeConfig,
    getModelCacheDir, saveModelCacheDir, getControlToken,
  } = pathsApi;
  const {
    cleanupAudioGenerationPool,
    getStorageLayout, buildModelMigrationPlan,
  } = createTtsRuntimeMigration(pathsApi, { fileExists });
  let child: SpawnedProcess | null = null;
  let setupState: Pick<TtsRuntimeStatus, "setupStage" | "setupMessage" | "setupProgress"> = {
    setupStage: "idle",
    setupMessage: undefined,
    setupProgress: undefined,
  };


  const isManagedPythonInstallItem = (item: TtsRuntimeInstalledItem) => {
    if (item.label !== "Python 运行环境") return true;
    if (!item.detail || !path.isAbsolute(item.detail)) return false;
    const normalizedDetail = path.resolve(expandHome(item.detail));
    const runtimeDir = path.resolve(expandHome(runtimePythonDir()));
    const pythonPath = path.resolve(managedPythonExecutablePath(runtimeDir));
    return normalizedDetail === runtimeDir || normalizedDetail === pythonPath;
  };

  const getRuntimeConfig = (): TtsRuntimeConfig => {
    const config = readConfig();
    const envUrl = process.env.MANYING_TTS_PYTHON_RUNTIME_URL?.trim();
    return {
      pythonRuntimeUrl: config.pythonRuntimeUrl || envUrl || "",
      pythonRuntimeSha256: config.pythonRuntimeSha256 || undefined,
      defaultPythonRuntimeUrl: defaultPythonDownloadUrl() ?? undefined,
      pythonRuntimeDir: runtimePythonDir(),
      installedItems: (config.installedItems ?? []).filter(isManagedPythonInstallItem),
    };
  };

  const saveRuntimeConfig = (nextConfig: Partial<TtsRuntimeConfig>) => {
    const config = readConfig();
    const pythonRuntimeUrl = nextConfig.pythonRuntimeUrl?.trim();
    if (pythonRuntimeUrl && !isValidPythonRuntimeUrl(pythonRuntimeUrl)) {
      throw new TtsRuntimeError({
        code: "invalid-request",
        message: "Python 运行环境下载地址必须使用 HTTPS",
        retryable: false,
      });
    }
    const pythonRuntimeSha256 = nextConfig.pythonRuntimeSha256?.trim();
    if (pythonRuntimeSha256 && !isValidPythonRuntimeSha256(pythonRuntimeSha256)) {
      throw new TtsRuntimeError({
        code: "invalid-request",
        message: "Python 运行环境 sha256 必须是 64 位十六进制字符串",
        retryable: false,
      });
    }
    writeConfig({
      ...config,
      pythonRuntimeUrl: pythonRuntimeUrl || undefined,
      pythonRuntimeSha256: pythonRuntimeSha256 || undefined,
    });
  };

  const setInstalledItem = (item: TtsRuntimeInstalledItem) => {
    const config = readConfig();
    const existing = config.installedItems ?? [];
    const nextItems = [
      ...existing.filter((existingItem) => existingItem.label !== item.label),
      item,
    ];
    writeConfig({ ...config, installedItems: nextItems });
  };

  const updateSetupState = (next: Pick<TtsRuntimeStatus, "setupStage" | "setupMessage" | "setupProgress">) => {
    setupState = {
      setupStage: next.setupStage,
      setupMessage: next.setupMessage,
      setupProgress: next.setupProgress,
    };
  };

  const resolveSidecarRoot = () => sidecarRoots.find((sidecarRoot) => fileExists(sidecarMainPath(sidecarRoot)));


  const {
    managedPythonExecutablePath, findManagedPython,
    findReadyPython, ensurePython, getDepsPlan, depsAreReady, verifyDepsWithoutInstall, ensureDeps,
  } = createTtsRuntimePython(
    pathsApi,
    { fileExists, ensureDir, removeFile, writeBinaryFile, renameFile, readTextFile, writeTextFile },
    { runPython, fetchRuntimeArchive, extractArchive },
    { updateSetupState, setInstalledItem, currentSetupProgress: () => setupState.setupProgress },
  );

  async function getBackendHealth(): Promise<BackendHealth> {
    try {
      const payload = await fetchJson(`${baseUrl}/health`, { method: "GET" });
      const service = typeof payload === "object" && payload && "service" in payload
        ? String((payload as { service?: unknown }).service)
        : undefined;
      return { healthy: true, service, error: undefined };
    } catch (error) {
      return { healthy: false, error: getErrorMessage(error) };
    }
  }

  async function isBackendHealthy() {
    return (await getBackendHealth()).healthy;
  }

  async function waitUntilHealthy() {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (await isBackendHealthy()) return true;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return false;
  }

  async function waitUntilStopped() {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (!await isBackendHealthy()) return true;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return false;
  }

  async function status(): Promise<TtsRuntimeStatus> {
    const sidecarRoot = resolveSidecarRoot();
    const installed = sidecarRoot !== undefined;
    const pythonExecutablePath = findManagedPython();
    const pythonInstalled = pythonExecutablePath !== null;
    const dependenciesReady = sidecarRoot !== undefined && pythonExecutablePath !== null
      ? depsAreReady(sidecarRoot, pythonExecutablePath)
      : false;
    const health = await getBackendHealth();
    const running = health.healthy;
    return makeStatus({
      installed,
      sidecarAvailable: installed,
      pythonInstalled,
      pythonExecutablePath: pythonExecutablePath ?? undefined,
      dependenciesReady,
      running,
      port,
      baseUrl,
      setupStage: setupState.setupStage ?? "idle",
      setupMessage: setupState.setupMessage,
      setupProgress: setupState.setupProgress,
      cacheDir: runtimeDataDir(),
      modelCacheDir: getModelCacheDir(),
      defaultModelCacheDir: defaultModelCacheDir(),
      hfHubCacheDir: resolveHfHubCacheDir(getModelCacheDir(), fileExists),
      storageLayout: getStorageLayout(),
      pythonRuntimeDir: runtimePythonDir(),
      managed: child !== null,
      pid: child?.pid,
      error: !running && child ? `TTS 后端进程存在但 HTTP 不可达: ${health.error ?? baseUrl}` : undefined,
    });
  }

  async function requestBackendShutdown() {
    const controlToken = getControlToken();
    return fetchJson(`${baseUrl}/shutdown`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Manying-TTS-Token": controlToken,
      },
      body: JSON.stringify({ token: controlToken }),
    });
  }

  async function stopStaleBackendProcess(health: BackendHealth) {
    if (health.service !== "manying-voicebox-tts") return false;
    const pids = await findListeningPids(port, host);
    if (pids.length === 0) return false;
    const killed = pids.some((pid) => killProcess(pid));
    if (!killed) return false;
    return waitUntilStopped();
  }

  async function start(): Promise<TtsRuntimeCommandResult> {
    updateSetupState({ setupStage: "checking", setupMessage: "正在检查本地 TTS 后端", setupProgress: 0 });
    const sidecarRoot = resolveSidecarRoot();
    if (!sidecarRoot) {
      updateSetupState({ setupStage: "failed", setupMessage: "未找到本地 TTS 后端", setupProgress: 0 });
      return {
        success: false,
        status: await status(),
        error: `TTS sidecar not found. Checked: ${sidecarRoots.map(sidecarMainPath).join(", ")}`,
      };
    }

    if (child) {
      if (await isBackendHealthy()) {
        updateSetupState({ setupStage: "ready", setupMessage: "本地 TTS 后端已就绪", setupProgress: 100 });
        return { success: true, status: await status() };
      }
      child.kill();
      child = null;
    }

    const existingHealth = await getBackendHealth();
    if (existingHealth.healthy) {
      const stopped = await stopStaleBackendProcess(existingHealth);
      if (!stopped) {
        updateSetupState({ setupStage: "failed", setupMessage: "本地 TTS 端口清理失败", setupProgress: 0 });
        return {
          success: false,
          status: await status(),
          error: "本地 TTS 端口已被本地 TTS 残留进程占用，自动清理失败",
        };
      }
    }

    const runtimeDir = runtimeDataDir();
    ensureDir(runtimeDir);
    cleanupAudioGenerationPool();
    const modelCacheDir = getModelCacheDir();
    const hfHubCacheDir = resolveHfHubCacheDir(modelCacheDir, fileExists);
    ensureDir(modelCacheDir);
    ensureDir(hfHubCacheDir);

    const pyResult = await findReadyPython();
    if (!pyResult.python) {
      console.warn("[TTS] start aborted: Python runtime not found —", pyResult.error);
      return { success: false, status: await status(), error: pyResult.error };
    }
    if (!depsAreReady(sidecarRoot, pyResult.python)) {
      const depsPlan = getDepsPlan(sidecarRoot, pyResult.python);
      let depsVerified = false;
      if (depsPlan.reqPath && depsPlan.markerPath && depsPlan.reqHash) {
        updateSetupState({ setupStage: "checking", setupMessage: "正在离线校验 TTS Python 依赖", setupProgress: undefined });
        depsVerified = await verifyDepsWithoutInstall(depsPlan.reqPath, pyResult.python);
        if (depsVerified) {
          ensureDir(runtimeDataDir());
          writeTextFile(depsPlan.markerPath, depsPlan.reqHash);
          console.warn("[TTS] healed stale dependency marker after offline dry-run proof:", depsPlan.markerPath);
        }
      }
      if (!depsVerified) {
        console.warn("[TTS] deps not ready — marker:", depsPlan.markerPath, "expected hash:", depsPlan.reqHash, "actual:", readTextFile(depsPlan.markerPath ?? "")?.trim() ?? "(missing)");
        updateSetupState({ setupStage: "failed", setupMessage: "TTS Python 依赖未配置", setupProgress: 0 });
        return {
          success: false,
          status: await status(),
          error: "请先到设置里的本地配置页的 Python 运行环境区块点击开始配置，完成 TTS 依赖安装",
        };
      }
    }
    const controlToken = getControlToken();
    const backendPython = pyResult.python;

    updateSetupState({ setupStage: "starting-backend", setupMessage: "本地 TTS 后端启动中", setupProgress: undefined });
    console.warn("[TTS] starting backend:", backendPython, "cwd:", sidecarRoot, "port:", port);
    child = spawnProcess(
      backendPython,
      [
        "-m",
        "tts.main",
        "--host",
        host,
        "--port",
        String(port),
        "--data-dir",
        runtimeDir,
      ],
      {
        cwd: sidecarRoot,
        env: {
          ...process.env,
          PYTHONPATH: sidecarRoot,
          MANYING_TTS_DATA_DIR: runtimeDir,
          MANYING_TTS_MODELS_DIR: modelCacheDir,
          VOICEBOX_MODELS_DIR: modelCacheDir,
          HF_HUB_CACHE: hfHubCacheDir,
          MANYING_TTS_CONTROL_TOKEN: controlToken,
        },
      },
    );
    // 默认 stdio=pipe 却无人监听:输出被丢且管道塞满会卡死后端——统一捕获进 logs/sidecars/。
    captureSidecarOutput({
      module: "tts-backend",
      // 真实 spawn 产物是完整 ChildProcess;SpawnedProcess 的 Pick 窄类型
      // 仅为测试注入声明,此处还原全型交给捕获器。
      child: child as ChildProcess,
      label: `${backendPython} -m tts.main --port ${port}`,
    });

    const healthy = await waitUntilHealthy();
    if (!healthy) {
      console.warn("[TTS] backend did not become healthy on", baseUrl, "— killing spawned process");
      child?.kill();
      child = null;
      updateSetupState({ setupStage: "failed", setupMessage: "本地 TTS 后端启动失败", setupProgress: undefined });
      return {
        success: false,
        status: await status(),
        error: `TTS backend did not become healthy on ${baseUrl}`,
      };
    }
    updateSetupState({ setupStage: "ready", setupMessage: "本地 TTS 后端已就绪", setupProgress: 100 });
    console.warn("[TTS] backend ready on", baseUrl);
    return { success: true, status: await status() };
  }

  async function setup(): Promise<TtsRuntimeCommandResult> {
    const sidecarRoot = resolveSidecarRoot();
    if (!sidecarRoot) {
      updateSetupState({ setupStage: "failed", setupMessage: "未找到本地 TTS 后端", setupProgress: 0 });
      return {
        success: false,
        status: await status(),
        error: `TTS sidecar not found. Checked: ${sidecarRoots.map(sidecarMainPath).join(", ")}`,
      };
    }
    const pyResult = await ensurePython();
    if (!pyResult.python) {
      return { success: false, status: await status(), error: pyResult.error };
    }
    const depsResult = await ensureDeps(sidecarRoot, pyResult.python);
    if (!depsResult.success) {
      return { success: false, status: await status(), error: depsResult.error };
    }
    updateSetupState({ setupStage: "ready", setupMessage: "Python 运行环境已配置", setupProgress: 100 });
    return { success: true, status: await status() };
  }

  async function prepareAlignmentModel(): Promise<TtsRuntimeCommandResult> {
    const setupResult = await setup();
    if (!setupResult.success) return setupResult;

    const startResult = await start();
    if (!startResult.success) return startResult;

    type ModelStatusPayload = {
      models?: Array<{ model_name?: unknown; downloaded?: unknown; downloading?: unknown }>;
    };
    type ProgressPayload = { status?: unknown; error?: unknown };

    const readModelStatus = async () => {
      const payload = await request("GET", "/models/status") as ModelStatusPayload;
      const model = Array.isArray(payload.models)
        ? payload.models.find((item) => item?.model_name === ALIGNMENT_MODEL_NAME)
        : undefined;
      if (!model) throw new Error(`TTS 后端未提供 ${ALIGNMENT_MODEL_NAME} 模型`);
      return model;
    };

    try {
      const current = await readModelStatus();
      if (current.downloaded === true) {
        updateSetupState({ setupStage: "ready", setupMessage: "Whisper 对齐模型已就绪", setupProgress: 100 });
        return { success: true, status: await status() };
      }
      if (current.downloading !== true) {
        await request("POST", "/models/download", { model_name: ALIGNMENT_MODEL_NAME });
      }

      for (let attempt = 0; attempt < alignmentModelPollAttempts; attempt += 1) {
        updateSetupState({
          setupStage: "downloading-model",
          setupMessage: "正在准备 Whisper 原文对齐模型",
          setupProgress: undefined,
        });
        const progress = await request("GET", `/models/progress-json/${encodeURIComponent(ALIGNMENT_MODEL_NAME)}`) as ProgressPayload;
        if (progress.status === "error") {
          const detail = typeof progress.error === "string" && progress.error.trim() ? `: ${progress.error}` : "";
          updateSetupState({ setupStage: "failed", setupMessage: "Whisper 对齐模型下载失败", setupProgress: undefined });
          return { success: false, status: await status(), error: `Whisper 对齐模型下载失败${detail}` };
        }
        const next = await readModelStatus();
        if (next.downloaded === true) {
          updateSetupState({ setupStage: "ready", setupMessage: "Whisper 对齐模型已就绪", setupProgress: 100 });
          return { success: true, status: await status() };
        }
        await sleep(alignmentModelPollIntervalMs);
      }
      updateSetupState({ setupStage: "failed", setupMessage: "Whisper 对齐模型下载超时", setupProgress: undefined });
      return { success: false, status: await status(), error: "Whisper 对齐模型下载超时，请检查网络后重试" };
    } catch (error) {
      updateSetupState({ setupStage: "failed", setupMessage: "Whisper 对齐模型准备失败", setupProgress: undefined });
      return { success: false, status: await status(), error: `Whisper 对齐模型准备失败: ${getErrorMessage(error)}` };
    }
  }

  async function setModelCacheDir(dirPath: string): Promise<TtsRuntimeCommandResult> {
    if (await isBackendHealthy()) {
      return {
        success: false,
        status: await status(),
        error: "请先停止本地 TTS 后端，再切换模型缓存路径",
      };
    }
    saveModelCacheDir(dirPath);
    return { success: true, status: await status() };
  }

  async function getConfig(): Promise<TtsRuntimeConfig> {
    return getRuntimeConfig();
  }

  async function setConfig(config: Partial<TtsRuntimeConfig>): Promise<TtsRuntimeCommandResult> {
    if (await isBackendHealthy()) {
      return {
        success: false,
        status: await status(),
        error: "请先停止本地 TTS 后端，再修改 Python 运行环境配置",
      };
    }
    try {
      saveRuntimeConfig(config);
    } catch (error) {
      return { success: false, status: await status(), error: getErrorMessage(error) };
    }
    return { success: true, status: await status() };
  }

  async function stop(): Promise<TtsRuntimeCommandResult> {
    if (child) {
      child.kill();
      child = null;
      const stopped = await waitUntilStopped();
      if (!stopped) {
        return {
          success: false,
          status: await status(),
          error: "TTS 后端未能在预期时间内停止",
        };
      }
      return { success: true, status: await status() };
    }
    const health = await getBackendHealth();
    if (health.healthy) {
      try {
        await requestBackendShutdown();
        const stopped = await waitUntilStopped();
        if (stopped) return { success: true, status: await status() };
        const staleStopped = await stopStaleBackendProcess(health);
        if (staleStopped) return { success: true, status: await status() };
        return {
          success: false,
          status: await status(),
          error: "已发送停止请求，但本地 TTS 后端仍在运行",
        };
      } catch (error) {
        const staleStopped = await stopStaleBackendProcess(health);
        if (staleStopped) return { success: true, status: await status() };
        return {
          success: false,
          status: await status(),
          error: `检测到本地 TTS 残留进程，但自动清理失败；请关闭对应 Python 进程后再刷新。原始错误：${getErrorMessage(error)}`,
        };
      }
    }
    return { success: true, status: await status() };
  }

  function buildRequestOptions(method: string, body?: unknown): FetchJsonOptions {
    const hasBody = body !== undefined && method.toUpperCase() !== "GET";
    const headers: Record<string, string> = {
      "X-Manying-TTS-Token": getControlToken(),
    };
    if (hasBody) headers["Content-Type"] = "application/json";
    return {
      method,
      headers,
      body: hasBody ? JSON.stringify(body) : undefined,
    };
  }

  async function request(method: string, routePath: string, body?: unknown) {
    const requestUrl = `${baseUrl}${normalizeRoutePath(routePath)}`;
    try {
      return await fetchWithTtsDeadline(requestTimeoutMs, (signal) => (
        fetchJson(requestUrl, { ...buildRequestOptions(method, body), signal })
      ));
    } catch (error) {
      throw withTtsRequestContext(error, method, requestUrl);
    }
  }

  async function requestBytes(method: string, routePath: string, body?: unknown) {
    const requestUrl = `${baseUrl}${normalizeRoutePath(routePath)}`;
    try {
      return await fetchWithTtsDeadline(requestTimeoutMs, (signal) => (
        fetchBytes(requestUrl, { ...buildRequestOptions(method, body), signal })
      ));
    } catch (error) {
      throw withTtsRequestContext(error, method, requestUrl);
    }
  }

  /** Upload audio file as FormData (for voice sample upload). */
  async function requestFormData(routePath: string, audioFilePath: string, referenceText?: string) {
    const requestUrl = `${baseUrl}${normalizeRoutePath(routePath)}`;
    try {
      // Read file from disk
      const fileBuffer = fs.readFileSync(audioFilePath);
      const fileName = routePath.split("/").pop() ?? "audio.wav";
      // Build multipart form-data manually
      const boundary = `----FormBoundary${crypto.randomUUID().replace(/-/g, "")}`;
      const parts: Buffer[] = [];

      // file part
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ));
      parts.push(fileBuffer);
      parts.push(Buffer.from("\r\n"));

      // reference_text part
      if (referenceText) {
        parts.push(Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="reference_text"\r\n\r\n${referenceText}\r\n`,
        ));
      }

      parts.push(Buffer.from(`--${boundary}--\r\n`));

      const response = await fetchWithTtsDeadline(requestTimeoutMs, (signal) => fetch(requestUrl, {
        method: "POST",
        headers: {
          "X-Manying-TTS-Token": getControlToken(),
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body: Buffer.concat(parts),
        signal,
      }));

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw createTtsBackendHttpError(text, response.status);
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        return response.json();
      }
      return response.text();
    } catch (error) {
      throw withTtsRequestContext(error, "POST", requestUrl);
    }
  }

  async function readRequirements(): Promise<{ content: string; path: string } | null> {
    const sidecarRoot = resolveSidecarRoot();
    if (!sidecarRoot) return null;
    // Always read the currently active sidecar copy; persisted installed-item
    // paths are display history and may point at a previous installation.
    const reqPath = path.join(sidecarRoot, "requirements.txt");
    const content = readTextFile(reqPath);
    if (content === null) return null;
    return { content, path: reqPath };
  }

  async function migrateStorage(): Promise<TtsRuntimeCommandResult> {
    const layout = getStorageLayout();
    if (layout.migrationState === "conflict") {
      return {
        success: false,
        status: await status(),
        error: layout.migrationMessage ?? "新的 TTS 文件夹已存在，无法安全迁移旧数据",
      };
    }
    if (layout.migrationState === "up-to-date") {
      return { success: true, status: await status() };
    }

    const stopResult = await stop();
    if (!stopResult.success) {
      return { success: false, status: await status(), error: stopResult.error ?? "停止 TTS 后端失败" };
    }

    try {
      const modelPlan = await buildModelMigrationPlan(layout.modelsDir);
      if (modelPlan.conflicts.length > 0) {
        return {
          success: false,
          status: await status(),
          error: `以下模型目录内容不一致，未迁移：${modelPlan.conflicts.join("、")}`,
        };
      }

      ensureDir(layout.rootDir);
      if (layout.legacyRuntimeExists) renameFile(layout.legacyRuntimeDir, layout.runtimeDir);
      ensureDir(layout.modelsDir);
      for (const action of modelPlan.actions) {
        if (action.kind === "move") {
          renameFile(action.sourceDir, action.targetDir);
        } else {
          fs.rmSync(action.sourceDir, { recursive: true, force: true });
        }
      }

      const config = readConfig();
      const legacyModelPaths = [layout.legacyModelsDir, layout.legacyDefaultModelsDir, layout.legacyCacheModelsDir];
      const configuredModelCacheDir = config.modelCacheDir;
      const usesLegacyOrUnsetModelDir = !configuredModelCacheDir || legacyModelPaths.some((legacyPath) => (
        normalizeUserPath(configuredModelCacheDir) === normalizeUserPath(legacyPath)
      ));
      if (usesLegacyOrUnsetModelDir) {
        writeConfig({ ...config, modelCacheDir: layout.modelsDir });
      }
      return { success: true, status: await status() };
    } catch (error) {
      return { success: false, status: await status(), error: `迁移 TTS 文件夹失败: ${getErrorMessage(error)}` };
    }
  }

  async function deleteRuntime(): Promise<TtsRuntimeCommandResult> {
    const targetDir = runtimePythonDir();
    try {
      const stopResult = await stop();
      if (!stopResult.success) {
        return { success: false, status: await status(), error: stopResult.error ?? "停止 TTS 后端失败" };
      }
      if (fileExists(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
      writeConfig({ ...readConfig(), installedItems: undefined });
      updateSetupState({ setupStage: "idle", setupMessage: undefined, setupProgress: undefined });
      return { success: true, status: await status() };
    } catch (error) {
      return { success: false, status: await status(), error: `删除 Python 运行环境失败: ${getErrorMessage(error)}` };
    }
  }

  /**
   * Read-only model inventory that runs the backend's `tts.model_inventory`
   * scanner through the managed Python without starting the HTTP server.
   * Used by `LocalTtsPanel.refresh()` when the backend is stopped, so users
   * can still see which models are already downloaded. The probe accepts no
   * renderer path payload, performs no download, and contacts no network.
   * Fail-closed: invalid output or command failure yields an empty list.
   */
  async function scanModelInventory(): Promise<BackendModelStatus[]> {
    const sidecarRoot = resolveSidecarRoot();
    if (!sidecarRoot) return [];
    const python = findManagedPython();
    if (!python) return [];
    const modelCacheDir = getModelCacheDir();
    const hfHubCacheDir = resolveHfHubCacheDir(modelCacheDir, fileExists);
    try {
      const result = await runPython(
        python,
        ["-m", "tts.model_inventory"],
        { timeout: 60_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, MANYING_TTS_MODELS_DIR: modelCacheDir, HF_HUB_CACHE: hfHubCacheDir } },
      ) as { stdout?: string };
      const parsed = parseJsonString(result.stdout);
      if (!isRecord(parsed) || !Array.isArray(parsed.models)) return [];
      return parsed.models as BackendModelStatus[];
    } catch {
      return [];
    }
  }

  return {
    status,
    start,
    setup,
    prepareAlignmentModel,
    stop,
    getConfig,
    getModelCacheDir,
    getStorageLayout,
    migrateStorage,
    setConfig,
    setModelCacheDir,
    request,
    requestBytes,
    requestFormData,
    readRequirements,
    deleteRuntime,
    scanModelInventory,
  };
}


export { ALIGNMENT_MODEL_NAME, DEFAULT_ALIGNMENT_MODEL_POLL_ATTEMPTS, DEFAULT_ALIGNMENT_MODEL_POLL_INTERVAL_MS, DEFAULT_TTS_HOST, DEFAULT_TTS_PORT, DEFAULT_TTS_REQUEST_TIMEOUT_MS, TTS_AUDIO_POOL_MAX_AGE_MS, TtsRuntimeError, createTtsBackendHttpError, decodeTtsErrorEnvelope, defaultFetchBytes, defaultFetchJson, defaultFetchRuntimeArchive, defaultFindListeningPids, defaultKillProcess, defaultPythonDownloadUrl, execFileAsync, expandHome, fetchWithTtsDeadline, findTtsErrorRecord, isValidPythonRuntimeSha256, isValidPythonRuntimeUrl, makeStatus, normalizeRoutePath, normalizeTtsTransportError, normalizeUserPath, resolveHfHubCacheDir, sidecarMainPath, uniquePaths, withTtsRequestContext } from "./tts-runtime-shared";
export type { BackendHealth, FetchBytesResult, FetchJsonOptions, ModelMigrationAction, RuntimeArchiveProgress, RuntimeArchiveResult, RuntimeConfig, SpawnedProcess, TtsRuntimeController, TtsRuntimeControllerDeps, TtsRuntimeErrorEnvelope } from "./tts-runtime-shared";
