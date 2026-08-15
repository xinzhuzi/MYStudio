import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { PNG } from "pngjs";
import { sampleFrontmostApplication } from "./smoke-focus.mjs";
import { terminateSpawnedApp } from "./smoke-process-lifecycle.mjs";

const APP_PROCESS_NAME = "漫影工作室";
const DEFAULT_DEBUG_PORT = 9400 + Math.floor(Math.random() * 400);
const DEFAULT_REPORT_PATH = resolve(
  process.cwd(),
  "output",
  "automation",
  "workflow-zoom-performance.json",
);
const DEBUG_PORT = parsePositiveInteger(
  process.env.MYSTUDIO_SMOKE_DEBUG_PORT,
  DEFAULT_DEBUG_PORT,
  "MYSTUDIO_SMOKE_DEBUG_PORT",
);
const REPORT_PATH = process.env.MYSTUDIO_ZOOM_PROBE_REPORT_PATH?.trim() || DEFAULT_REPORT_PATH;
const INPUT_REPORT_PATH = process.env.MYSTUDIO_ZOOM_PROBE_INPUT_REPORT_PATH?.trim() || "";
const USER_DATA_INPUT = resolveProbeUserDataInput({
  directUserDataDir: process.env.MYSTUDIO_ZOOM_PROBE_USER_DATA_DIR?.trim() || "",
  inputReportPath: INPUT_REPORT_PATH,
});
const USER_DATA_DIR = USER_DATA_INPUT.directory;
const APP_BIN_CANDIDATES = [
  process.env.MYSTUDIO_SMOKE_APP_BIN?.trim(),
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
const APP_BIN = APP_BIN_CANDIDATES.find((candidate) => existsSync(candidate)) ?? APP_BIN_CANDIDATES[0];
const THRESHOLDS = Object.freeze({
  maxFrameIntervalMs: 100,
  p95FrameIntervalMs: 33,
});
const VISUAL_PIXEL_THRESHOLDS = Object.freeze({
  transparentRatio: 0,
  maximumNearBlackBandHeightCss: 0,
});
const ZOOM_BOUNDS = Object.freeze({
  minimum: 0.18,
  maximum: 2,
  tolerance: 0.01,
});
const WHEEL_EVENT_COUNT = 48;
const WHEEL_DELTA_Y = 100;
const WHEEL_EVENT_INTERVAL_MS = 8;
const ROUND_SETTLEMENT_TIMEOUT_MS = 5_000;
const ROUND_SETTLEMENT_IDLE_MS = 260;
const ROUND_SETTLEMENT_STABLE_SAMPLE_COUNT = 2;
const ROUND_SETTLEMENT_POLL_INTERVAL_MS = 60;
const INITIAL_LAYOUT_TIMEOUT_MS = 20_000;
const INITIAL_LAYOUT_POLL_INTERVAL_MS = 250;
const CANVAS_SCREENSHOT_TIMEOUT_MS = 10_000;
let cdpCanvasCaptureAvailable = process.platform !== "darwin";

function resolveProbeUserDataInput({ directUserDataDir, inputReportPath }) {
  if (directUserDataDir) {
    return {
      directory: resolve(process.cwd(), directUserDataDir),
      source: "MYSTUDIO_ZOOM_PROBE_USER_DATA_DIR",
      inputReportPath: null,
    };
  }
  if (!inputReportPath) {
    return { directory: "", source: null, inputReportPath: null };
  }

  const absoluteReportPath = resolve(process.cwd(), inputReportPath);
  if (!existsSync(absoluteReportPath) || !statSync(absoluteReportPath).isFile()) {
    throw new Error(`MYSTUDIO_ZOOM_PROBE_INPUT_REPORT_PATH is not a file: ${absoluteReportPath}`);
  }
  let report;
  try {
    report = JSON.parse(readFileSync(absoluteReportPath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to parse workflow smoke report ${absoluteReportPath}: ${errorMessage(error)}`);
  }
  if (report.ok !== true) {
    throw new Error(`Workflow smoke report did not pass: ${absoluteReportPath}`);
  }
  if (report.result?.source !== "real-project-clone") {
    throw new Error(
      `Workflow smoke report result.source must be real-project-clone: ${absoluteReportPath}`,
    );
  }
  if (typeof report.userDataDir !== "string" || !isAbsolute(report.userDataDir)) {
    throw new Error(`Workflow smoke report userDataDir must be absolute: ${absoluteReportPath}`);
  }
  return {
    directory: report.userDataDir,
    source: "MYSTUDIO_ZOOM_PROBE_INPUT_REPORT_PATH",
    inputReportPath: absoluteReportPath,
  };
}

function parsePositiveInteger(rawValue, fallback, variableName) {
  if (rawValue == null || rawValue === "") return fallback;
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${variableName} must be an integer between 1 and 65535.`);
  }
  return value;
}

function sleep(durationMs) {
  return new Promise((resolveWait) => setTimeout(resolveWait, durationMs));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function writeReport(report) {
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[workflow-zoom-probe] report written ${REPORT_PATH}`);
}

function verifyRuntimeInputs() {
  if (!USER_DATA_DIR) {
    throw new Error(
      "MYSTUDIO_ZOOM_PROBE_INPUT_REPORT_PATH or MYSTUDIO_ZOOM_PROBE_USER_DATA_DIR is required.",
    );
  }
  if (!existsSync(USER_DATA_DIR) || !statSync(USER_DATA_DIR).isDirectory()) {
    throw new Error(`MYSTUDIO_ZOOM_PROBE_USER_DATA_DIR is not a directory: ${USER_DATA_DIR}`);
  }
  if (!APP_BIN || !existsSync(APP_BIN)) {
    throw new Error(`Packaged app was not found. Checked:\n${APP_BIN_CANDIDATES.join("\n")}`);
  }
  if (typeof WebSocket !== "function") {
    throw new Error("This Node runtime does not provide the built-in WebSocket required for CDP.");
  }
}

function readJson(url) {
  return new Promise((resolveJson, reject) => {
    const request = http.get(url, (response) => {
      let data = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        data += chunk;
      });
      response.on("end", () => {
        if (response.statusCode !== 200) {
          reject(new Error(`CDP endpoint ${url} returned ${response.statusCode ?? "unknown"}.`));
          return;
        }
        try {
          resolveJson(JSON.parse(data));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.setTimeout(5_000, () => request.destroy(new Error(`Timed out reading ${url}.`)));
    request.on("error", reject);
  });
}

async function waitForPageTarget() {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    try {
      const targets = await readJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const page = Array.isArray(targets)
        ? targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl)
        : null;
      if (page) return page;
    } catch {
      // Electron exposes the debugging endpoint after application startup.
    }
    await sleep(250);
  }
  throw new Error("No Electron page target appeared on the debugging port.");
}

function withTimeout(promise, label, timeoutMs) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function createCdpClient(pageTarget) {
  const socket = await withTimeout(
    new Promise((resolveSocket, reject) => {
      const nextSocket = new WebSocket(pageTarget.webSocketDebuggerUrl);
      nextSocket.addEventListener("open", () => resolveSocket(nextSocket), { once: true });
      nextSocket.addEventListener("error", reject, { once: true });
    }),
    "CDP WebSocket connection",
    10_000,
  );
  const pending = new Map();
  let messageId = 0;

  const rejectPending = (reason) => {
    for (const callback of pending.values()) callback.reject(reason);
    pending.clear();
  };

  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!message.id || !pending.has(message.id)) return;
    const callback = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) callback.reject(new Error(JSON.stringify(message.error)));
    else callback.resolve(message.result);
  });
  socket.addEventListener("close", () => {
    rejectPending(new Error("CDP socket closed before the probe completed."));
  });
  socket.addEventListener("error", () => {
    rejectPending(new Error("CDP socket errored before the probe completed."));
  });

  return {
    send(method, params = {}) {
      const response = new Promise((resolveResult, reject) => {
        const id = ++messageId;
        pending.set(id, { resolve: resolveResult, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
      return withTimeout(response, `CDP ${method}`, 10_000);
    },
    close() {
      rejectPending(new Error("CDP client closed during probe cleanup."));
      socket.close();
    },
  };
}

async function evaluate(cdp, expression, label) {
  const result = await withTimeout(
    cdp.send("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression,
    }),
    label,
    35_000,
  );
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text || label;
    throw new Error(`Runtime.evaluate failed: ${detail}`);
  }
  return result.result?.value;
}

async function activateProbeApp(cdp, processId) {
  if (!Number.isInteger(processId) || processId < 1) {
    throw new Error(`Unable to activate invalid MYStudio process id: ${processId}.`);
  }
  const activationScript = [
    'ObjC.import("AppKit")',
    `const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${processId})`,
    'if (!app) throw new Error("MYStudio process is not registered with AppKit")',
    "app.activateWithOptions($.NSApplicationActivateAllWindows | $.NSApplicationActivateIgnoringOtherApps)",
  ].join("; ");
  const activateApplication = () => new Promise((resolveActivation, rejectActivation) => {
    execFile("/usr/bin/osascript", [
      "-l",
      "JavaScript",
      "-e",
      activationScript,
    ], { timeout: 1_000, encoding: "utf8" }, (error, _stdout, stderr) => {
      if (error) {
        rejectActivation(new Error(
          `Unable to activate MYStudio process ${processId}: ${stderr.trim() || error.message}`,
        ));
      } else {
        resolveActivation();
      }
    });
  });
  const deadline = Date.now() + 5_000;
  let frontmostApplication = sampleFrontmostApplication("activate workflow probe");
  let activationError = null;
  while (Date.now() < deadline) {
    try {
      await withTimeout(cdp.send("Page.bringToFront"), "bring workflow probe page to front", 1_000);
      await activateApplication();
      activationError = null;
    } catch (error) {
      activationError = errorMessage(error);
      await sleep(250);
      continue;
    }
    await sleep(250);
    frontmostApplication = sampleFrontmostApplication("confirm workflow probe activation");
    if (frontmostApplication.processId === processId) return frontmostApplication;
  }
  throw new Error(
    `MYStudio process ${processId} did not become frontmost: ${JSON.stringify({ frontmostApplication, activationError })}`,
  );
}

function openStoryboardStageExpression() {
  return `(async () => {
    const projectProbeText = ${JSON.stringify(process.env.MYSTUDIO_SMOKE_PROJECT_NAME?.trim() || "")};
    const normalize = (node) => (node?.textContent || '').replace(/\\s+/g, ' ').trim();
    const wait = (durationMs) => new Promise((resolveWait) => setTimeout(resolveWait, durationMs));
    const waitFor = async (predicate, timeoutMs = 20_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const value = predicate();
        if (value) return value;
        await wait(200);
      }
      return null;
    };
    const activate = (node) => {
      if (!node) return false;
      node.scrollIntoView?.({ block: 'center', inline: 'center' });
      if (typeof node.click === 'function') {
        node.click();
      } else {
        node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, pointerType: 'mouse' }));
        node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 0, pointerType: 'mouse' }));
        node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, view: window }));
      }
      return true;
    };
    const interactive = () => Array.from(document.querySelectorAll('button, [role="button"], [role="menuitem"], [cmdk-item], .dashboard-project-card'));
    const clickText = (text, exact = false) => {
      const node = interactive().find((candidate) => exact ? normalize(candidate) === text : normalize(candidate).includes(text));
      return { clicked: activate(node), text: node ? normalize(node) : '' };
    };
    const canvasIsVisible = (canvas) => {
      if (!canvas || canvas.closest('[data-state="inactive"]')) return false;
      const style = getComputedStyle(canvas);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = canvas.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const canvasReady = () => {
      const canvas = document.querySelector('.workflow-node-canvas');
      return canvasIsVisible(canvas) && canvas.querySelectorAll('[data-flow-node-id]').length >= 6
        ? canvas
        : null;
    };

    let projectClick = { clicked: false, text: '' };
    if (!canvasReady()) {
      const project = await waitFor(
        () => interactive().find((candidate) => normalize(candidate).includes(projectProbeText)),
        20_000,
      );
      if (project) {
        projectClick = { clicked: activate(project), text: normalize(project) };
        await wait(500);
      }
      const workflowButton = await waitFor(
        () => interactive().find((node) => normalize(node) === '工作流' || normalize(node).includes('工作流')),
        20_000,
      );
      const workflowClick = { clicked: activate(workflowButton), text: workflowButton ? normalize(workflowButton) : '' };
      if (!workflowClick.clicked) {
        const bridgeAvailable = Boolean(window.mystudioWorkflowSmoke?.setWorkflowStage);
        const visibleControls = interactive().map((node) => normalize(node)).filter(Boolean).slice(0, 24);
        const bodyPreview = normalize(document.body).slice(0, 500);
        throw new Error('Workflow navigation was not available. bridge=' + bridgeAvailable + ' controls=' + JSON.stringify(visibleControls) + ' body=' + JSON.stringify(bodyPreview));
      }
      await wait(300);
      if (!canvasReady()) {
        const backButton = interactive().find((node) => normalize(node) === '返回');
        if (backButton) {
          activate(backButton);
          await wait(500);
        }
      }
      if (await waitFor(canvasReady, 8_000)) {
        return {
          projectClick,
          workflowClick,
          stageClick: { clicked: false, text: '分镜视频生成 already active' },
        };
      }
      const switcher = await waitFor(() => interactive().find((node) => normalize(node).includes('切换阶段')));
      if (!activate(switcher)) throw new Error('Workflow stage switcher was not available.');
      const storyboardStage = await waitFor(
        () => interactive().find((node) => normalize(node).includes('分镜视频生成')),
        20_000,
      );
      if (!activate(storyboardStage)) {
        const visibleControls = interactive().map((node) => normalize(node)).filter(Boolean).slice(0, 32);
        const bodyPreview = normalize(document.body).slice(0, 700);
        throw new Error('The 分镜视频生成 stage was not available. controls=' + JSON.stringify(visibleControls) + ' body=' + JSON.stringify(bodyPreview));
      }
      await waitFor(canvasReady);
      return { projectClick, workflowClick, stageClick: { clicked: true, text: normalize(storyboardStage) } };
    }
    return {
      projectClick,
      workflowClick: { clicked: false, text: 'workflow already active' },
      stageClick: { clicked: false, text: '分镜视频生成 already active' },
    };
  })()`;
}

function captureEvidenceExpression(checkpoint) {
  const includesFullNodeGeometry = requiresFullNodeGeometry(checkpoint);
  return `(() => {
    const includesFullNodeGeometry = ${JSON.stringify(includesFullNodeGeometry)};
    const projectProbeText = ${JSON.stringify(process.env.MYSTUDIO_SMOKE_PROJECT_NAME?.trim() || "")};
    const canvas = document.querySelector('.workflow-node-canvas');
    const viewport = canvas?.querySelector('.react-flow__viewport') || document.querySelector('.react-flow__viewport');
    const staticBackground = canvas?.querySelector('.workflow-node-static-background');
    const controls = canvas?.querySelector('.workflow-node-viewport-controls');
    const toRect = (element) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return {
        left: value.left,
        top: value.top,
        right: value.right,
        bottom: value.bottom,
        width: value.width,
        height: value.height,
      };
    };
    const nodeIds = includesFullNodeGeometry
      ? [...new Set(Array.from(document.querySelectorAll('[data-flow-node-id]'))
        .map((node) => node.getAttribute('data-flow-node-id') || '')
        .filter(Boolean))]
      : [];
    const nodeRects = includesFullNodeGeometry
      ? nodeIds.map((id) => {
        const element = canvas?.querySelector('[data-flow-node-id="' + id + '"]');
        return { id, rect: toRect(element) };
      }).filter((entry) => entry.rect && entry.rect.width > 0 && entry.rect.height > 0)
      : [];
    const storyboardEntryElements = Array.from(document.querySelectorAll('[data-storyboard-id]'));
    const storyboardEntryIds = new Set(
      storyboardEntryElements
        .map((node) => node.getAttribute('data-storyboard-id') || '')
        .filter(Boolean),
    );
    const images = Array.from(document.images);
    const rect = canvas?.getBoundingClientRect();
    const canvasRect = toRect(canvas);
    const controlsRect = toRect(controls);
    const clippedNodeIds = includesFullNodeGeometry && canvasRect ? nodeRects
      .filter(({ rect: nodeRect }) => (
        nodeRect.left < canvasRect.left - 1 ||
        nodeRect.top < canvasRect.top - 1 ||
        nodeRect.right > canvasRect.right + 1 ||
        nodeRect.bottom > canvasRect.bottom + 1
      ))
      .map(({ id }) => id) : nodeIds;
    const overlappingNodePairs = [];
    if (includesFullNodeGeometry) {
      for (let leftIndex = 0; leftIndex < nodeRects.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < nodeRects.length; rightIndex += 1) {
          const leftNode = nodeRects[leftIndex];
          const rightNode = nodeRects[rightIndex];
          const overlaps = !(
            leftNode.rect.right <= rightNode.rect.left + 1 ||
            rightNode.rect.right <= leftNode.rect.left + 1 ||
            leftNode.rect.bottom <= rightNode.rect.top + 1 ||
            rightNode.rect.bottom <= leftNode.rect.top + 1
          );
          if (overlaps) overlappingNodePairs.push([leftNode.id, rightNode.id]);
        }
      }
    }
    const controlsOverlapNodeIds = includesFullNodeGeometry && controlsRect ? nodeRects
      .filter(({ rect: nodeRect }) => !(
        nodeRect.right <= controlsRect.left ||
        controlsRect.right <= nodeRect.left ||
        nodeRect.bottom <= controlsRect.top ||
        controlsRect.bottom <= nodeRect.top
      ))
      .map(({ id }) => id) : [];
    const firstNodeRect = includesFullNodeGeometry
      ? nodeRects.find(({ id }) => id === 'script')?.rect || null
      : null;
    const topmostNode = includesFullNodeGeometry
      ? nodeRects.reduce(
        (topmost, entry) => !topmost || entry.rect.top < topmost.rect.top ? entry : topmost,
        null,
      )
      : null;
    return {
      includesFullNodeGeometry,
      canvasPresent: Boolean(canvas),
      canvasInteracting: Boolean(canvas?.classList.contains('workflow-node-canvas-interacting')),
      bodyHasProjectName: (document.body.innerText || '').includes(projectProbeText),
      storyboardStageVisible: (document.body.innerText || '').includes('分镜视频生成'),
      nodeIds,
      nodeCount: nodeIds.length,
      productionEdgeCount: document.querySelectorAll('.production-flow-edge').length,
      storyboardEntryCount: storyboardEntryIds.size,
      storyboardElementCount: storyboardEntryElements.length,
      viewportPresent: Boolean(viewport),
      staticBackgroundPresent: Boolean(staticBackground),
      staticBackgroundColor: staticBackground ? getComputedStyle(staticBackground).backgroundColor : '',
      controlsPresent: Boolean(
        canvas?.querySelector('.workflow-node-viewport-controls, .react-flow__controls') ||
        document.querySelector('.workflow-node-viewport-controls, .react-flow__controls'),
      ),
      domElementCount: document.getElementsByTagName('*').length,
      reactFlowNodeCount: document.querySelectorAll('.react-flow__node').length,
      imageCount: images.length,
      loadedImageCount: images.filter((image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0).length,
      viewportTransform: viewport ? getComputedStyle(viewport).transform : '',
      canvasRect,
      controlsRect,
      nodeRects,
      clippedNodeIds,
      overlappingNodePairs,
      controlsOverlapNodeIds,
      firstNodeLeftOverflow: Boolean(
        canvasRect && firstNodeRect && firstNodeRect.left < canvasRect.left - 1
      ),
      topBlankRatio: canvasRect && topmostNode
        ? Math.max(0, topmostNode.rect.top - canvasRect.top) / canvasRect.height
        : null,
      canvasCenter: rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null,
      canvasSize: rect ? { width: rect.width, height: rect.height } : null,
    };
  })()`;
}

function startRoundExpression() {
  return `(() => {
    const existing = window.__mystudioWorkflowZoomProbe;
    existing?.stop?.();
    const canvas = document.querySelector('.workflow-node-canvas');
    const viewport = canvas?.querySelector('.react-flow__viewport') || document.querySelector('.react-flow__viewport');
    if (!canvas || !viewport) throw new Error('Production React Flow canvas or viewport is missing.');
    const getZoom = (transform) => {
      const match = String(transform || '').match(/matrix(?:3d)?\\(([^)]+)\\)/);
      if (!match) return null;
      const scale = Number(match[1].split(',')[0]?.trim());
      return Number.isFinite(scale) ? scale : null;
    };
    const captureMetrics = () => {
      const images = Array.from(document.images);
      const transform = getComputedStyle(viewport).transform;
      return {
        domElementCount: document.getElementsByTagName('*').length,
        reactFlowNodeCount: document.querySelectorAll('.react-flow__node').length,
        imageCount: images.length,
        loadedImageCount: images.filter((image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0).length,
        viewportTransform: transform,
        zoom: getZoom(transform),
      };
    };
    const rect = canvas.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) throw new Error('Production canvas has no measurable size.');
    const frameTimestampsMs = [];
    const viewportMutationTimesMs = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'attributes' && record.target === viewport && record.attributeName === 'style') {
          viewportMutationTimesMs.push(performance.now());
        }
      }
    });
    observer.observe(viewport, { attributes: true, attributeFilter: ['style'] });
    let frameId = 0;
    const onFrame = (timestamp) => {
      frameTimestampsMs.push(timestamp);
      frameId = requestAnimationFrame(onFrame);
    };
    frameId = requestAnimationFrame(onFrame);
    const state = {
      startedAtMs: performance.now(),
      startMetrics: captureMetrics(),
      center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      frameTimestampsMs,
      viewportMutationTimesMs,
      stop() {
        cancelAnimationFrame(frameId);
        observer.disconnect();
        const target = document.elementFromPoint(this.center.x, this.center.y);
        return {
          startedAtMs: this.startedAtMs,
          startZoom: this.startMetrics.zoom,
          endMetrics: captureMetrics(),
          center: this.center,
          targetAtCanvasCenter: target ? {
            tagName: target.tagName,
            className: typeof target.className === 'string' ? target.className : '',
          } : null,
          frameTimestampsMs: [...this.frameTimestampsMs],
          viewportMutationTimesMs: [...this.viewportMutationTimesMs],
        };
      },
    };
    window.__mystudioWorkflowZoomProbe = state;
    return { startZoom: state.startMetrics.zoom, center: state.center };
  })()`;
}

function stopRoundExpression() {
  return `(() => {
    const state = window.__mystudioWorkflowZoomProbe;
    if (!state?.stop) throw new Error('Zoom frame collector was not started.');
    try {
      return state.stop();
    } finally {
      delete window.__mystudioWorkflowZoomProbe;
    }
  })()`;
}

function percentile(values, percentileValue) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * percentileValue) - 1)];
}

function finiteIntervals(frameTimestampsMs) {
  const intervals = [];
  for (let index = 1; index < frameTimestampsMs.length; index += 1) {
    const interval = frameTimestampsMs[index] - frameTimestampsMs[index - 1];
    if (Number.isFinite(interval) && interval >= 0) intervals.push(interval);
  }
  return intervals;
}

function isAtZoomBound(direction, zoom) {
  if (!Number.isFinite(zoom)) return false;
  return direction === "zoom-in"
    ? zoom >= ZOOM_BOUNDS.maximum - ZOOM_BOUNDS.tolerance
    : zoom <= ZOOM_BOUNDS.minimum + ZOOM_BOUNDS.tolerance;
}

async function captureMacCanvasPng(cdp, canvasRect) {
  const windowMetrics = await evaluate(cdp, `(() => ({
    screenX: window.screenX,
    screenY: window.screenY,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  }))()`, "measure macOS canvas capture coordinates");
  const requiredMetrics = [
    windowMetrics?.screenX,
    windowMetrics?.screenY,
    windowMetrics?.outerWidth,
    windowMetrics?.outerHeight,
    windowMetrics?.innerWidth,
    windowMetrics?.innerHeight,
  ];
  if (!requiredMetrics.every(Number.isFinite)) {
    throw new Error("macOS canvas capture window metrics are incomplete.");
  }
  const horizontalInset = Math.max(0, (windowMetrics.outerWidth - windowMetrics.innerWidth) / 2);
  const topInset = Math.max(0, windowMetrics.outerHeight - windowMetrics.innerHeight);
  const captureRect = {
    x: Math.round(windowMetrics.screenX + horizontalInset + canvasRect.left),
    y: Math.round(windowMetrics.screenY + topInset + canvasRect.top),
    width: Math.max(1, Math.round(canvasRect.width)),
    height: Math.max(1, Math.round(canvasRect.height)),
  };
  const outputPath = resolve(
    tmpdir(),
    `mystudio-workflow-zoom-${process.pid}-${Date.now()}.png`,
  );
  try {
    await new Promise((resolveCapture, rejectCapture) => {
      execFile("/usr/sbin/screencapture", [
        "-x",
        `-R${captureRect.x},${captureRect.y},${captureRect.width},${captureRect.height}`,
        outputPath,
      ], { timeout: CANVAS_SCREENSHOT_TIMEOUT_MS, encoding: "utf8" }, (error, _stdout, stderr) => {
        if (error) {
          rejectCapture(new Error(
            `macOS screencapture failed: ${stderr.trim() || error.message}`,
          ));
          return;
        }
        resolveCapture();
      });
    });
    const buffer = readFileSync(outputPath);
    const png = PNG.sync.read(buffer);
    return {
      source: "macos-screencapture",
      buffer,
      png,
      captureRect,
      windowMetrics,
      pixelScaleX: png.width / captureRect.width,
      pixelScaleY: png.height / captureRect.height,
    };
  } finally {
    if (existsSync(outputPath)) unlinkSync(outputPath);
  }
}

async function captureCanvasVisualMetrics(cdp, geometry) {
  const canvasRect = geometry?.canvasRect;
  if (!(canvasRect?.width > 0 && canvasRect?.height > 0)) {
    return { passed: false, error: "Canvas rect is unavailable for screenshot capture." };
  }
  let capture;
  let cdpCaptureError = null;
  let cdpCaptureFailure = null;
  if (cdpCanvasCaptureAvailable) {
    try {
      const screenshot = await withTimeout(
        cdp.send("Page.captureScreenshot", {
          format: "png",
          fromSurface: false,
          captureBeyondViewport: false,
          clip: {
            x: Math.max(0, canvasRect.left),
            y: Math.max(0, canvasRect.top),
            width: canvasRect.width,
            height: canvasRect.height,
            scale: 1,
          },
        }),
        "capture production canvas screenshot",
        CANVAS_SCREENSHOT_TIMEOUT_MS,
      );
      const buffer = Buffer.from(screenshot.data, "base64");
      capture = {
        source: "cdp-canvas-screenshot",
        buffer,
        png: PNG.sync.read(buffer),
        pixelScaleX: 1,
        pixelScaleY: 1,
      };
    } catch (error) {
      cdpCanvasCaptureAvailable = false;
      cdpCaptureError = errorMessage(error);
      cdpCaptureFailure = error;
    }
  }
  if (!capture) {
    if (process.platform !== "darwin") {
      throw cdpCaptureFailure ?? new Error("CDP canvas capture is unavailable.");
    }
    capture = await captureMacCanvasPng(cdp, canvasRect);
  }
  const { png } = capture;
  const columnStride = Math.max(1, Math.floor(png.width / 720));
  const rowLuminance = [];
  let sampledPixels = 0;
  let transparentPixels = 0;
  for (let y = 0; y < png.height; y += 1) {
    let luminanceTotal = 0;
    let rowSamples = 0;
    for (let x = 0; x < png.width; x += columnStride) {
      const offset = (png.width * y + x) * 4;
      const red = png.data[offset];
      const green = png.data[offset + 1];
      const blue = png.data[offset + 2];
      const alpha = png.data[offset + 3];
      luminanceTotal += red * 0.2126 + green * 0.7152 + blue * 0.0722;
      rowSamples += 1;
      sampledPixels += 1;
      if (alpha < 255) transparentPixels += 1;
    }
    rowLuminance.push(rowSamples > 0 ? luminanceTotal / rowSamples : 0);
  }
  const sortedRows = [...rowLuminance].sort((left, right) => left - right);
  const medianRowLuminance = sortedRows[Math.floor(sortedRows.length / 2)] ?? 0;
  const bandThreshold = Math.max(3, medianRowLuminance * 0.55);
  const edgeMargin = Math.floor(png.height * 0.08);
  let currentBandHeight = 0;
  let maximumBandHeight = 0;
  for (let y = 0; y < rowLuminance.length; y += 1) {
    const isInterior = y >= edgeMargin && y < rowLuminance.length - edgeMargin;
    if (isInterior && rowLuminance[y] < bandThreshold) {
      currentBandHeight += 1;
      maximumBandHeight = Math.max(maximumBandHeight, currentBandHeight);
    } else {
      currentBandHeight = 0;
    }
  }
  const transparentRatio = sampledPixels > 0 ? transparentPixels / sampledPixels : 1;
  const maximumNearBlackBandHeightCss = maximumBandHeight / capture.pixelScaleY;
  return {
    source: capture.source,
    width: png.width,
    height: png.height,
    bytes: capture.buffer.length,
    pixelScaleX: capture.pixelScaleX,
    pixelScaleY: capture.pixelScaleY,
    captureRect: capture.captureRect ?? null,
    windowMetrics: capture.windowMetrics ?? null,
    cdpCaptureError,
    transparentRatio,
    medianRowLuminance,
    bandThreshold,
    maximumNearBlackBandHeight: maximumBandHeight,
    maximumNearBlackBandHeightCss,
    passed:
      transparentRatio === VISUAL_PIXEL_THRESHOLDS.transparentRatio &&
      maximumNearBlackBandHeightCss === VISUAL_PIXEL_THRESHOLDS.maximumNearBlackBandHeightCss,
  };
}

function summarizeRound(
  direction,
  round,
  snapshot,
  interactionGeometry,
  interactionVisualEvidence,
  settledGeometry,
  settledVisualEvidence,
  dispatchedEventCount,
  settlement,
) {
  const frameIntervalsMs = finiteIntervals(snapshot.frameTimestampsMs);
  const maxFrameIntervalMs = frameIntervalsMs.length > 0 ? Math.max(...frameIntervalsMs) : null;
  const p95FrameIntervalMs = percentile(frameIntervalsMs, 0.95);
  const endZoom = snapshot.endMetrics?.zoom ?? null;
  const zoomChanged = Number.isFinite(snapshot.startZoom) && Number.isFinite(endZoom)
    ? Math.abs(endZoom - snapshot.startZoom) > 0.0001
    : false;
  const zoomBoundReached = isAtZoomBound(direction, endZoom);
  const fitApplied = direction === "fit"
    ? zoomChanged && endZoom >= ZOOM_BOUNDS.minimum && endZoom <= ZOOM_BOUNDS.maximum
    : zoomBoundReached;
  const geometryFailureReasons = evidenceIssues(settledGeometry, direction);
  const frameEvidenceComplete = frameIntervalsMs.length > 0 && Number.isFinite(maxFrameIntervalMs) && Number.isFinite(p95FrameIntervalMs);
  const passed =
    frameEvidenceComplete &&
    zoomChanged &&
    fitApplied &&
    snapshot.viewportMutationTimesMs.length > 0 &&
    settlement?.settled === true &&
    geometryFailureReasons.length === 0 &&
    interactionVisualEvidence?.passed === true &&
    settledVisualEvidence?.passed === true &&
    maxFrameIntervalMs <= THRESHOLDS.maxFrameIntervalMs;
  return {
    direction,
    round,
    dispatchedEventCount,
    startZoom: snapshot.startZoom,
    endZoom,
    zoomChanged,
    zoomBoundReached,
    fitApplied,
    geometry: settledGeometry,
    interactionGeometry,
    geometryFailureReasons,
    interactionVisualEvidence,
    settledVisualEvidence,
    settlement,
    frameTimestampsMs: snapshot.frameTimestampsMs,
    frameIntervalsMs,
    maxFrameIntervalMs,
    p95FrameIntervalMs,
    frameIntervalsOver33Ms: frameIntervalsMs.filter((interval) => interval > THRESHOLDS.p95FrameIntervalMs).length,
    frameIntervalsOver100Ms: frameIntervalsMs.filter((interval) => interval > THRESHOLDS.maxFrameIntervalMs).length,
    viewportTransformMutationCount: snapshot.viewportMutationTimesMs.length,
    viewportMutationTimesMs: snapshot.viewportMutationTimesMs,
    domElementCount: snapshot.endMetrics?.domElementCount ?? null,
    reactFlowNodeCount: snapshot.endMetrics?.reactFlowNodeCount ?? null,
    imageCount: snapshot.endMetrics?.imageCount ?? null,
    loadedImageCount: snapshot.endMetrics?.loadedImageCount ?? null,
    viewportTransform: snapshot.endMetrics?.viewportTransform ?? "",
    canvasCenter: snapshot.center,
    targetAtCanvasCenter: snapshot.targetAtCanvasCenter,
    passed,
  };
}

async function waitForRoundSettlement(cdp, direction, round) {
  const deadline = Date.now() + ROUND_SETTLEMENT_TIMEOUT_MS;
  let lastEvidence = null;
  let lastSignature = null;
  let lastMutationCount = null;
  let stableSampleCount = 0;
  let lastIssues = [];

  while (Date.now() < deadline) {
    await sleep(ROUND_SETTLEMENT_POLL_INTERVAL_MS);
    const sample = await evaluate(cdp, `(() => {
      const state = window.__mystudioWorkflowZoomProbe;
      return {
        timestamp: performance.now(),
        viewportMutationCount: state?.viewportMutationTimesMs?.length ?? 0,
        lastViewportMutationAtMs: state?.viewportMutationTimesMs?.at(-1) ?? null,
      };
    })()`, `read ${direction} round ${round} viewport settlement state`);
    lastEvidence = await evaluate(
      cdp,
      captureEvidenceExpression(direction),
      `capture ${direction} round ${round} settlement evidence`,
    );
    lastIssues = evidenceIssues(lastEvidence, direction);
    const signature = lastIssues.length === 0
      ? stableCanvasLayoutSignature(lastEvidence)
      : null;
    const idleForMs = Number.isFinite(sample?.lastViewportMutationAtMs)
      ? sample.timestamp - sample.lastViewportMutationAtMs
      : null;
    const isQuietStableFrame =
      sample?.viewportMutationCount > 0 &&
      signature !== null &&
      signature === lastSignature &&
      sample.viewportMutationCount === lastMutationCount &&
      Number.isFinite(idleForMs) &&
      idleForMs >= ROUND_SETTLEMENT_IDLE_MS;
    stableSampleCount = isQuietStableFrame ? stableSampleCount + 1 : 0;
    if (stableSampleCount >= ROUND_SETTLEMENT_STABLE_SAMPLE_COUNT) {
      return {
        settled: true,
        timeoutMs: ROUND_SETTLEMENT_TIMEOUT_MS,
        stableSampleCount,
        viewportMutationCountAtSettle: sample.viewportMutationCount,
        lastSignature: signature,
        issues: [],
      };
    }
    lastSignature = signature;
    lastMutationCount = sample?.viewportMutationCount ?? null;
  }

  return {
    settled: false,
    timeoutMs: ROUND_SETTLEMENT_TIMEOUT_MS,
    stableSampleCount,
    viewportMutationCountAtSettle: lastMutationCount,
    lastSignature,
    issues: lastIssues,
  };
}

const FULL_NODE_GEOMETRY_CHECKPOINTS = new Set(["initial", "fit", "resize"]);

function requiresFullNodeGeometry(checkpoint) {
  return FULL_NODE_GEOMETRY_CHECKPOINTS.has(checkpoint);
}

function evidenceIssues(evidence, checkpoint) {
  const issues = [];
  if (!evidence?.bodyHasProjectName) issues.push("Project name evidence is absent from the active document.");
  if (!evidence?.storyboardStageVisible) issues.push("The 分镜视频生成 stage is not visible.");
  if (!evidence?.canvasPresent) issues.push(".workflow-node-canvas is absent.");
  if (evidence?.productionEdgeCount !== 5) issues.push(`Expected five .production-flow-edge elements, received ${evidence?.productionEdgeCount ?? "none"}.`);
  if (evidence?.storyboardEntryCount !== 43) issues.push(`Expected 43 [data-storyboard-id] entries, received ${evidence?.storyboardEntryCount ?? "none"}.`);
  if (!evidence?.viewportPresent) issues.push(".react-flow__viewport is absent.");
  if (!evidence?.staticBackgroundPresent) issues.push("Static production canvas background is absent.");
  if (!evidence?.staticBackgroundColor || evidence.staticBackgroundColor === "rgba(0, 0, 0, 0)") {
    issues.push("Static production canvas background is transparent.");
  }
  if (!evidence?.controlsPresent) issues.push("React Flow controls are absent.");
  if (requiresFullNodeGeometry(checkpoint)) {
    if (evidence?.nodeCount !== 6) issues.push(`Expected six data-flow nodes, received ${evidence?.nodeCount ?? "none"}.`);
    if (evidence?.nodeRects?.length !== 6) issues.push(`Expected six measurable node rects, received ${evidence?.nodeRects?.length ?? "none"}.`);
    if (evidence?.clippedNodeIds?.length > 0) issues.push(`Canvas-clipped nodes: ${evidence.clippedNodeIds.join(", ")}.`);
    if (evidence?.overlappingNodePairs?.length > 0) issues.push(`Overlapping node pairs: ${JSON.stringify(evidence.overlappingNodePairs)}.`);
    if (evidence?.controlsOverlapNodeIds?.length > 0) issues.push(`Viewport controls overlap nodes: ${evidence.controlsOverlapNodeIds.join(", ")}.`);
    if (evidence?.firstNodeLeftOverflow) issues.push("The script node crosses the left canvas boundary.");
    if (!Number.isFinite(evidence?.topBlankRatio) || evidence.topBlankRatio > 0.34) {
      issues.push(`Canvas top blank ratio is too large: ${evidence?.topBlankRatio ?? "none"}.`);
    }
  }
  if (!(evidence?.canvasCenter?.x >= 0 && evidence?.canvasCenter?.y >= 0)) issues.push("Canvas center could not be measured.");
  return issues;
}

function stableCanvasLayoutSignature(evidence) {
  const round = (value) => Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
  return JSON.stringify({
    viewportTransform: evidence?.viewportTransform ?? "",
    nodeRects: evidence?.nodeRects?.map(({ id, rect }) => ({
      id,
      left: round(rect?.left),
      top: round(rect?.top),
      right: round(rect?.right),
      bottom: round(rect?.bottom),
    })) ?? [],
    controlsRect: evidence?.controlsRect ? {
      left: round(evidence.controlsRect.left),
      top: round(evidence.controlsRect.top),
      right: round(evidence.controlsRect.right),
      bottom: round(evidence.controlsRect.bottom),
    } : null,
  });
}

async function waitForStableCanvasEvidence(cdp) {
  const deadline = Date.now() + INITIAL_LAYOUT_TIMEOUT_MS;
  let lastEvidence = null;
  let previousPassingSignature = null;

  while (Date.now() < deadline) {
    lastEvidence = await evaluate(
      cdp,
      captureEvidenceExpression("initial"),
      "wait for stable canvas layout",
    );
    const issues = evidenceIssues(lastEvidence, "initial");
    const signature = issues.length === 0 ? stableCanvasLayoutSignature(lastEvidence) : null;
    if (signature && signature === previousPassingSignature) {
      return { evidence: lastEvidence, settled: true, issues: [] };
    }
    previousPassingSignature = signature;
    await sleep(INITIAL_LAYOUT_POLL_INTERVAL_MS);
  }

  return {
    evidence: lastEvidence,
    settled: false,
    issues: evidenceIssues(lastEvidence, "initial"),
  };
}

async function measureRound(cdp, direction, round, expectedProcessId) {
  await activateProbeApp(cdp, expectedProcessId);
  const preRoundEvidence = await evaluate(
    cdp,
    captureEvidenceExpression(direction),
    `capture ${direction} round ${round} input warmup evidence`,
  );
  await warmInputDispatch(cdp, preRoundEvidence);
  const started = await evaluate(cdp, startRoundExpression(), `start ${direction} round ${round}`);
  let dispatchedEventCount = 0;
  if (!started?.center || !Number.isFinite(started.center.x) || !Number.isFinite(started.center.y)) {
    throw new Error(`Unable to determine canvas center for ${direction} round ${round}.`);
  }
  if (direction === "fit") {
    await dispatchViewportControlPointer(cdp, "适配画布");
    dispatchedEventCount = 1;
  } else {
    const deltaY = direction === "zoom-in" ? -WHEEL_DELTA_Y : WHEEL_DELTA_Y;
    for (let eventIndex = 0; eventIndex < WHEEL_EVENT_COUNT; eventIndex += 1) {
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: started.center.x,
        y: started.center.y,
        deltaX: 0,
        deltaY,
        pointerType: "mouse",
      });
      dispatchedEventCount += 1;
      if (eventIndex + 1 < WHEEL_EVENT_COUNT) await sleep(WHEEL_EVENT_INTERVAL_MS);
      const currentZoom = await evaluate(
        cdp,
        `(() => {
          const canvas = document.querySelector('.workflow-node-canvas');
          const viewport = canvas?.querySelector('.react-flow__viewport');
          const transform = viewport ? getComputedStyle(viewport).transform : '';
          const match = String(transform).match(/matrix(?:3d)?\\(([^)]+)\\)/);
          if (!match) return null;
          const zoom = Number(match[1].split(',')[0]?.trim());
          return Number.isFinite(zoom) ? zoom : null;
        })()`,
        `read ${direction} zoom after wheel ${dispatchedEventCount}`,
      );
      if (isAtZoomBound(direction, currentZoom)) break;
    }
  }
  const settlement = await waitForRoundSettlement(cdp, direction, round);
  const snapshot = await evaluate(cdp, stopRoundExpression(), `stop ${direction} round ${round}`);
  const interactionGeometry = await evaluate(
    cdp,
    captureEvidenceExpression(direction),
    `capture ${direction} round ${round} interaction geometry`,
  );
  const interactionVisualEvidence = await captureCanvasVisualMetrics(cdp, interactionGeometry);
  await activateProbeApp(cdp, expectedProcessId);
  const settledGeometry = await evaluate(
    cdp,
    captureEvidenceExpression(direction),
    `capture ${direction} round ${round} settled geometry`,
  );
  const settledVisualEvidence = await captureCanvasVisualMetrics(cdp, settledGeometry);
  return summarizeRound(
    direction,
    round,
    snapshot,
    interactionGeometry,
    interactionVisualEvidence,
    settledGeometry,
    settledVisualEvidence,
    dispatchedEventCount,
    settlement,
  );
}

async function warmInputDispatch(cdp, evidence) {
  const center = evidence?.canvasCenter;
  if (!(Number.isFinite(center?.x) && Number.isFinite(center?.y))) {
    throw new Error("Canvas center is unavailable for CDP input warmup.");
  }
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: center.x,
    y: center.y,
    button: "none",
    buttons: 0,
    pointerType: "mouse",
  });
  await sleep(300);
}

async function measurePanStability(cdp) {
  const start = await evaluate(cdp, `(() => {
    const canvas = document.querySelector('.workflow-node-canvas');
    const pane = canvas?.querySelector('.react-flow__pane');
    const viewport = canvas?.querySelector('.react-flow__viewport');
    if (!canvas || !pane || !viewport) throw new Error('Production canvas pane is missing.');
    const rect = canvas.getBoundingClientRect();
    const points = [
      [0.82, 0.82], [0.72, 0.72], [0.88, 0.62], [0.62, 0.86],
    ];
    const point = points
      .map(([xRatio, yRatio]) => ({ x: rect.left + rect.width * xRatio, y: rect.top + rect.height * yRatio }))
      .find(({ x, y }) => document.elementFromPoint(x, y) === pane);
    if (!point) throw new Error('No empty production canvas point was available for pan regression.');
    return { point, transform: getComputedStyle(viewport).transform };
  })()`, "locate canvas pan point");

  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: start.point.x,
    y: start.point.y,
    button: "none",
    buttons: 0,
    pointerType: "mouse",
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: start.point.x,
    y: start.point.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
    pointerType: "mouse",
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: start.point.x + 84,
    y: start.point.y + 48,
    button: "left",
    buttons: 1,
    pointerType: "mouse",
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: start.point.x + 84,
    y: start.point.y + 48,
    button: "left",
    buttons: 0,
    clickCount: 1,
    pointerType: "mouse",
  });
  await sleep(180);
  const afterPan = await evaluate(cdp, captureEvidenceExpression("pan"), "capture viewport after pan");
  await sleep(700);
  const afterSettle = await evaluate(cdp, captureEvidenceExpression("pan"), "capture viewport after pan settle");
  const controlsStable = Boolean(
    afterPan.controlsRect &&
    afterSettle.controlsRect &&
    Math.abs(afterPan.controlsRect.left - afterSettle.controlsRect.left) <= 1 &&
    Math.abs(afterPan.controlsRect.top - afterSettle.controlsRect.top) <= 1
  );
  const transformChanged = start.transform !== afterPan.viewportTransform;
  const transformStable = afterPan.viewportTransform === afterSettle.viewportTransform;
  return {
    startTransform: start.transform,
    afterPanTransform: afterPan.viewportTransform,
    afterSettleTransform: afterSettle.viewportTransform,
    transformChanged,
    transformStable,
    controlsStable,
    interactingClassCleared: !afterSettle.canvasInteracting,
    passed: transformChanged && transformStable && controlsStable && !afterSettle.canvasInteracting,
  };
}

async function measureWindowReturnStability(cdp, expectedProcessId) {
  const before = await evaluate(cdp, captureEvidenceExpression("window-return"), "capture before window return");
  const beforeVisualEvidence = await captureCanvasVisualMetrics(cdp, before);
  const beforeHasFocus = await evaluate(cdp, "document.hasFocus()", "capture focus before window return");
  const beforeFrontmostApplication = sampleFrontmostApplication("before workflow window return");
  await new Promise((resolveOpen, rejectOpen) => {
    execFile("/usr/bin/open", ["-R", APP_BIN], { timeout: 5_000, encoding: "utf8" }, (error) => {
      if (error) rejectOpen(error);
      else resolveOpen();
    });
  });
  await new Promise((resolveOpen, rejectOpen) => {
    execFile("/usr/bin/open", ["-a", "Finder"], { timeout: 5_000, encoding: "utf8" }, (error) => {
      if (error) rejectOpen(error);
      else resolveOpen();
    });
  });
  await sleep(650);
  const awayHasFocus = await evaluate(cdp, "document.hasFocus()", "capture focus while app is away");
  const awayFrontmostApplication = sampleFrontmostApplication("while workflow app is away");
  await activateProbeApp(cdp, expectedProcessId);
  const after = await evaluate(cdp, captureEvidenceExpression("window-return"), "capture after window return");
  const afterVisualEvidence = await captureCanvasVisualMetrics(cdp, after);
  const afterHasFocus = await evaluate(cdp, "document.hasFocus()", "capture focus after window return");
  const afterFrontmostApplication = sampleFrontmostApplication("after workflow window return");
  const geometryFailureReasons = evidenceIssues(after, "window-return");
  const transformStable = before.viewportTransform === after.viewportTransform;
  const controlsStable = Boolean(
    before.controlsRect &&
    after.controlsRect &&
    Math.abs(before.controlsRect.left - after.controlsRect.left) <= 1 &&
    Math.abs(before.controlsRect.top - after.controlsRect.top) <= 1
  );
  const frontmostTransitionObserved =
    beforeFrontmostApplication.processId === expectedProcessId &&
    awayFrontmostApplication.processId !== expectedProcessId &&
    afterFrontmostApplication.processId === expectedProcessId;
  return {
    beforeHasFocus,
    awayHasFocus,
    afterHasFocus,
    beforeFrontmostApplication,
    awayFrontmostApplication,
    afterFrontmostApplication,
    focusTransitionObserved: frontmostTransitionObserved,
    frontmostTransitionObserved,
    beforeTransform: before.viewportTransform,
    afterTransform: after.viewportTransform,
    beforeVisualEvidence,
    afterVisualEvidence,
    transformStable,
    controlsStable,
    geometryFailureReasons,
    passed: frontmostTransitionObserved &&
      beforeVisualEvidence.passed === true &&
      afterVisualEvidence.passed === true &&
      transformStable && controlsStable && geometryFailureReasons.length === 0,
  };
}

const VIEWPORT_CONTROL_LABELS = Object.freeze(["缩小画布", "放大画布", "适配画布"]);

async function captureViewportControlState(cdp, label) {
  return evaluate(cdp, `(() => {
    const labels = ${JSON.stringify(VIEWPORT_CONTROL_LABELS)};
    const canvas = document.querySelector('.workflow-node-canvas');
    const controls = canvas?.querySelector('.workflow-node-viewport-controls');
    const viewport = canvas?.querySelector('.react-flow__viewport');
    const toRect = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    const publicZoomLabel = Array.from(controls?.querySelectorAll('span') || [])
      .map((element) => (element.textContent || '').trim())
      .find((text) => /^\\d+%$/.test(text)) || '';
    const publicZoomMatch = publicZoomLabel.match(/^(\\d+)%$/);
    const buttons = labels.map((ariaLabel) => {
      const button = controls?.querySelector('button[aria-label="' + ariaLabel + '"]');
      const physicalButtonRect = toRect(button);
      const pointer = physicalButtonRect ? {
        x: physicalButtonRect.left + physicalButtonRect.width / 2,
        y: physicalButtonRect.top + physicalButtonRect.height / 2,
      } : null;
      const directHitTarget = pointer ? document.elementFromPoint(pointer.x, pointer.y) : null;
      const hitTarget = directHitTarget?.closest?.('button[aria-label]') || null;
      const hitTargetAriaLabel = hitTarget?.getAttribute('aria-label') || null;
      return {
        ariaLabel,
        exactAriaLabel: button?.getAttribute('aria-label') || null,
        physicalButtonRect,
        pointer,
        hitTarget: directHitTarget ? {
          tagName: directHitTarget.tagName,
          directAriaLabel: directHitTarget.getAttribute?.('aria-label') || null,
          ariaLabel: hitTargetAriaLabel,
        } : null,
        hitTargetAriaLabel,
        hitTargetMatchesButton: Boolean(button && hitTarget === button),
      };
    });
    const canvasRect = toRect(canvas);
    return {
      requestedLabel: ${JSON.stringify(label)},
      publicZoomLabel,
      publicZoomPercent: publicZoomMatch ? Number(publicZoomMatch[1]) : null,
      viewportTransform: viewport ? getComputedStyle(viewport).transform : '',
      canvasRect,
      canvasCenter: canvasRect ? {
        x: canvasRect.left + canvasRect.width / 2,
        y: canvasRect.top + canvasRect.height / 2,
      } : null,
      controlsRect: toRect(controls),
      buttons,
    };
  })()`, label);
}

async function dispatchViewportControlPointer(cdp, ariaLabel) {
  const state = await captureViewportControlState(cdp, `inspect ${ariaLabel} pointer target`);
  const target = state?.buttons?.find((button) => button.ariaLabel === ariaLabel);
  if (!target?.pointer || !target.physicalButtonRect) {
    throw new Error(`${ariaLabel} button has no physical hit target.`);
  }
  const hitTargetAriaLabel = target.hitTargetAriaLabel;
  const hitTargetMatchesRequestedLabel = hitTargetAriaLabel === ariaLabel;
  if (!target.hitTargetMatchesButton || !hitTargetMatchesRequestedLabel) {
    throw new Error(`${ariaLabel} pointer resolved to ${hitTargetAriaLabel ?? "no aria-label"}.`);
  }
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: target.pointer.x,
    y: target.pointer.y,
    button: "none",
    buttons: 0,
    pointerType: "mouse",
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: target.pointer.x,
    y: target.pointer.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
    pointerType: "mouse",
  });
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: target.pointer.x,
    y: target.pointer.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
    pointerType: "mouse",
  });
  return { state, target };
}

function physicalRectsStable(reference, current, tolerance = 1) {
  return Boolean(
    reference && current &&
    Math.abs(reference.left - current.left) <= tolerance &&
    Math.abs(reference.top - current.top) <= tolerance &&
    Math.abs(reference.width - current.width) <= tolerance &&
    Math.abs(reference.height - current.height) <= tolerance
  );
}

function viewportControlLayoutStable(reference, current) {
  if (!physicalRectsStable(reference?.controlsRect, current?.controlsRect)) return false;
  return VIEWPORT_CONTROL_LABELS.every((ariaLabel) => {
    const referenceButton = reference?.buttons?.find((button) => button.ariaLabel === ariaLabel);
    const currentButton = current?.buttons?.find((button) => button.ariaLabel === ariaLabel);
    return physicalRectsStable(
      referenceButton?.physicalButtonRect,
      currentButton?.physicalButtonRect,
    );
  });
}

function viewportControlsInsideCanvas(state) {
  const canvasRect = state?.canvasRect;
  const rects = [state?.controlsRect, ...(state?.buttons || []).map((button) => button.physicalButtonRect)];
  return Boolean(canvasRect && rects.every((rect) => (
    rect &&
    rect.left >= canvasRect.left - 1 &&
    rect.top >= canvasRect.top - 1 &&
    rect.right <= canvasRect.right + 1 &&
    rect.bottom <= canvasRect.bottom + 1
  )));
}

async function positionViewportAtExactPublicZoom(cdp, targetPercent) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const state = await captureViewportControlState(cdp, `read viewport anchor for ${targetPercent}%`);
    if (!Number.isFinite(state?.publicZoomPercent) ||
        !Number.isFinite(state?.canvasCenter?.x) ||
        !Number.isFinite(state?.canvasCenter?.y)) {
      throw new Error("Viewport public zoom label or canvas center is unavailable.");
    }
    if (state.publicZoomPercent === targetPercent && state.publicZoomLabel === `${targetPercent}%`) {
      return state;
    }
    const distance = Math.abs(state.publicZoomPercent - targetPercent);
    const deltaMagnitude = distance > 25 ? 100 : distance > 8 ? 25 : distance > 2 ? 8 : 1;
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: state.canvasCenter.x,
      y: state.canvasCenter.y,
      deltaX: 0,
      deltaY: state.publicZoomPercent < targetPercent ? -deltaMagnitude : deltaMagnitude,
      pointerType: "mouse",
    });
    await sleep(80);
  }
  throw new Error(`Unable to position the public viewport label at exactly ${targetPercent}%.`);
}

async function measureViewportControlsAtZooms(cdp) {
  const anchors = [25, 100, 200];
  const actionLabels = [VIEWPORT_CONTROL_LABELS[1], VIEWPORT_CONTROL_LABELS[0], VIEWPORT_CONTROL_LABELS[2]];
  const results = [];
  let referenceLayout = null;
  for (const targetPercent of anchors) {
    const positioned = await positionViewportAtExactPublicZoom(cdp, targetPercent);
    const anchorState = await captureViewportControlState(cdp, `capture controls at ${targetPercent}%`);
    const requestedPublicZoomLabel = `${targetPercent}%`;
    const publicZoomLabel = anchorState.publicZoomLabel;
    const publicZoomLabelExact = publicZoomLabel === requestedPublicZoomLabel &&
      anchorState.publicZoomPercent === targetPercent;
    if (!publicZoomLabelExact) {
      throw new Error(
        `Expected public zoom label ${requestedPublicZoomLabel}, received ${publicZoomLabel || "none"}.`,
      );
    }
    referenceLayout ??= anchorState;
    const actions = [];
    const observedStates = [positioned, anchorState];
    for (const ariaLabel of actionLabels) {
      const dispatched = await dispatchViewportControlPointer(cdp, ariaLabel);
      await sleep(260);
      const afterState = await captureViewportControlState(cdp, `capture ${ariaLabel} result at ${targetPercent}%`);
      observedStates.push(dispatched.state, afterState);
      const beforeZoom = dispatched.state.publicZoomPercent;
      const afterZoom = afterState.publicZoomPercent;
      const clampedAtMaximum = ariaLabel === "放大画布" &&
        beforeZoom === 200 && afterZoom === 200;
      const actionApplied = ariaLabel === "放大画布"
        ? afterZoom > beforeZoom || clampedAtMaximum
        : ariaLabel === "缩小画布"
          ? afterZoom < beforeZoom
          : afterState.viewportTransform !== dispatched.state.viewportTransform;
      actions.push({
        requestedAriaLabel: ariaLabel,
        exactAriaLabel: dispatched.target.exactAriaLabel,
        hitTarget: dispatched.target.hitTarget,
        hitTargetMatchesButton: dispatched.target.hitTargetMatchesButton,
        pointer: dispatched.target.pointer,
        physicalButtonRect: dispatched.target.physicalButtonRect,
        afterPhysicalButtonRect: afterState.buttons.find((button) => button.ariaLabel === ariaLabel)?.physicalButtonRect ?? null,
        beforePublicZoomLabel: dispatched.state.publicZoomLabel,
        afterPublicZoomLabel: afterState.publicZoomLabel,
        beforeZoom,
        afterZoom,
        beforeViewportTransform: dispatched.state.viewportTransform,
        afterViewportTransform: afterState.viewportTransform,
        viewportTransformChanged: dispatched.state.viewportTransform !== afterState.viewportTransform,
        clampedAtMaximum,
        actionApplied,
      });
    }
    const physicalLayoutStable = observedStates.every((state) =>
      viewportControlLayoutStable(anchorState, state) && viewportControlLayoutStable(referenceLayout, state));
    const controlsWithinCanvas = observedStates.every(viewportControlsInsideCanvas);
    const hitTargets = anchorState.buttons.map((button) => ({
      ariaLabel: button.ariaLabel,
      hitTarget: button.hitTarget,
      physicalButtonRect: button.physicalButtonRect,
      pointer: button.pointer,
      hitTargetMatchesButton: button.hitTargetMatchesButton,
    }));
    const actionsPassed = actions.every((action) =>
      action.exactAriaLabel === action.requestedAriaLabel &&
      action.hitTargetMatchesButton &&
      action.actionApplied);
    results.push({
      targetPercent,
      requestedPublicZoomLabel,
      positionedPublicZoomLabel: positioned.publicZoomLabel,
      publicZoomLabel,
      publicZoomPercent: anchorState.publicZoomPercent,
      publicZoomLabelExact,
      controlsRect: anchorState.controlsRect,
      hitTargets,
      actions,
      physicalLayoutStable,
      controlsWithinCanvas,
      passed: publicZoomLabelExact && actionsPassed && physicalLayoutStable && controlsWithinCanvas,
    });
  }
  return {
    labels: VIEWPORT_CONTROL_LABELS,
    anchors: results,
    passed: results.length === anchors.length && results.every((result) => result.passed),
  };
}

async function measureWindowResizeStability(cdp) {
  const originalWindowSize = await evaluate(cdp, `(() => ({
    width: window.outerWidth,
    height: window.outerHeight,
  }))()`, "capture window size before resize");
  if (!(originalWindowSize?.width > 0 && originalWindowSize?.height > 0)) {
    throw new Error("Browser window did not return usable outer dimensions.");
  }
  const before = await evaluate(cdp, captureEvidenceExpression("resize"), "capture before window resize");
  const resizedWindowSize = {
    width: originalWindowSize.width + 120,
    height: originalWindowSize.height + 60,
  };
  let duringResize;
  let duringResizeVisual;
  try {
    await evaluate(cdp, `(() => {
      window.resizeTo(${resizedWindowSize.width}, ${resizedWindowSize.height});
      return { width: window.outerWidth, height: window.outerHeight };
    })()`, "resize browser window");
    await sleep(650);
    duringResize = await evaluate(cdp, captureEvidenceExpression("resize"), "capture during window resize");
    duringResizeVisual = await captureCanvasVisualMetrics(cdp, duringResize);
  } finally {
    await evaluate(cdp, `(() => {
      window.resizeTo(${originalWindowSize.width}, ${originalWindowSize.height});
      return { width: window.outerWidth, height: window.outerHeight };
    })()`, "restore browser window size");
  }
  await sleep(700);
  const after = await evaluate(cdp, captureEvidenceExpression("resize"), "capture after window resize");
  const afterWindowSize = await evaluate(cdp, `(() => ({
    width: window.outerWidth,
    height: window.outerHeight,
  }))()`, "capture restored window size");
  const duringResizeFailureReasons = evidenceIssues(duringResize, "resize");
  const geometryFailureReasons = evidenceIssues(after, "resize");
  const controlsStable = Boolean(
    before.controlsRect && after.controlsRect &&
    Math.abs(before.controlsRect.left - after.controlsRect.left) <= 1 &&
    Math.abs(before.controlsRect.top - after.controlsRect.top) <= 1
  );
  const canvasSizeChanged = Boolean(
    before.canvasSize && duringResize?.canvasSize &&
    (Math.abs(before.canvasSize.width - duringResize.canvasSize.width) >= 100 ||
      Math.abs(before.canvasSize.height - duringResize.canvasSize.height) >= 40)
  );
  const windowSizeRestored = Boolean(
    afterWindowSize &&
    Math.abs(afterWindowSize.width - originalWindowSize.width) <= 2 &&
    Math.abs(afterWindowSize.height - originalWindowSize.height) <= 2
  );
  return {
    originalWindowSize,
    resizedWindowSize,
    afterWindowSize,
    beforeCanvasSize: before.canvasSize,
    duringResizeCanvasSize: duringResize?.canvasSize ?? null,
    afterCanvasSize: after.canvasSize,
    canvasSizeChanged,
    windowSizeRestored,
    duringResizeFailureReasons,
    duringResizeVisual,
    controlsStable,
    geometryFailureReasons,
    passed: canvasSizeChanged && windowSizeRestored && controlsStable &&
      duringResizeFailureReasons.length === 0 &&
      duringResizeVisual?.passed === true &&
      geometryFailureReasons.length === 0 &&
      after.nodeCount === 6,
  };
}

function aggregateRounds(rounds) {
  const frameIntervalsMs = rounds.flatMap((round) => round.frameIntervalsMs);
  const maxFrameIntervalMs = frameIntervalsMs.length > 0 ? Math.max(...frameIntervalsMs) : null;
  const p95FrameIntervalMs = percentile(frameIntervalsMs, 0.95);
  return {
    frameIntervalCount: frameIntervalsMs.length,
    maxFrameIntervalMs,
    p95FrameIntervalMs,
    frameIntervalsOver33Ms: frameIntervalsMs.filter((interval) => interval > THRESHOLDS.p95FrameIntervalMs).length,
    frameIntervalsOver100Ms: frameIntervalsMs.filter((interval) => interval > THRESHOLDS.maxFrameIntervalMs).length,
    viewportTransformMutationCount: rounds.reduce((total, round) => total + round.viewportTransformMutationCount, 0),
  };
}

let child;
let cdp;
let navigation = null;
let initialEvidence = null;
let initialVisualEvidence = null;
let evidenceFailureReasons = [];
const rounds = [];
let panStability = null;
let windowReturnStability = null;
let viewportControlsStability = null;
let windowResizeStability = null;
let failure = null;

try {
  verifyRuntimeInputs();
  child = spawn(
    APP_BIN,
    [`--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${USER_DATA_DIR}`],
    {
      cwd: process.cwd(),
      detached: true,
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: "1",
      },
      stdio: "ignore",
    },
  );
  const pageTarget = await waitForPageTarget();
  cdp = await createCdpClient(pageTarget);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  // CDP's Input domain does not expose an enable command; dispatchMouseEvent is ready after attachment.
  await activateProbeApp(cdp, child.pid);

  navigation = await evaluate(cdp, openStoryboardStageExpression(), "open 分镜视频生成 stage");
  const initialCanvasState = await waitForStableCanvasEvidence(cdp);
  initialEvidence = initialCanvasState.evidence;
  evidenceFailureReasons = evidenceIssues(initialEvidence, "initial");
  if (!initialCanvasState.settled) {
    evidenceFailureReasons.unshift(
      `Production canvas layout did not settle within ${INITIAL_LAYOUT_TIMEOUT_MS}ms.`,
    );
  }
  if (evidenceFailureReasons.length > 0) {
    throw new Error(`Required canvas evidence is missing: ${evidenceFailureReasons.join(" ")}`);
  }
  await activateProbeApp(cdp, child.pid);
  initialVisualEvidence = await captureCanvasVisualMetrics(cdp, initialEvidence);
  if (!initialVisualEvidence.passed) {
    throw new Error(`Initial canvas visual evidence failed: ${JSON.stringify(initialVisualEvidence)}`);
  }

  // Warm the first explicit fit calculation before timed rounds. The initial
  // layout is already validated above; this prevents cold font/layout/GPU work
  // from being misattributed to the first measured zoom interaction.
  await dispatchViewportControlPointer(cdp, "适配画布");
  await sleep(700);

  for (let cycle = 1; cycle <= 5; cycle += 1) {
    rounds.push(await measureRound(cdp, "zoom-out", cycle, child.pid));
    rounds.push(await measureRound(cdp, "zoom-in", cycle, child.pid));
    rounds.push(await measureRound(cdp, "fit", cycle, child.pid));
  }
  await activateProbeApp(cdp, child.pid);
  windowReturnStability = await measureWindowReturnStability(cdp, child.pid);
  if (!windowReturnStability.passed) {
    throw new Error(`Window return stability failed: ${JSON.stringify(windowReturnStability)}`);
  }
  panStability = await measurePanStability(cdp);
  if (!panStability.passed) {
    throw new Error(`Canvas pan stability failed: ${JSON.stringify(panStability)}`);
  }
  await activateProbeApp(cdp, child.pid);
  viewportControlsStability = await measureViewportControlsAtZooms(cdp);
  if (!viewportControlsStability.passed) {
    throw new Error(`Viewport controls stability failed: ${JSON.stringify(viewportControlsStability)}`);
  }
  windowResizeStability = await measureWindowResizeStability(cdp);
  if (!windowResizeStability.passed) {
    throw new Error(`Window resize stability failed: ${JSON.stringify(windowResizeStability)}`);
  }
} catch (error) {
  failure = errorMessage(error);
  console.error(`[workflow-zoom-probe] ${failure}`);
} finally {
  try {
    cdp?.close();
  } catch (error) {
    console.error(`[workflow-zoom-probe] CDP cleanup failed: ${errorMessage(error)}`);
  }
  if (child) {
    try {
      await terminateSpawnedApp(child, { logPrefix: "[workflow-zoom-probe]" });
    } catch (error) {
      const cleanupFailure = `App cleanup failed: ${errorMessage(error)}`;
      failure = failure ? `${failure} ${cleanupFailure}` : cleanupFailure;
      console.error(`[workflow-zoom-probe] ${cleanupFailure}`);
    }
  }

  const aggregate = aggregateRounds(rounds);
  const aggregateP95Passed =
    Number.isFinite(aggregate.p95FrameIntervalMs) &&
    aggregate.p95FrameIntervalMs <= THRESHOLDS.p95FrameIntervalMs;
  const allRoundsPassed = rounds.length === 15 && rounds.every((round) => round.passed);
  const passed =
    !failure &&
    evidenceFailureReasons.length === 0 &&
    allRoundsPassed &&
    aggregateP95Passed &&
    windowReturnStability?.passed === true &&
    panStability?.passed === true &&
    viewportControlsStability?.passed === true &&
    windowResizeStability?.passed === true;
  const report = {
    generatedAt: new Date().toISOString(),
    app: {
      binary: APP_BIN || "",
      processName: APP_PROCESS_NAME,
      pid: child?.pid ?? null,
      candidates: APP_BIN_CANDIDATES,
    },
    userData: {
      directory: USER_DATA_DIR || null,
      source: USER_DATA_INPUT.source,
      inputReportPath: USER_DATA_INPUT.inputReportPath,
      cloneProvided: Boolean(USER_DATA_DIR),
    },
    debugPort: DEBUG_PORT,
    reportPath: REPORT_PATH,
    cloneEvidence: initialEvidence
      ? {
          source: "real-user-data-clone",
          bodyHasProjectName: initialEvidence.bodyHasProjectName,
          storyboardStageVisible: initialEvidence.storyboardStageVisible,
          expectedStoryboardEntryCount: 43,
          actualStoryboardEntryCount: initialEvidence.storyboardEntryCount,
        }
      : null,
    navigation,
    initialEvidence,
    initialVisualEvidence,
    evidenceFailureReasons,
    rounds,
    windowReturnStability,
    panStability,
    viewportControlsStability,
    windowResizeStability,
    aggregate,
    aggregateP95Passed,
    thresholds: THRESHOLDS,
    visualPixelThresholds: VISUAL_PIXEL_THRESHOLDS,
    zoomBounds: ZOOM_BOUNDS,
    passed,
    error: failure,
  };
  try {
    writeReport(report);
  } catch (error) {
    console.error(`[workflow-zoom-probe] Failed to write report: ${errorMessage(error)}`);
    failure = failure || `Failed to write report: ${errorMessage(error)}`;
  }
  if (failure || !passed) process.exitCode = 1;
}
