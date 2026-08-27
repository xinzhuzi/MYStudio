#!/usr/bin/env node
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const WebSocket = require("../../node_modules/ws");

const DEFAULT_DURATION_MS = 10 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;
const REQUIRED_ACTIONS = [
  "stageSwitches",
  "workflowSwitches",
  "workflowCreates",
  "generatedNodeCreates",
  "zoomActions",
  "dragActions",
];

function parseArgs(argv) {
  const options = {
    host: "127.0.0.1",
    port: 9222,
    durationMs: DEFAULT_DURATION_MS,
    intervalMs: DEFAULT_INTERVAL_MS,
    commandTimeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
    expectedProjectId: "49dce4c1-64b1-42de-85c2-9f266698aec4",
    expectedProjectName: "道劫",
    expectedChapterId: "chapter-001",
    outputPath: path.resolve(
      process.cwd(),
      "output",
      "automation",
      "heap-profiler",
      "interaction-evidence.json",
    ),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if ([
      "--host",
      "--port",
      "--duration-ms",
      "--interval-ms",
      "--command-timeout-ms",
      "--expected-project-id",
      "--expected-project-name",
      "--expected-chapter-id",
      "--output",
    ].includes(argument)) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} requires a value`);
      index += 1;
      if (argument === "--host") options.host = value;
      if (argument === "--port") options.port = Number(value);
      if (argument === "--duration-ms") options.durationMs = Number(value);
      if (argument === "--interval-ms") options.intervalMs = Number(value);
      if (argument === "--command-timeout-ms") options.commandTimeoutMs = Number(value);
      if (argument === "--expected-project-id") options.expectedProjectId = value;
      if (argument === "--expected-project-name") options.expectedProjectName = value;
      if (argument === "--expected-chapter-id") options.expectedChapterId = value;
      if (argument === "--output") options.outputPath = path.resolve(value);
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error(`invalid port: ${options.port}`);
  }
  if (!Number.isFinite(options.durationMs) || options.durationMs < 1000) {
    throw new Error("--duration-ms must be at least 1000");
  }
  if (!Number.isFinite(options.intervalMs) || options.intervalMs < 250) {
    throw new Error("--interval-ms must be at least 250");
  }
  if (!Number.isFinite(options.commandTimeoutMs) || options.commandTimeoutMs < 1000) {
    throw new Error("--command-timeout-ms must be at least 1000");
  }
  for (const key of ["expectedProjectId", "expectedProjectName", "expectedChapterId"]) {
    if (!options[key]?.trim()) throw new Error(`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} requires a value`);
  }
  return options;
}

function usage() {
  return [
    "Usage: node apps/build/scripts/heap-profiler-interactions.cjs [options]",
    "  --port <port>          CDP port (default: 9222)",
    "  --duration-ms <ms>     interaction duration (default: 600000)",
    "  --interval-ms <ms>     interval between rounds (default: 5000)",
    "  --expected-project-id <id> --expected-project-name <name>",
    "  --expected-chapter-id <id> exact cloned project identity",
    "  --output <path>        durable JSON evidence path",
  ].join("\n");
}

function getJson(host, port, requestPath, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settleReject = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const request = http.get({ host, port, path: requestPath }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        if (settled) return;
        if (response.statusCode !== 200) {
          settleReject(new Error(`CDP endpoint returned HTTP ${response.statusCode}`));
          return;
        }
        try {
          settled = true;
          resolve(JSON.parse(body));
        } catch {
          settleReject(new Error("CDP endpoint returned invalid JSON"));
        }
      });
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy();
      settleReject(new Error(`CDP endpoint timed out after ${timeoutMs}ms`));
    });
    request.on("error", (error) => settleReject(new Error(`CDP endpoint unavailable: ${error.message}`)));
  });
}

function connectCdp(webSocketDebuggerUrl, commandTimeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl, {
      maxPayload: 1024 * 1024 * 1024,
      handshakeTimeout: commandTimeoutMs,
    });
    const pending = new Map();
    let sequence = 0;
    let opened = false;
    const rejectPending = (error) => {
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(error);
      }
      pending.clear();
    };
    const send = (method, params = {}) => new Promise((resolveSend, rejectSend) => {
      if (socket.readyState !== WebSocket.OPEN) {
        rejectSend(new Error(`CDP websocket is not open for ${method}`));
        return;
      }
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectSend(new Error(`CDP command timed out: ${method}`));
      }, commandTimeoutMs);
      pending.set(id, { resolve: resolveSend, reject: rejectSend, timer });
      try {
        socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        rejectSend(new Error(`CDP websocket send failed for ${method}: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
    socket.on("message", (data) => {
      let message;
      try { message = JSON.parse(data.toString()); } catch { return; }
      if (!message.id || !pending.has(message.id)) return;
      const request = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message || "CDP command failed"));
      else request.resolve(message.result);
    });
    socket.once("open", () => {
      opened = true;
      resolve({ socket, send });
    });
    socket.on("error", (error) => {
      const wrapped = new Error(`CDP websocket unavailable: ${error.message}`);
      rejectPending(wrapped);
      if (!opened) reject(wrapped);
    });
    socket.on("close", () => rejectPending(new Error("CDP websocket closed")));
  });
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isTargetNavigationError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /Inspected target navigated or closed|CDP websocket (?:closed|unavailable|is not open)|CDP endpoint (?:unavailable|timed out)/i.test(message);
}

async function connectToCurrentPage(options) {
  const targets = await getJson(options.host, options.port, "/json/list", options.commandTimeoutMs);
  const page = Array.isArray(targets)
    ? targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl)
    : null;
  if (!page) throw new Error(`no CDP page found at ${options.host}:${options.port}`);
  const client = await connectCdp(page.webSocketDebuggerUrl, options.commandTimeoutMs);
  return { ...client, page };
}

async function reconnectToCurrentPage(options) {
  const deadline = Date.now() + Math.min(options.commandTimeoutMs, 5_000);
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await connectToCurrentPage(options);
    } catch (error) {
      lastError = error;
      await sleep(100);
    }
  }
  throw lastError || new Error(`no CDP page found at ${options.host}:${options.port}`);
}

function evaluateValue(response, label) {
  if (response?.exceptionDetails) {
    throw new Error(`${label}: ${response.exceptionDetails.exception?.description || response.exceptionDetails.text}`);
  }
  return response?.result?.value;
}

function writeJsonAtomically(outputPath, value) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, outputPath);
}

function buildIdentityExpression(options) {
  const projectId = JSON.stringify(options.expectedProjectId);
  const projectName = JSON.stringify(options.expectedProjectName);
  const chapterId = JSON.stringify(options.expectedChapterId);
  return `(async () => {
    const expectedProjectId = ${projectId};
    const expectedProjectName = ${projectName};
    const expectedChapterId = ${chapterId};
    const readJson = async (key) => {
      const raw = await window.fileStorage?.getItem?.(key);
      return raw ? JSON.parse(raw) : null;
    };
    const projectStore = await readJson('mystudio-project-store');
    const project = (projectStore?.state?.projects || [])
      .find((item) => item.id === expectedProjectId);
    const shardRoot = '_p/' + expectedProjectId + '/studio-workflow';
    const manifest = await readJson(shardRoot + '/manifest');
    const merged = {};
    for (const shardName of manifest?.shards || []) {
      const shard = await readJson(shardRoot + '/' + String(shardName).replace(/\\.json$/, ''));
      for (const [key, value] of Object.entries(shard?.state || {})) {
        merged[key] = Array.isArray(merged[key]) && Array.isArray(value)
          ? [...merged[key], ...value]
          : value;
      }
    }
    if (!manifest) {
      const legacy = await readJson('_p/' + expectedProjectId + '/studio-workflow-store');
      Object.assign(merged, legacy?.state || {});
    }
    const chapter = (merged.novelChapters || []).find((item) => item.id === expectedChapterId);
    const imageWorkflows = merged.imageWorkflows || [];
    let forbiddenPersistentMediaCount = 0;
    for (const graph of imageWorkflows) {
      for (const node of graph.nodes || []) {
        for (const field of ['imageUrl', 'resultUrl']) {
          const value = node?.[field];
          if (typeof value === 'string' && (/^data:/i.test(value) || /^blob:/i.test(value))) {
            forbiddenPersistentMediaCount += 1;
          }
        }
      }
    }
    return {
      ok: Boolean(
        project?.id === expectedProjectId &&
        project?.name === expectedProjectName &&
        chapter?.id === expectedChapterId
      ),
      projectId: project?.id || '',
      projectName: project?.name || '',
      chapterId: chapter?.id || '',
      chapterTitle: chapter?.title || '',
      manifestShardCount: Array.isArray(manifest?.shards) ? manifest.shards.length : 0,
      imageWorkflowCount: imageWorkflows.length,
      forbiddenPersistentMediaCount,
    };
  })()`;
}

function buildInteractionExpression(round, expectedProjectId = "49dce4c1-64b1-42de-85c2-9f266698aec4") {
  const expectedProjectIdLiteral = JSON.stringify(expectedProjectId);
  return `(async () => {
    const expectedProjectId = ${expectedProjectIdLiteral};
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitFor = async (predicate, timeoutMs = 1_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const value = predicate();
        if (value) return value;
        await sleep(100);
      }
      return null;
    };
    const normalize = (element) => (element?.textContent || '').replace(/\\s+/g, ' ').trim();
    const isVisible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return style.visibility !== 'hidden' && style.display !== 'none' &&
        rect.width > 0 && rect.height > 0;
    };
    const click = (element) => {
      if (!element) return false;
      element.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = element.getBoundingClientRect();
      const init = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        button: 0,
      };
      element.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerId: 1, pointerType: 'mouse', buttons: 1 }));
      element.dispatchEvent(new MouseEvent('mousedown', { ...init, buttons: 1 }));
      element.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerId: 1, pointerType: 'mouse', buttons: 0 }));
      element.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
      element.dispatchEvent(new MouseEvent('click', { ...init, buttons: 0 }));
      return true;
    };
    const candidates = () => [...document.querySelectorAll('button, [role="menuitem"], [cmdk-item]')];
    const clickText = (text, exact = false) => {
      const element = candidates().find((item) => exact ? normalize(item) === text : normalize(item).includes(text));
      return { clicked: click(element), text: normalize(element) };
    };
    const clickStage = async (stageId, label) => {
      const switcherElement = await waitFor(() => candidates().find((item) => normalize(item) === '切换阶段'));
      if (!click(switcherElement)) return false;
      await sleep(150);
      const option = await waitFor(() =>
        (stageId === 'imageWorkflow'
          ? document.querySelector('[data-workflow-view-entry="imageWorkflow"]')
          : candidates().find((item) => normalize(item).includes(label))) ||
        candidates().find((item) => normalize(item).includes(label)),
      3000);
      if (!click(option)) return false;
      return Boolean(await waitFor(() =>
        document.querySelector('[data-workflow-active-stage="' + stageId + '"]'),
      3000));
    };
    const counters = {
      projectEntries: 0,
      routeEntries: 0,
      stageSwitches: 0,
      workflowSwitches: 0,
      workflowCreates: 0,
      generatedNodeCreates: 0,
      zoomActions: 0,
      dragActions: 0,
      resizeActions: 0,
    };

    const projectCard = document.querySelector('[data-project-card="' + expectedProjectId + '"]');
    if (isVisible(projectCard) && click(projectCard)) {
      counters.projectEntries += 1;
      await sleep(1000);
    }
    await waitFor(() => document.querySelector('[data-workflow-active-stage]') &&
      candidates().find((item) => normalize(item) === '切换阶段'));
    const stage = 'imageWorkflow';
    // Retry the route transition on an unready page. Each attempt is bounded so
    // a CDP interaction round cannot consume its own command timeout.
    if (!document.querySelector('[data-workflow-active-stage="' + stage + '"]')) {
      const workflowRoute = [...document.querySelectorAll('.studio-nav-button')]
        .find((button) => normalize(button) === '工作流');
      if (workflowRoute && click(workflowRoute)) {
        counters.routeEntries += 1;
        await waitFor(() => candidates().find((item) => normalize(item) === '切换阶段'));
      }
      if (await clickStage('imageWorkflow', '图像节点图')) {
        counters.stageSwitches += 1;
      }
    }

    // A scoped asset/storyboard drill-down intentionally hides the global
    // workflow selector. Exit that detail before the readiness gate; checking
    // for the selector first makes every scoped start fail once and adds an
    // avoidable stage remount on the next attempt.
    if (!document.querySelector('select[data-image-workflow-selector]')) {
      const scopedBackButton = candidates().find((button) =>
        normalize(button) === '返回' && isVisible(button));
      if (click(scopedBackButton)) {
        await waitFor(() => !candidates().some((button) =>
          normalize(button) === '返回' && isVisible(button)), 3_000);
        if (!document.querySelector('[data-workflow-active-stage="' + stage + '"]') &&
          await clickStage('imageWorkflow', '图像节点图')) {
          counters.stageSwitches += 1;
        }
        await waitFor(() => document.querySelector('select[data-image-workflow-selector]'), 3_000);
      }
    }

    // Exercise the real stage switch path on every round. Starting from the
    // image-workflow stage is not enough to prove switching: explicitly leave
    // it for storyboard and come back, then verify both commits before reading
    // canvas state. This also prevents a stale initial route from producing a
    // false-positive interaction run with stageSwitches=0.
    const storyboardStageCommitted = await clickStage('storyboard', '分镜视频生成');
    const imageWorkflowStageCommitted = await clickStage('imageWorkflow', '图像节点图');
    if (storyboardStageCommitted) counters.stageSwitches += 1;
    if (imageWorkflowStageCommitted) counters.stageSwitches += 1;
    const stageSwitchCycleComplete = Boolean(
      storyboardStageCommitted && imageWorkflowStageCommitted,
    );

    // React Flow measures custom nodes asynchronously after stage/workflow changes.
    // Do not sample coordinates while nodes are still hidden by its measurement guard.
    const collectCanvasReadiness = () => {
      const visibleNode = [...document.querySelectorAll('.react-flow__node')].find((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return style.visibility !== 'hidden' && style.display !== 'none' &&
          style.pointerEvents !== 'none' && rect.width > 0 && rect.height > 0 &&
          rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight &&
          rect.left < window.innerWidth;
      });
      const controlsElement = document.querySelector('.workflow-node-viewport-controls');
      const imageNode = document.querySelector('[data-image-workflow-node-kind]');
      const workflowSelector = document.querySelector('select[data-image-workflow-selector]');
      return {
        documentVisibilityState: document.visibilityState,
        documentHasFocus: document.hasFocus(),
        hasVisibleNode: Boolean(visibleNode),
        hasViewportControls: Boolean(controlsElement),
        hasImageWorkflowNode: Boolean(imageNode),
        hasWorkflowSelector: Boolean(workflowSelector),
        activeWorkflowId: workflowSelector?.getAttribute('data-image-workflow-active-id') || '',
        workflowOptionCount: workflowSelector?.options.length || 0,
      };
    };
    const waitForVisibleCanvas = async () => {
      let diagnostics = collectCanvasReadiness();
      const ready = await waitFor(() => {
        diagnostics = collectCanvasReadiness();
        return diagnostics.documentVisibilityState === 'visible' &&
          diagnostics.documentHasFocus && diagnostics.hasVisibleNode && diagnostics.hasViewportControls &&
          diagnostics.hasImageWorkflowNode && diagnostics.hasWorkflowSelector &&
          diagnostics.workflowOptionCount > 1
          ? diagnostics
          : null;
      }, 2_000);
      return { ready: Boolean(ready), diagnostics };
    };
    const canvasBeforeSwitch = await waitForVisibleCanvas();

    const globalCreateButton = [...document.querySelectorAll('[data-image-workflow-global-action]')]
      .find((button) => normalize(button) === '新建');

    if (${round} % 12 === 0) {
      const workflowSelectorBefore = document.querySelector('select[data-image-workflow-selector]');
      const workflowCountBefore = workflowSelectorBefore?.options.length || 0;
      const workflowIdBefore = workflowSelectorBefore?.getAttribute('data-image-workflow-active-id') || '';
      const nodeCountBeforeCreate = document.querySelectorAll('[data-image-workflow-node-kind]').length;
      if (globalCreateButton && click(globalCreateButton)) {
        await waitFor(() => {
          const selector = document.querySelector('select[data-image-workflow-selector]');
          const activeId = selector?.getAttribute('data-image-workflow-active-id') || '';
          return selector && activeId && activeId !== workflowIdBefore ? selector : null;
        }, 1_000);
        const workflowSelectorAfter = document.querySelector('select[data-image-workflow-selector]');
        const workflowCountAfter = workflowSelectorAfter?.options.length || 0;
        const workflowIdAfter = workflowSelectorAfter?.getAttribute('data-image-workflow-active-id') || '';
        const nodeCountAfterCreate = document.querySelectorAll('[data-image-workflow-node-kind]').length;
        if (workflowIdAfter && workflowIdAfter !== workflowIdBefore &&
          (workflowCountAfter >= workflowCountBefore || nodeCountAfterCreate !== nodeCountBeforeCreate)) {
          counters.workflowCreates += 1;
        }
      }
      const nodeCountBefore = document.querySelectorAll('[data-image-workflow-node-kind]').length;
      if (clickText('生成节点', true).clicked) {
        await sleep(250);
        if (document.querySelectorAll('[data-image-workflow-node-kind]').length > nodeCountBefore) {
          counters.generatedNodeCreates += 1;
        }
      }
    }

    const workflowSelector = await waitFor(() => {
      const selector = document.querySelector('select[data-image-workflow-selector]');
      return selector && selector.options.length > 1 ? selector : null;
    }, 1_000);
    const workflowIdBeforeSwitch = workflowSelector?.getAttribute('data-image-workflow-active-id') || '';
    const workflowOptions = workflowSelector
      ? [...workflowSelector.options].map((option) => option.value).filter(Boolean)
      : [];
    const workflowTargetId = workflowOptions.find((value) => value !== workflowIdBeforeSwitch);
    if (workflowSelector && workflowTargetId) {
      workflowSelector.value = workflowTargetId;
      workflowSelector.dispatchEvent(new Event('change', { bubbles: true }));
      const committedSelector = await waitFor(() => {
        const selector = document.querySelector('select[data-image-workflow-selector]');
        return selector?.value === workflowTargetId &&
          selector.getAttribute('data-image-workflow-active-id') === workflowTargetId
          ? selector
          : null;
      }, 1_000);
      if (committedSelector) counters.workflowSwitches += 1;
    }

    // Switching the native selector remounts React Flow and can briefly hide nodes again.
    const canvasAfterSwitch = await waitForVisibleCanvas();

    const viewport = document.querySelector('.react-flow__viewport');
    const viewportControls = document.querySelector('.workflow-node-viewport-controls');
    const viewportState = () => {
      const percentLabel = viewportControls
        ? [...viewportControls.querySelectorAll('span')]
          .find((element) => normalize(element).endsWith('%'))
        : null;
      const percent = Number(normalize(percentLabel).replace('%', ''));
      return viewport && Number.isFinite(percent)
        ? { percent, transform: getComputedStyle(viewport).transform }
        : null;
    };
    const rectProjection = (element) => {
      const rect = element?.getBoundingClientRect();
      return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
    };
    const zoomTargets = {
      beforeState: viewportState(),
      zoomIn: rectProjection(viewportControls?.querySelector('button[aria-label="放大画布"]')),
      zoomOut: rectProjection(viewportControls?.querySelector('button[aria-label="缩小画布"]')),
    };

    const draggable = [...document.querySelectorAll('.react-flow__node')].find((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return style.visibility !== 'hidden' && style.display !== 'none' &&
        style.pointerEvents !== 'none' && rect.width > 0 && rect.height > 0 &&
        rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight &&
        rect.left < window.innerWidth;
    });
    const beforeNodeRects = [...document.querySelectorAll('.react-flow__node')].map((node) => {
      const rect = node.getBoundingClientRect();
      return { id: node.getAttribute('data-id') || '', x: rect.x, y: rect.y };
    });
    const dragRect = draggable?.getBoundingClientRect();
    const dragStart = dragRect
      ? Array.from({ length: 7 }, (_, row) => row + 1)
        .flatMap((row) => Array.from({ length: 7 }, (_, column) => ({
          x: dragRect.left + (dragRect.width * column) / 8,
          y: dragRect.top + (dragRect.height * row) / 8,
        })))
        .find((point) => {
          const hit = document.elementFromPoint(point.x, point.y);
          return hit && draggable.contains(hit) &&
            !hit.closest('button, input, textarea, select, a, .nodrag');
        })
      : null;
    window.dispatchEvent(new Event('resize'));
    counters.resizeActions += 1;
    await sleep(100);

    return {
      counters,
      ready: Boolean(
        stageSwitchCycleComplete && canvasBeforeSwitch.ready && canvasAfterSwitch.ready,
      ),
      documentVisibilityState: document.visibilityState,
      documentHasFocus: document.hasFocus(),
      stageSwitchCycleComplete,
      readiness: {
        beforeSwitch: canvasBeforeSwitch.diagnostics,
        afterSwitch: canvasAfterSwitch.diagnostics,
      },
      stage,
      title: document.title,
      hasWorkflowRoute: Boolean([...document.querySelectorAll('.studio-nav-button')]
        .find((button) => normalize(button) === '工作流')),
      imageWorkflowNodeCount: document.querySelectorAll('[data-image-workflow-node-kind]').length,
      reactFlowCount: document.querySelectorAll('.react-flow').length,
      zoomTargets,
      dragTarget: dragRect && dragStart ? {
        nodeId: draggable.getAttribute('data-id') || '',
        beforeNodeRects,
        x: dragRect.x,
        y: dragRect.y,
        startX: dragStart.x,
        startY: dragStart.y,
      } : null,
    };
  })()`;
}

function buildDragVerificationExpression(nodeId = '', beforeNodeRects = []) {
  const nodeIdLiteral = JSON.stringify(nodeId);
  const beforeRectsLiteral = JSON.stringify(beforeNodeRects);
  return `(() => {
    const nodeId = ${nodeIdLiteral};
    const beforeRects = ${beforeRectsLiteral};
    const nodes = [...document.querySelectorAll('.react-flow__node')];
    const element = nodes
      .find((item) => nodeId && item.getAttribute('data-id') === nodeId) ||
      nodes.find((item) => {
        const rect = item.getBoundingClientRect();
        return beforeRects.length > 0 && beforeRects.every((before) =>
          Math.abs(rect.x - before.x) + Math.abs(rect.y - before.y) >= 1);
      });
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y };
  })()`;
}

function buildViewportStateExpression() {
  return `(() => {
    const viewport = document.querySelector('.react-flow__viewport');
    const controls = document.querySelector('.workflow-node-viewport-controls');
    const label = controls
      ? [...controls.querySelectorAll('span')]
        .find((element) => (element.textContent || '').trim().endsWith('%'))
      : null;
    const percent = Number((label?.textContent || '').trim().replace('%', ''));
    return viewport && Number.isFinite(percent)
      ? { percent, transform: getComputedStyle(viewport).transform }
      : null;
  })()`;
}

async function waitForViewportChange(send, before, direction) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const current = evaluateValue(await send("Runtime.evaluate", {
      expression: buildViewportStateExpression(),
      returnByValue: true,
    }), `zoom-${direction} verification`);
    const percentChanged = direction === "in"
      ? current?.percent > before.percent
      : current?.percent < before.percent;
    if (percentChanged && current.transform !== before.transform) return current;
    await sleep(50);
  }
  return null;
}

async function dispatchCdpClick(send, target) {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: target.x, y: target.y });
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: target.x,
    y: target.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: target.x,
    y: target.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
}

async function runInteractions(options) {
  let { socket, send, page } = await connectToCurrentPage(options);
  const startedAt = Date.now();
  const deadline = startedAt + options.durationMs;
  const samples = [];
  const totals = {};
  let identity = null;
  let attempt = 0;
  let round = 0;
  let unreadyAttempts = 0;
  let lastReadiness = null;
  let targetReconnects = 0;
  const verifyIdentity = async () => {
    await send("Runtime.enable");
    const verified = evaluateValue(await send("Runtime.evaluate", {
      expression: buildIdentityExpression(options),
      awaitPromise: true,
      returnByValue: true,
    }), "real-project identity probe");
    if (!verified?.ok) {
      throw new Error(`real-project clone identity mismatch: ${JSON.stringify(verified || {})}`);
    }
    if (verified.forbiddenPersistentMediaCount !== 0) {
      throw new Error(`real-project clone contains ${verified.forbiddenPersistentMediaCount} forbidden persistent media values`);
    }
    identity = verified;
  };
  const reconnectAfterTargetLoss = async () => {
    try { socket.close(); } catch {}
    ({ socket, send, page } = await reconnectToCurrentPage(options));
    targetReconnects += 1;
    await verifyIdentity();
    console.log(`[heap-interaction] reconnected after target navigation count=${targetReconnects}`);
  };
  const sendRecoverable = async (method, params = {}) => {
    let retried = false;
    while (true) {
      try {
        return await send(method, params);
      } catch (error) {
        if (retried || !isTargetNavigationError(error) || Date.now() >= deadline) throw error;
        retried = true;
        await reconnectAfterTargetLoss();
      }
    }
  };
  const evaluateRecoverable = async (expression, label) => {
    const response = await sendRecoverable("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    return evaluateValue(response, label);
  };
  try {
    await verifyIdentity();
    while (Date.now() < deadline) {
      const roundStartedAt = Date.now();
      let value;
      try {
        value = await evaluateRecoverable(
          buildInteractionExpression(attempt, options.expectedProjectId),
          "interaction round",
        );
      } catch (error) {
        if (!isTargetNavigationError(error) || Date.now() >= deadline) throw error;
        attempt += 1;
        continue;
      }
      attempt += 1;
      if (!value) {
        throw new Error(`interaction page is not the real project workflow: ${JSON.stringify(value || {})}`);
      }
      lastReadiness = value.readiness || lastReadiness;
      if (!value.ready) {
        unreadyAttempts += 1;
        for (const [name, count] of Object.entries(value.counters || {})) {
          totals[name] = (totals[name] || 0) + Number(count || 0);
        }
        if (unreadyAttempts === 1 || unreadyAttempts % 3 === 0) {
          console.log(`[heap-interaction] unready attempt=${attempt} readiness=${JSON.stringify(lastReadiness || {})}`);
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await sleep(Math.min(remaining, options.intervalMs));
        continue;
      }
      if (!value.hasWorkflowRoute || value.reactFlowCount < 1 || value.imageWorkflowNodeCount < 1) {
        throw new Error(`interaction page is not the real project workflow: ${JSON.stringify(value)}`);
      }
      const zoomTargets = value.zoomTargets;
      if (zoomTargets?.beforeState && zoomTargets?.zoomIn && zoomTargets?.zoomOut) {
        await dispatchCdpClick(sendRecoverable, zoomTargets.zoomIn);
        const zoomed = await waitForViewportChange(sendRecoverable, zoomTargets.beforeState, "in");
        if (zoomed) value.counters.zoomActions += 1;
        await dispatchCdpClick(sendRecoverable, zoomTargets.zoomOut);
        const restored = zoomed ? await waitForViewportChange(sendRecoverable, zoomed, "out") : null;
        if (restored) value.counters.zoomActions += 1;
      }
      if (value.dragTarget) {
        const { startX, startY, nodeId, beforeNodeRects, x: beforeX, y: beforeY } = value.dragTarget;
        await sendRecoverable("Input.dispatchMouseEvent", { type: "mouseMoved", x: startX, y: startY });
        await sendRecoverable("Input.dispatchMouseEvent", { type: "mousePressed", x: startX, y: startY, button: "left", buttons: 1, clickCount: 1 });
        for (let step = 1; step <= 4; step += 1) {
          await sendRecoverable("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x: startX + step * 12,
            y: startY + step * 8,
            button: "left",
            buttons: 1,
          });
          await sleep(40);
        }
        await sendRecoverable("Input.dispatchMouseEvent", { type: "mouseReleased", x: startX + 48, y: startY + 32, button: "left", buttons: 0, clickCount: 1 });
        let afterDrag = null;
        const dragVerificationDeadline = Date.now() + 3000;
        while (Date.now() < dragVerificationDeadline) {
          afterDrag = evaluateValue(await sendRecoverable("Runtime.evaluate", {
            expression: buildDragVerificationExpression(nodeId, beforeNodeRects),
            returnByValue: true,
          }), "drag verification");
          if (afterDrag) break;
          await sleep(100);
        }
        if (afterDrag && (Math.abs(afterDrag.x - beforeX) >= 1 || Math.abs(afterDrag.y - beforeY) >= 1)) {
          value.counters.dragActions += 1;
        }
      }
      const heapUsage = await sendRecoverable("Runtime.getHeapUsage");
      const usedJSHeapSize = Number(heapUsage?.usedSize) || 0;
      const totalJSHeapSize = Number(heapUsage?.totalSize) || 0;
      if (!(usedJSHeapSize > 0) || !(totalJSHeapSize >= usedJSHeapSize)) {
        throw new Error("Runtime.getHeapUsage returned an invalid heap sample");
      }
      for (const [name, count] of Object.entries(value.counters || {})) {
        totals[name] = (totals[name] || 0) + Number(count || 0);
      }
      samples.push({
        atMs: Date.now() - startedAt,
        usedJSHeapSize,
        totalJSHeapSize,
        imageWorkflowNodeCount: value.imageWorkflowNodeCount,
        reactFlowCount: value.reactFlowCount,
        stage: value.stage,
        documentVisibilityState: value.documentVisibilityState,
        documentHasFocus: value.documentHasFocus,
      });
      round += 1;
      if (round === 1 || round % 6 === 0) {
        console.log(`[heap-interaction] elapsed=${Math.round((Date.now() - startedAt) / 1000)}s heap=${Math.round(usedJSHeapSize / 1024 / 1024)}MB rounds=${round} actions=${JSON.stringify(value.counters)}`);
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await sleep(Math.min(remaining, Math.max(0, options.intervalMs - (Date.now() - roundStartedAt))));
    }
  } catch (error) {
    const failedAt = Date.now();
    writeJsonAtomically(options.outputPath, {
      schemaVersion: 1,
      status: "failed",
      source: identity?.ok ? "real-project-clone" : "unverified",
      paidGenerationInvoked: false,
      startedAt,
      finishedAt: failedAt,
      durationMs: failedAt - startedAt,
      requestedDurationMs: options.durationMs,
      identity,
      attempts: attempt,
      unreadyAttempts,
      targetReconnects,
      lastReadiness,
      rounds: round,
      totals,
      samples,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    socket.close();
  }

  const finishedAt = Date.now();
  const usedHeapSamples = samples.map((sample) => sample.usedJSHeapSize).filter((value) => value > 0);
  const heap = {
    firstBytes: usedHeapSamples[0] || 0,
    lastBytes: usedHeapSamples.at(-1) || 0,
    minBytes: usedHeapSamples.length ? Math.min(...usedHeapSamples) : 0,
    maxBytes: usedHeapSamples.length ? Math.max(...usedHeapSamples) : 0,
    netGrowthBytes: usedHeapSamples.length > 1 ? usedHeapSamples.at(-1) - usedHeapSamples[0] : 0,
  };
  const missingActions = REQUIRED_ACTIONS.filter((name) => !(totals[name] > 0));
  const foregroundViolation = samples.some((sample) =>
    Boolean(sample.documentVisibilityState) &&
    (sample.documentVisibilityState !== "visible" || sample.documentHasFocus !== true));
  try {
    if (finishedAt - startedAt < options.durationMs) {
      throw new Error(`interaction duration was too short: ${finishedAt - startedAt}ms`);
    }
    if (usedHeapSamples.length !== samples.length || usedHeapSamples.length < 1) {
      throw new Error("interaction run has invalid or missing CDP heap samples");
    }
    if (missingActions.length > 0) {
      throw new Error(`interaction run missed required actions: ${missingActions.join(", ")}; totals=${JSON.stringify(totals)}`);
    }
    if (foregroundViolation) {
      throw new Error("interaction run lost foreground visibility or document focus");
    }
    if (heap.maxBytes >= 300 * 1024 * 1024 || heap.netGrowthBytes >= 100 * 1024 * 1024) {
      throw new Error(`interaction heap stability gate failed: max=${heap.maxBytes} netGrowth=${heap.netGrowthBytes}`);
    }
  } catch (error) {
    writeJsonAtomically(options.outputPath, {
      schemaVersion: 1,
      status: "failed",
      source: "real-project-clone",
      paidGenerationInvoked: false,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      requestedDurationMs: options.durationMs,
      identity,
      attempts: attempt,
      unreadyAttempts,
      targetReconnects,
      lastReadiness,
      rounds: round,
      totals,
      missingActions,
      foregroundViolation,
      heap,
      samples,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  const evidence = {
    schemaVersion: 1,
    status: "passed",
    source: "real-project-clone",
    paidGenerationInvoked: false,
    startedAt,
    finishedAt,
    durationMs: finishedAt - startedAt,
    requestedDurationMs: options.durationMs,
    intervalMs: options.intervalMs,
    pageUrl: page.url,
    pageTitle: page.title,
    identity,
    attempts: attempt,
    unreadyAttempts,
    targetReconnects,
    lastReadiness,
    rounds: round,
    totals,
    missingActions,
    foregroundViolation,
    heap,
    samples,
  };
  writeJsonAtomically(options.outputPath, evidence);
  return { ...evidence, samples: undefined, outputPath: options.outputPath };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const evidence = await runInteractions(options);
  console.log(JSON.stringify(evidence));
}

module.exports = {
  buildDragVerificationExpression,
  buildIdentityExpression,
  buildInteractionExpression,
  buildViewportStateExpression,
  parseArgs,
  runInteractions,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`[heap-interaction] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
