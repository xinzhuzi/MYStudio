import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PNG } from "pngjs";

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
const debugPort = Number(process.env.MYSTUDIO_SMOKE_DEBUG_PORT || 9342);
const userDataDir =
  process.env.MYSTUDIO_SMOKE_USER_DATA_DIR ||
  mkdtempSync(resolve(tmpdir(), "mystudio-smoke-"));
const CDP_CALL_TIMEOUT_MS = Number(
  process.env.MYSTUDIO_SMOKE_CDP_TIMEOUT_MS || 10_000,
);
const ASSET_VOICE_FLOW_TIMEOUT_MS = Number(
  process.env.MYSTUDIO_SMOKE_ASSET_VOICE_TIMEOUT_MS || 35_000,
);
const AUDIO_METADATA_TIMEOUT_MS = Number(
  process.env.MYSTUDIO_SMOKE_AUDIO_METADATA_TIMEOUT_MS || 10_000,
);
const CORE_ROUTE_CHECKS = [
  {
    label: "工作流",
    requiredText: [
      "当前工作区：漫影工作流",
      "待推进：",
    ],
    forbiddenText: ["制作流程推进", "导演造景", "导演规划与造景", "造景后继续"],
  },
  {
    label: "资产",
    requiredText: ["个人资产库", "默认风格"],
  },
  {
    label: "TTS",
    requiredText: ["TTS 口播", "本地 TTS"],
    waitMs: 2_500,
  },
  {
    label: "设置",
    requiredText: ["系统设置", "外观", "Python 配置"],
  },
];
const SMOKE_VIDEO_PATH = "/tmp/mystudio-smoke-final.mp4";

if (!existsSync(appBin)) {
  console.error(
    `Packaged app was not found. Checked:\n${appBinCandidates.join("\n")}`,
  );
  process.exit(1);
}

function prepareSmokeMedia() {
  rmSync(SMOKE_VIDEO_PATH, { force: true });
  const result = spawnSync(
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
      SMOKE_VIDEO_PATH,
    ],
    { stdio: "ignore" },
  );
  if (result.status !== 0 || !existsSync(SMOKE_VIDEO_PATH)) {
    console.warn(
      "[smoke] failed to create smoke mp4 fixture; video preview check may fall back to DOM state",
    );
  }
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
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const targets = await readJson(`http://127.0.0.1:${debugPort}/json/list`);
      const page = Array.isArray(targets)
        ? targets.find((target) => target.type === "page")
        : null;
      if (page?.webSocketDebuggerUrl) {
        return page;
      }
    } catch {
      // The debugging server opens after Electron has started.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("No Electron page target appeared on the debugging port.");
}

function connectWebSocket(url) {
  return new Promise((resolveSocket, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => resolveSocket(socket));
    socket.addEventListener("error", reject);
  });
}

function withTimeout(promise, label, timeoutMs = CDP_CALL_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function summarizePageError(error) {
  if (error?.method === "Runtime.consoleAPICalled") {
    const args = error.params?.args || [];
    return {
      method: error.method,
      type: error.params?.type,
      text: args
        .map(
          (arg) =>
            arg.value || arg.description || arg.unserializableValue || "",
        )
        .filter(Boolean)
        .join(" "),
    };
  }
  if (error?.method === "Runtime.exceptionThrown") {
    return {
      method: error.method,
      text: error.params?.exceptionDetails?.text || "",
      exception: error.params?.exceptionDetails?.exception?.description || "",
    };
  }
  if (error?.method === "Log.entryAdded") {
    return {
      method: error.method,
      level: error.params?.entry?.level,
      text: error.params?.entry?.text || "",
      source: error.params?.entry?.source || "",
      url: error.params?.entry?.url || "",
    };
  }
  if (error?.method === "Network.loadingFailed") {
    return {
      method: error.method,
      text: error.params?.errorText || "",
      url: error.params?.url || "",
      type: error.params?.type || "",
    };
  }
  return error;
}

async function inspectPage(pageTarget) {
  const socket = await connectWebSocket(pageTarget.webSocketDebuggerUrl);
  let messageId = 0;
  const pending = new Map();
  const errors = [];
  const networkRequests = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const callback = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        callback.reject(new Error(JSON.stringify(message.error)));
      } else {
        callback.resolve(message.result);
      }
      return;
    }

    if (message.method === "Runtime.exceptionThrown") {
      errors.push(message);
      return;
    }
    if (
      message.method === "Runtime.consoleAPICalled" &&
      message.params?.type === "error"
    ) {
      errors.push(message);
      return;
    }
    if (
      message.method === "Log.entryAdded" &&
      message.params?.entry?.level === "error"
    ) {
      errors.push(message);
      return;
    }
    if (message.method === "Network.requestWillBeSent") {
      networkRequests.set(
        message.params?.requestId,
        message.params?.request?.url || "",
      );
      return;
    }
    if (message.method === "Network.loadingFailed") {
      const text = message.params?.errorText || "";
      if (text.includes("ERR_FILE_NOT_FOUND")) {
        errors.push({
          method: "Network.loadingFailed",
          params: {
            ...message.params,
            url: networkRequests.get(message.params?.requestId) || "",
          },
        });
      }
    }
  });

  const send = (method, params = {}, timeoutMs = CDP_CALL_TIMEOUT_MS) => {
    const request = new Promise((resolveResult, reject) => {
      const id = ++messageId;
      pending.set(id, { resolve: resolveResult, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    return withTimeout(request, method, timeoutMs).catch((error) => {
      for (const [id, callback] of pending.entries()) {
        callback.reject(
          new Error(
            `Cancelled pending CDP request ${id} after ${method} failed`,
          ),
        );
        pending.delete(id);
      }
      throw error;
    });
  };

  try {
    await send("Runtime.enable");
    await send("Log.enable");
    await send("Network.enable");
    await send("Page.enable");
    await send("Page.bringToFront");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 4_000));

    const evaluate = async (
      expression,
      label = "Runtime.evaluate",
      timeoutMs = CDP_CALL_TIMEOUT_MS,
    ) => {
      const evaluated = await withTimeout(
        send(
          "Runtime.evaluate",
          {
            awaitPromise: true,
            returnByValue: true,
            expression,
          },
          timeoutMs,
        ),
        label,
        timeoutMs,
      );
      return evaluated.result.value;
    };

    console.log("[smoke] checking dashboard/project entry");
    const state = await evaluate(
      `(() => {
    const root = document.getElementById('root');
    const bodyBg = getComputedStyle(document.body).backgroundColor;
    const dashboardCard = document.querySelector('.dashboard-project-card');
    dashboardCard?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return new Promise((resolve) => setTimeout(() => resolve({
      href: location.href,
      title: document.title,
      readyState: document.readyState,
      bodyBg,
      bodyText: document.body.innerText,
      bodyTextLength: document.body.innerText.trim().length,
      rootChildren: root ? root.children.length : -1,
      hasDashboardCard: Boolean(dashboardCard),
      hasProjectOverview: document.body.innerText.includes('项目概览'),
      hasWorkspaceContent:
        document.body.innerText.includes('当前工作区') ||
        document.body.innerText.includes('剧情产物生成') ||
        document.body.innerText.includes('风格与导演选择'),
      hasWhiteBody: bodyBg === 'rgb(255, 255, 255)' || bodyBg === 'white',
    }), 1500));
  })()`,
      "initial project entry check",
    );

    console.log("[smoke] checking overview workflow steps");
    const overviewWorkflow = await verifyOverviewWorkflow(evaluate);

    const routeChecks = [];
    for (const route of CORE_ROUTE_CHECKS) {
      console.log(`[smoke] checking route: ${route.label}`);
      routeChecks.push(await verifyRoute(evaluate, route));
    }

    console.log("[smoke] checking workflow stages");
    const workflowStages = await verifyWorkflowStages(evaluate);

    console.log("[smoke] checking end-to-end workflow data");
    const workflowEndToEnd = await verifyWorkflowEndToEnd(evaluate);

    console.log("[smoke] checking asset voice flow");
    const assetVoiceFlow = await verifyAssetVoiceFlow(evaluate);

    console.log("[smoke] checking script asset generation voice flow");
    const scriptAssetGenerationVoiceFlow =
      await verifyScriptAssetGenerationVoiceFlow(evaluate);

    console.log("[smoke] checking Python settings");
    const pythonSettings = await verifyPythonSettings(evaluate);

    const domVisualStats = await captureDomVisualStats(evaluate);
    console.log("[smoke] capturing screenshot");
    const screenshot = await captureVisualStats(send, domVisualStats);
    return {
      state,
      errors,
      overviewWorkflow,
      routeChecks,
      workflowStages,
      workflowEndToEnd,
      assetVoiceFlow,
      scriptAssetGenerationVoiceFlow,
      pythonSettings,
      screenshot,
    };
  } finally {
    for (const [, callback] of pending.entries()) {
      callback.reject(new Error("CDP socket closed during smoke cleanup"));
    }
    pending.clear();
    socket.close();
  }
}

async function verifyRoute(evaluate, route) {
  const label = JSON.stringify(route.label);
  const requiredText = JSON.stringify(route.requiredText);
  const forbiddenText = JSON.stringify(route.forbiddenText || []);
  const waitMs = Number(route.waitMs || 1_500);
  return evaluate(
    `(() => {
    const routeLabel = ${label};
    const requiredText = ${requiredText};
    const forbiddenText = ${forbiddenText};
    const navButtons = Array.from(document.querySelectorAll('.studio-nav-button'))
      .filter((node) => node.tagName === 'BUTTON');
    const routeButton = navButtons.find((node) => {
      const text = (node.textContent || '').replace(/\\s+/g, ' ').trim();
      return text === routeLabel || text.includes(routeLabel);
    });

    if (!routeButton) {
      return {
        label: routeLabel,
        clicked: false,
        hasRequiredText: false,
        missingRequiredText: requiredText,
        forbiddenTextFound: [],
        activeNavText: '',
        availableNavText: navButtons.map((node) => (node.textContent || '').replace(/\\s+/g, ' ').trim()),
        bodyTextSample: document.body.innerText.slice(0, 800),
      };
    }

    routeButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return new Promise((resolve) => setTimeout(() => {
      const bodyText = document.body.innerText;
      const missingRequiredText = requiredText.filter((text) => !bodyText.includes(text));
      const forbiddenTextFound = forbiddenText.filter((text) => bodyText.includes(text));
      resolve({
        label: routeLabel,
        clicked: true,
        hasRequiredText: missingRequiredText.length === 0,
        missingRequiredText,
        forbiddenTextFound,
        activeNavText: document.querySelector('.studio-nav-button.is-active')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        bodyTextLength: bodyText.trim().length,
        bodyTextSample: bodyText.slice(0, 800),
      });
    }, ${waitMs}));
  })()`,
    `route check: ${route.label}`,
  );
}

async function verifyOverviewWorkflow(evaluate) {
  return evaluate(
    `(() => {
    const navButtons = Array.from(document.querySelectorAll('.studio-nav-button'))
      .filter((node) => node.tagName === 'BUTTON');
    const overviewButton = navButtons.find((node) => {
      const text = (node.textContent || '').replace(/\\s+/g, ' ').trim();
      return text === '概览' || text.includes('概览');
    });
    overviewButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return new Promise((resolve) => setTimeout(() => {
      const bodyText = document.body.innerText;
      resolve({
        clickedOverview: Boolean(overviewButton),
        hasProjectEntry: bodyText.includes('开始制作'),
        hasWorkflowEntry: bodyText.includes('进入工作流'),
        hasAssetEntry: bodyText.includes('查看资产库'),
        forbiddenTextFound: ['漫影工作室标准工作流', 'STAGE 01', '小说导入后按章节逐章制作', '单章输入、单章产物、单章成片']
          .filter((text) => bodyText.includes(text)),
        bodyTextSample: bodyText.slice(0, 1200),
      });
    }, 1000));
  })()`,
    "overview workflow check",
  );
}

async function verifyWorkflowStages(evaluate) {
  return evaluate(
    `(async () => {
    const normalize = (node) => (node.textContent || '').replace(/\\s+/g, ' ').trim();
    const activate = (node) => {
      if (!node) return false;
      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, pointerType: 'mouse' }));
      node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, view: window }));
      node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 0, pointerType: 'mouse' }));
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, view: window }));
      node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, view: window }));
      return true;
    };
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const navButtons = Array.from(document.querySelectorAll('.studio-nav-button')).filter((node) => node.tagName === 'BUTTON');
    const workflowButton = navButtons.find((node) => normalize(node).includes('工作流'));
    const clickedWorkflow = activate(workflowButton);
    await wait(800);
	    const hasTopNodeCanvas = Boolean(document.querySelector('.studio-workspace-workflow > .workflow-node-canvas'));

	    const stages = [
	      { id: 'manuals', label: '风格与导演', requiredText: ['视觉手册', '导演手册'] },
      { id: 'novel', label: '小说导入', requiredText: ['导入原文'] },
      { id: 'script', label: '剧本生产阶段', requiredText: ['请先在「小说导入」导入章节'] },
      { id: 'assets', label: '剧本资产管理', requiredText: ['还没有剧本：请先在「剧本生产阶段」生成各章剧本', '角色/场景/道具', '承接本阶段已提取的角色、场景、道具', '全部润色提示词', '生成图片', '落地衍生资产', '音频样本'], forbiddenText: ['运行导演计划', '锁定剧集圣经', '角色库', '全部润色角色提示词'] },
      {
        id: 'storyboard',
        label: '分镜视频生成',
        requiredText: ['自动排版'],
        forbiddenText: ['分镜表与分镜视频生成', '运行 AI 分镜计划', '添加分镜', '生成配音', '试听配音', '进入待处理阶段'],
      },
      { id: 'workbench', label: '视频工作台', requiredText: ['导出成片'] },
    ];

    const results = [];
    for (const stage of stages) {
      const clicked = await window.mystudioWorkflowSmoke?.setWorkflowStage?.(stage.id);
	      await wait(450);
	      const bodyText = document.body.innerText;
	      const missingRequiredText = stage.requiredText.filter((text) => !bodyText.includes(text));
	      const presentForbiddenText = (stage.forbiddenText || []).filter((text) => bodyText.includes(text));
	      const stageRoot = document.querySelector('[data-state="active"]');
	      const flowCanvas = stageRoot?.querySelector('.workflow-node-canvas');
	      const reactFlowCanvas = stageRoot?.querySelector('.react-flow');
	      const generationCanvas = document.querySelector('.production-agent-workspace .workflow-node-canvas');
	      const hasNodeCanvas = Boolean(flowCanvas && reactFlowCanvas);
	      const connectorCount = flowCanvas ? flowCanvas.querySelectorAll('.react-flow__edge').length : 0;
	      const productionNodes = flowCanvas
	        ? Array.from(flowCanvas.querySelectorAll('[data-flow-node-id]')).map((node) => node.getAttribute('data-flow-node-id'))
	        : [];
	      const productionEdges = flowCanvas
	        ? Array.from(flowCanvas.querySelectorAll('.react-flow__edge')).map((node) => node.getAttribute('data-id') || node.id)
	        : [];
	      results.push({
	        label: stage.label,
	        id: stage.id,
	        clicked: Boolean(clicked),
	        hasRequiredText: missingRequiredText.length === 0,
	        missingRequiredText,
	        hasForbiddenText: presentForbiddenText.length > 0,
	        presentForbiddenText,
	        hasNodeCanvas,
	        hasGenerationNodeCanvas: Boolean(generationCanvas),
	        connectorCount,
	        productionNodes,
	        productionEdges,
	        bodyTextSample: bodyText.slice(0, 800),
	      });
    }

    return {
      clickedWorkflow,
      hasTopNodeCanvas,
      stages: results,
    };
  })()`,
    "workflow stages check",
    12_000,
  );
}

async function verifyPythonSettings(evaluate) {
  return evaluate(
    `(() => {
    const normalize = (node) => (node.textContent || '').replace(/\\s+/g, ' ').trim();
    const activate = (node) => {
      if (!node) return false;
      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, pointerType: 'mouse' }));
      node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, view: window }));
      node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 0, pointerType: 'mouse' }));
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0, view: window }));
      node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, view: window }));
      return true;
    };
    const navButtons = Array.from(document.querySelectorAll('.studio-nav-button'))
      .filter((node) => node.tagName === 'BUTTON');
    const settingsButton = navButtons.find((node) => normalize(node).includes('设置'));
    activate(settingsButton);

    return new Promise((resolve) => setTimeout(() => {
      const tabButtons = Array.from(document.querySelectorAll('button'));
      const pythonTab = tabButtons.find((node) => normalize(node) === 'Python 配置' || normalize(node).includes('Python 配置'));
      activate(pythonTab);

      setTimeout(() => {
        const bodyText = document.body.innerText;
        const requiredText = [
          'Python 运行环境',
          '不随应用启动自动配置',
          '开始配置',
          '安装明细',
          'Python 使用路径',
        ];
        const forbiddenText = [
          '正在配置 Python 运行环境',
          '正在下载 Python 运行环境',
          '正在安装 TTS 依赖',
        ];
        resolve({
          clickedSettings: Boolean(settingsButton),
          clickedPythonTab: Boolean(pythonTab),
          pythonTabState: pythonTab?.getAttribute('data-state') || '',
          activeTabText: tabButtons.find((node) => node.getAttribute('data-state') === 'active')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
          hasRequiredText: requiredText.every((text) => bodyText.includes(text)),
          missingRequiredText: requiredText.filter((text) => !bodyText.includes(text)),
          forbiddenTextFound: forbiddenText.filter((text) => bodyText.includes(text)),
          bodyTextLength: bodyText.trim().length,
          bodyTextSample: bodyText.slice(0, 1000),
        });
      }, 1200);
    }, 800));
  })()`,
    "Python settings check",
  );
}

async function verifyWorkflowEndToEnd(evaluate) {
  return evaluate(
    `(async () => {
    const normalize = (node) => (node.textContent || '').replace(/\\s+/g, ' ').trim();
    const activate = (node) => {
      if (!node) return false;
      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, pointerType: 'mouse' }));
      node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, view: window }));
      node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 0, pointerType: 'mouse' }));
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, view: window }));
      node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, view: window }));
      return true;
    };
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitFor = async (predicate, timeout = 8000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await wait(150);
      }
      return null;
    };
    const clickButtonByText = (text) => {
      const button = Array.from(document.querySelectorAll('button'))
        .find((node) => normalize(node) === text || normalize(node).includes(text));
      return activate(button);
    };
    const seed = await waitFor(() => window.mystudioWorkflowSmoke?.seedCompleteWorkflow, 10_000);
    const seedResult = seed ? await seed() : null;
    await wait(500);
    const clickedWorkflow = clickButtonByText('工作流');
    await waitFor(() => document.body.innerText.includes('100%') || document.body.innerText.includes('已导出最终成片'), 8000);
    await window.mystudioWorkflowSmoke?.setWorkflowStage?.('storyboard');
    await wait(800);
    const nodeCardTexts = Array.from(document.querySelectorAll('[data-flow-node-id]'))
      .map((node) => ({ id: node.getAttribute('data-flow-node-id'), text: normalize(node) }));
    const requiredNodePreviewText = [
      ['独孤剑尘睁眼'],
      ['矿场入局'],
      ['独孤剑尘'],
      ['序号', '画面描述', '台词'],
      ['旁白：他在尘土里醒来。'],
      ['mystudio-smoke-final.mp4'],
    ];
    const missingNodePreviewText = requiredNodePreviewText
      .filter((texts) => !nodeCardTexts.some((node) => texts.every((text) => node.text.includes(text))))
      .map((texts) => texts.join(' / '));
    const bodyText = document.body.innerText;
    const inspectResult = await window.mystudioWorkflowSmoke?.inspectWorkflow?.();
    return {
      bridgeAvailable: Boolean(window.mystudioWorkflowSmoke?.seedCompleteWorkflow),
      clickedWorkflow,
      seedResult,
      inspectResult,
      hasReadyProgress: bodyText.includes('100%') || inspectResult?.progress === 100,
      hasCompletedExport: bodyText.includes('已导出最终成片') || bodyText.includes('本地成片输出:') || Boolean(inspectResult?.checks?.hasFinalExport),
      hasSelectedCandidate: bodyText.includes('已选候选片段') || Boolean(inspectResult?.checks?.hasSelectedCandidate),
      hasVoiceFlow: bodyText.includes('已分配角色音色') || Boolean(inspectResult?.checks?.hasVoiceBinding),
      hasVoiceAudio: bodyText.includes('分镜配音已生成') || Boolean(inspectResult?.checks?.hasVoiceAudio),
      hasNodeFlowDataPreview: missingNodePreviewText.length === 0,
      missingNodePreviewText,
      nodeCardTexts,
      bodyTextSample: bodyText.slice(0, 1200),
    };
  })()`,
    "workflow end-to-end check",
    20_000,
  );
}

async function verifyAssetVoiceFlow(evaluate) {
  const seed = await evaluate(
    `(async () => {
    const waitFor = async (predicate, timeout = 5000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      return null;
    };
    await waitFor(() => window.studioAssets?.add && window.studioAssets?.list && window.studioAssets?.saveMaterial);
    if (!window.studioAssets?.add || !window.studioAssets?.list || !window.studioAssets?.saveMaterial) {
      return { seeded: false, reason: 'studioAssets API unavailable' };
    }
    const existingRoles = await window.studioAssets.list({ type: 'role', search: 'Smoke测试剑修', limit: 1 });
    const role = existingRoles.items?.[0] || await window.studioAssets.add({
      type: 'role',
      name: 'Smoke测试剑修',
      description: '青年男声，冷静克制，适合断剑剑修。',
      setting: '- **性别**：男\\n- **年龄**：青年\\n- **身份**：剑修',
      prompt: '水墨漫剧角色，青年剑修，玄色长衣',
    });
    const existingAudio = await window.studioAssets.list({ type: 'audio', search: 'Smoke青年男声', limit: 1 });
    let audio = existingAudio.items?.[0];
    if (!audio) {
      const sampleRate = 8000;
      const seconds = 0.25;
      const samples = Math.floor(sampleRate * seconds);
      const dataBytes = samples * 2;
      const buffer = new ArrayBuffer(44 + dataBytes);
      const view = new DataView(buffer);
      const writeString = (offset, text) => {
        for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
      };
      writeString(0, 'RIFF');
      view.setUint32(4, 36 + dataBytes, true);
      writeString(8, 'WAVE');
      writeString(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeString(36, 'data');
      view.setUint32(40, dataBytes, true);
      for (let i = 0; i < samples; i += 1) {
        const sample = Math.sin((i / sampleRate) * Math.PI * 2 * 440) * 0.15;
        view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 32767, true);
      }
      const saved = await window.studioAssets.saveMaterial({ name: 'Smoke青年男声.wav', bytes: buffer });
      audio = await window.studioAssets.add({
        type: 'audio',
        name: 'Smoke青年男声.wav',
        sourceFilePath: saved.filePath,
        description: '我会走到最后。',
      });
    }
    const audioList = await waitFor(async () => {
      const result = await window.studioAssets.list({ type: 'audio', search: 'Smoke青年男声', limit: 10 });
      return result.items?.length ? result : null;
    }, 5000);
    return {
      seeded: Boolean(role && audio && audioList?.items?.length),
      roleName: role?.name || '',
      audioName: audio?.name || '',
      audioListCount: audioList?.items?.length || 0,
      audioListFirst: audioList?.items?.[0]?.name || '',
    };
  })()`,
    "asset voice seed",
  );

  const flow = await evaluate(
    `(async () => {
    const normalize = (node) => (node.textContent || '').replace(/\\s+/g, ' ').trim();
    const activate = (node) => {
      if (!node) return false;
      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, pointerType: 'mouse' }));
      node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, view: window }));
      node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 0, pointerType: 'mouse' }));
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0, view: window }));
      node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, view: window }));
      return true;
    };
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
     const waitFor = async (predicate, timeout = 5000) => {
       const deadline = Date.now() + timeout;
       while (Date.now() < deadline) {
         const value = await predicate();
         if (value) return value;
         await wait(150);
       }
      return null;
    };
    const clickButtonByText = (text, exact = false) => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const button = buttons.find((node) => {
        const normalized = normalize(node);
        return exact ? normalized === text : normalized.includes(text);
      });
      return { clicked: activate(button), text: button ? normalize(button) : '' };
    };
    const searchAssetLibrary = async (text) => {
      const input = Array.from(document.querySelectorAll('.studio-asset-library input'))
        .find((node) => node.getAttribute('placeholder') === '搜索名称');
      if (!input) return false;
      input.focus();
      const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(input, text);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(900);
      return true;
    };
    const searchVoiceAssignDialog = async (text) => {
      const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).at(-1);
      const input = dialog
        ? Array.from(dialog.querySelectorAll('input'))
          .find((node) => node.getAttribute('placeholder') === '搜索音频名称或文件名')
        : null;
      if (!input) return false;
      input.focus();
      const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(input, text);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(500);
      return true;
    };
    const closeTopDialog = async () => {
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
      const dialog = dialogs.at(-1);
      if (!dialog) return false;
      const beforeCount = dialogs.length;
      const closeButton = Array.from(dialog.querySelectorAll('button'))
        .find((node) => normalize(node) === 'Close' || node.querySelector('.sr-only')?.textContent?.trim() === 'Close');
      const clicked = activate(closeButton);
      if (!clicked) return false;
      await waitFor(() => document.querySelectorAll('[role="dialog"]').length < beforeCount, 3000);
      return document.querySelectorAll('[role="dialog"]').length < beforeCount;
    };

    const clickedAssets = clickButtonByText('资产');
    await waitFor(() => document.body.innerText.includes('个人资产库'));
    const clickedRole = clickButtonByText('角色', true);
    await waitFor(() => document.body.innerText.includes('角色库'));
    await searchAssetLibrary('Smoke测试剑修');
    await waitFor(() => document.body.innerText.includes('Smoke测试剑修'));

    const bodyAfterRole = document.body.innerText;
    const roleCards = Array.from(document.querySelectorAll('.studio-asset-library button[title]'))
      .filter((node) => {
        const title = node.getAttribute('title') || '';
        const text = normalize(node);
        return title.trim().length > 0 && !text.includes('自动分配音频') && !text.includes('多选') && !text.includes('添加');
      });
    const smokeRoleCard = roleCards.find((node) => (node.getAttribute('title') || '').includes('Smoke测试剑修') || normalize(node).includes('Smoke测试剑修'));
    const clickedRoleCard = activate(smokeRoleCard || roleCards[0]);
    await waitFor(() => document.body.innerText.includes('尚未分配音色') || document.body.innerText.includes('音色信息'));

    const detailText = document.body.innerText;
    const audioPanelButton = Array.from(document.querySelectorAll('.studio-asset-detail-dialog button'))
      .find((node) => normalize(node).includes('音色'));
    await waitFor(async () => {
      const result = await window.studioAssets?.list?.({ type: 'audio', search: 'Smoke青年男声', limit: 10 });
      return result?.items?.length ? result : null;
    }, 5000);
    const clickedVoicePanel = activate(audioPanelButton);
    await waitFor(() => document.body.innerText.includes('资产库音频'));
    const searchedVoiceDialog = await searchVoiceAssignDialog('Smoke青年男声');
    const voiceCandidate = await waitFor(() => Array.from(document.querySelectorAll('[role="dialog"] button[title], .studio-asset-detail-dialog button[title], button[title]'))
      .find((node) => (node.getAttribute('title') || '').includes('Smoke青年男声') || normalize(node).includes('Smoke青年男声')), 8000);
    const dialogText = document.body.innerText;
    const clickedVoiceCandidate = activate(voiceCandidate);
    await wait(250);
    const confirmAssign = clickButtonByText('确认分配');
    await waitFor(() => document.body.innerText.includes('已绑定音色音频') || !document.body.innerText.includes('资产库音频'));
    const afterAssignText = document.body.innerText;
    await waitFor(() => document.body.innerText.includes('克隆音色') || document.body.innerText.includes('音色信息'));
    const afterBindingText = document.body.innerText;
    const closedVoiceDialog = await closeTopDialog();
    const closedRoleDetailDialog = await closeTopDialog();
    await waitFor(() => document.querySelectorAll('[role="dialog"]').length === 0, 3000);
    const openDialogCountBeforeAudio = document.querySelectorAll('[role="dialog"]').length;
    const clickedAudio = clickButtonByText('音频', true);
    await waitFor(() => document.body.innerText.includes('音频库'));
    await searchAssetLibrary('Smoke青年男声');
    await waitFor(() => document.body.innerText.includes('Smoke青年男声'));
    const audioLibraryText = document.body.innerText;
    const audioCards = Array.from(document.querySelectorAll('.studio-asset-library button[title]'));
    const smokeAudioCard = audioCards.find((node) => (node.getAttribute('title') || '').includes('Smoke青年男声') || normalize(node).includes('Smoke青年男声'));
    const clickedAudioCard = activate(smokeAudioCard || audioCards[0]);
    await waitFor(() => document.querySelector('audio[controls]'));
    const audioElement = document.querySelector('audio[controls]');
    const audioLoadResult = audioElement ? await new Promise((resolve) => {
      let done = false;
      const finish = (result) => {
        if (done) return;
        done = true;
        resolve(result);
      };
      const timeout = setTimeout(() => finish({
        loadedmetadata: false,
        readyState: audioElement.readyState,
        currentSrc: audioElement.currentSrc || audioElement.getAttribute('src') || '',
        error: audioElement.error?.message || audioElement.error?.code || null,
      }), ${AUDIO_METADATA_TIMEOUT_MS});
      audioElement.addEventListener('loadedmetadata', () => {
        clearTimeout(timeout);
        finish({
          loadedmetadata: true,
          readyState: audioElement.readyState,
          duration: Number.isFinite(audioElement.duration) ? audioElement.duration : null,
          currentSrc: audioElement.currentSrc || audioElement.getAttribute('src') || '',
          error: null,
        });
      }, { once: true });
      audioElement.addEventListener('error', () => {
        clearTimeout(timeout);
        finish({
          loadedmetadata: false,
          readyState: audioElement.readyState,
          currentSrc: audioElement.currentSrc || audioElement.getAttribute('src') || '',
          error: audioElement.error?.message || audioElement.error?.code || 'audio error',
        });
      }, { once: true });
      audioElement.load();
      if (audioElement.readyState >= 1) {
        clearTimeout(timeout);
        finish({
          loadedmetadata: true,
          readyState: audioElement.readyState,
          duration: Number.isFinite(audioElement.duration) ? audioElement.duration : null,
          currentSrc: audioElement.currentSrc || audioElement.getAttribute('src') || '',
          error: null,
        });
      }
    }) : { loadedmetadata: false, readyState: -1, currentSrc: '', error: 'audio[controls] missing' };

    return {
      clickedAssets: clickedAssets.clicked,
      clickedRole: clickedRole.clicked,
      hasRoleLibrary: bodyAfterRole.includes('角色库'),
      hasAutoAssignAudio: bodyAfterRole.includes('自动分配音频'),
      roleCardCount: roleCards.length,
      clickedRoleCard,
      hasRoleDetail: detailText.includes('名字') && detailText.includes('音色'),
      clickedVoicePanel,
      searchedVoiceDialog,
      hasVoiceDialog: dialogText.includes('为角色「') && dialogText.includes('分配音色'),
      hasVoiceDialogAudioSection: dialogText.includes('资产库音频'),
      hasConfirmAssign: dialogText.includes('确认分配'),
      clickedVoiceCandidate,
      clickedConfirmAssign: confirmAssign.clicked,
      hasAssignSuccess: afterAssignText.includes('已绑定音色音频') || afterBindingText.includes('克隆音色'),
      hasBoundVoiceDetail: afterBindingText.includes('音色信息') && afterBindingText.includes('克隆音色'),
      voiceDialogShowsAudioOrEmptyState:
        dialogText.includes('共 ') ||
        dialogText.includes(' / ') ||
        dialogText.includes('搜索音频名称或文件名') ||
        dialogText.includes('Smoke青年男声') ||
        dialogText.includes('资产库中暂无可用音频。请先在资产库导入 WAV/MP3 音色样本。'),
      closedVoiceDialog,
      closedRoleDetailDialog,
      openDialogCountBeforeAudio,
      clickedAudio: clickedAudio.clicked,
      hasAudioLibrary: audioLibraryText.includes('音频库') && audioLibraryText.includes('音色'),
      audioCardCount: audioCards.length,
      clickedAudioCard,
      hasAudioControls: Boolean(audioElement),
      audioLoadedMetadata: Boolean(audioLoadResult.loadedmetadata),
      audioReadyState: audioLoadResult.readyState,
      audioCurrentSrc: audioLoadResult.currentSrc,
      audioError: audioLoadResult.error,
      bodyTextSample: dialogText.slice(0, 1000),
    };
  })()`,
    "asset voice flow check",
    ASSET_VOICE_FLOW_TIMEOUT_MS,
  );
  return { ...flow, seed };
}

async function verifyScriptAssetGenerationVoiceFlow(evaluate) {
  return evaluate(
    `(async () => {
    const normalize = (node) => (node.textContent || '').replace(/\\s+/g, ' ').trim();
    const activate = (node) => {
      if (!node) return false;
      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, pointerType: 'mouse' }));
      node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1, view: window }));
      node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 0, pointerType: 'mouse' }));
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, buttons: 0, view: window }));
      node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, view: window }));
      return true;
    };
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitFor = async (predicate, timeout = 5000) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await wait(150);
      }
      return null;
    };
    const clickButtonByText = (text, exact = false) => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const button = buttons.find((node) => {
        const normalized = normalize(node);
        return exact ? normalized === text : normalized.includes(text);
      });
      return { clicked: activate(button), text: button ? normalize(button) : '' };
    };

    await waitFor(() => window.mystudioWorkflowSmoke?.seedCompleteWorkflow, 10_000);
    const seedResult = await window.mystudioWorkflowSmoke?.seedCompleteWorkflow?.();
    const clickedWorkflow = clickButtonByText('工作流', true);
    await waitFor(() => document.body.innerText.includes('当前工作区：漫影工作流'), 5000);
    await window.mystudioWorkflowSmoke?.setWorkflowStage?.('assets');
    await wait(900);
    const bodyBefore = document.body.innerText;
    const clickedAutoAssign = clickButtonByText('自动分配音频');
    await waitFor(async () => {
      const inspected = await window.mystudioWorkflowSmoke?.inspectWorkflow?.();
      return inspected?.checks?.hasVoiceBinding ? inspected : null;
    }, 5000);
    const inspectResult = await window.mystudioWorkflowSmoke?.inspectWorkflow?.();
    const bodyAfter = document.body.innerText;
    return {
      seedResult,
      clickedWorkflow: clickedWorkflow.clicked,
      hasGenerationStage: bodyBefore.includes('资产生成') && bodyBefore.includes('承接本阶段已提取的角色、场景、道具'),
      hasAutoAssignAudio: bodyBefore.includes('自动分配音频'),
      hasCharacterRow: bodyBefore.includes('独孤剑尘'),
      clickedAutoAssign: clickedAutoAssign.clicked,
      hasVoiceBinding: Boolean(inspectResult?.checks?.hasVoiceBinding),
      hasAutoAssignSuccess: bodyAfter.includes('已为 ') && bodyAfter.includes('自动分配音频'),
      inspectResult,
      bodyTextSample: bodyAfter.slice(0, 1000),
    };
  })()`,
    "script asset generation voice flow check",
    ASSET_VOICE_FLOW_TIMEOUT_MS,
  );
}

async function captureScreenshotStats(send) {
  const screenshot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  const png = PNG.sync.read(Buffer.from(screenshot.data, "base64"));
  let sampled = 0;
  let white = 0;
  let transparent = 0;
  const pixelStride = Math.max(
    1,
    Math.floor((png.width * png.height) / 80_000),
  );

  for (let y = 0; y < png.height; y += pixelStride) {
    for (let x = 0; x < png.width; x += pixelStride) {
      const offset = (png.width * y + x) * 4;
      const r = png.data[offset];
      const g = png.data[offset + 1];
      const b = png.data[offset + 2];
      const a = png.data[offset + 3];
      sampled += 1;
      if (a < 16) transparent += 1;
      if (r > 245 && g > 245 && b > 245 && a > 240) white += 1;
    }
  }

  return {
    source: "screenshot",
    width: png.width,
    height: png.height,
    sampled,
    whiteRatio: sampled > 0 ? white / sampled : 1,
    transparentRatio: sampled > 0 ? transparent / sampled : 1,
    bytes: screenshot.data.length,
  };
}

async function captureVisualStats(send, domVisualStats) {
  try {
    return await captureScreenshotStats(send);
  } catch (error) {
    const captureError = error instanceof Error ? error.message : String(error);
    console.warn(
      `[smoke] screenshot capture failed, falling back to DOM visual stats: ${captureError}`,
    );
    return { ...domVisualStats, captureError };
  }
}

async function captureDomVisualStats(evaluate) {
  return evaluate(
    `(() => {
    const parseColor = (color) => {
      const match = color.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
      if (!match) return null;
      return {
        r: Number(match[1]),
        g: Number(match[2]),
        b: Number(match[3]),
        a: match[4] === undefined ? 1 : Number(match[4]),
      };
    };
    const visibleColorAt = (x, y) => {
      let node = document.elementFromPoint(x, y);
      while (node && node instanceof Element) {
        const color = parseColor(getComputedStyle(node).backgroundColor);
        if (color && color.a > 0.1) return color;
        node = node.parentElement;
      }
      return parseColor(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    };
    const points = [];
    const columns = 9;
    const rows = 7;
    for (let row = 1; row <= rows; row += 1) {
      for (let col = 1; col <= columns; col += 1) {
        points.push({
          x: Math.round((window.innerWidth * col) / (columns + 1)),
          y: Math.round((window.innerHeight * row) / (rows + 1)),
        });
      }
    }
    let white = 0;
    let transparent = 0;
    for (const point of points) {
      const color = visibleColorAt(point.x, point.y);
      if (color.a < 0.1) transparent += 1;
      if (color.r > 245 && color.g > 245 && color.b > 245 && color.a > 0.9) white += 1;
    }
    return {
      source: 'dom',
      captureError: null,
      width: window.innerWidth,
      height: window.innerHeight,
      sampled: points.length,
      whiteRatio: points.length > 0 ? white / points.length : 1,
      transparentRatio: points.length > 0 ? transparent / points.length : 1,
      bodyTextLength: document.body.innerText.trim().length,
    };
  })()`,
    "DOM visual stats fallback",
  );
}

function assertHealthy(
  state,
  errors,
  overviewWorkflow,
  routeChecks,
  workflowStages,
  workflowEndToEnd,
  assetVoiceFlow,
  scriptAssetGenerationVoiceFlow,
  pythonSettings,
  screenshot,
) {
  const failures = [];
  if (state.readyState !== "complete")
    failures.push(`document not complete: ${state.readyState}`);
  if (state.rootChildren < 1) failures.push("React root has no children");
  if (state.hasWhiteBody)
    failures.push(`body background is white: ${state.bodyBg}`);
  if (state.bodyTextLength < 20)
    failures.push(`body text is too short: ${state.bodyTextLength}`);
  if (!state.hasProjectOverview && !state.hasWorkspaceContent) {
    failures.push(
      "neither project dashboard nor workspace content was rendered",
    );
  }
  if (!overviewWorkflow.clickedOverview || !overviewWorkflow.hasProjectEntry) {
    failures.push("project overview entry did not render");
  }
  if (!overviewWorkflow.hasWorkflowEntry || !overviewWorkflow.hasAssetEntry) {
    failures.push(
      "project overview is missing workflow or asset entry actions",
    );
  }
  if (overviewWorkflow.forbiddenTextFound.length > 0) {
    failures.push(
      `project overview rendered removed workflow guide copy: ${overviewWorkflow.forbiddenTextFound.join(", ")}`,
    );
  }
  for (const route of routeChecks) {
    if (!route.clicked) failures.push(`route button not found: ${route.label}`);
    if (route.clicked && !route.hasRequiredText) {
      failures.push(
        `route missing required content: ${route.label} (${route.missingRequiredText.join(", ")})`,
      );
    }
    if (route.clicked && route.forbiddenTextFound.length > 0) {
      failures.push(
        `route rendered forbidden content: ${route.label} (${route.forbiddenTextFound.join(", ")})`,
      );
    }
  }
  if (!workflowStages.clickedWorkflow)
    failures.push("workflow route button not found for stage checks");
  if (workflowStages.hasTopNodeCanvas) {
    failures.push(
      "workflow node canvas rendered above the workflow stage content",
    );
  }
  const storyboardStage = (workflowStages.stages || []).find(
    (stage) => stage.id === "storyboard",
  );
  const generationStage = (workflowStages.stages || []).find(
    (stage) => stage.id === "assets",
  );
  if (!storyboardStage?.hasNodeCanvas) {
    failures.push(
      `storyboard video generation React Flow workflow canvas did not render: canvas=${storyboardStage?.hasNodeCanvas}`,
    );
  }
  if (generationStage?.hasGenerationNodeCanvas) {
    failures.push(
      "workflow node canvas rendered inside 剧本资产管理 instead of 分镜视频生成",
    );
  }
  const expectedProductionNodes = [
    "script",
    "scriptPlan",
    "storyboardTable",
    "storyboard",
    "workbench",
  ];
  const missingProductionNodes = expectedProductionNodes.filter(
    (node) => !storyboardStage?.productionNodes?.includes(node),
  );
  if (missingProductionNodes.length > 0) {
    failures.push(
      `storyboard workflow node layout missing nodes: ${missingProductionNodes.join(", ")}`,
    );
  }
  for (const stage of workflowStages.stages || []) {
    if (!stage.clicked)
      failures.push(`workflow stage button not found: ${stage.label}`);
    if (stage.clicked && !stage.hasRequiredText) {
      failures.push(
        `workflow stage missing required content: ${stage.label} (${stage.missingRequiredText.join(", ")})`,
      );
    }
    if (stage.clicked && stage.hasForbiddenText) {
      failures.push(
        `workflow stage rendered removed content: ${stage.label} (${stage.presentForbiddenText.join(", ")})`,
      );
    }
  }
  if (!workflowEndToEnd.bridgeAvailable)
    failures.push("workflow smoke bridge was not available");
  if (!workflowEndToEnd.clickedWorkflow)
    failures.push("workflow route button not found for end-to-end check");
  if (
    !workflowEndToEnd.inspectResult ||
    workflowEndToEnd.inspectResult.progress !== 100
  ) {
    failures.push(
      `workflow end-to-end readiness did not reach 100%: ${workflowEndToEnd.inspectResult?.progress ?? "missing"}`,
    );
  }
  const workflowChecks = workflowEndToEnd.inspectResult?.checks ?? {};
  for (const [key, ok] of Object.entries(workflowChecks)) {
    if (!ok) failures.push(`workflow end-to-end check failed: ${key}`);
  }
  if (
    !workflowEndToEnd.hasCompletedExport ||
    !workflowEndToEnd.hasSelectedCandidate ||
    !workflowEndToEnd.hasVoiceFlow ||
    !workflowEndToEnd.hasVoiceAudio
  ) {
    failures.push(
      "workflow end-to-end UI did not show export, selected candidate, voice binding, and voice audio completion",
    );
  }
  if (!workflowEndToEnd.hasNodeFlowDataPreview) {
    failures.push(
      `workflow node cards did not show Toonflow FlowData previews: ${(workflowEndToEnd.missingNodePreviewText || []).join(", ")}`,
    );
  }
  if (!assetVoiceFlow.clickedAssets)
    failures.push("assets route button not found for asset voice flow check");
  if (!assetVoiceFlow.clickedRole)
    failures.push("role asset sidebar item not found");
  if (!assetVoiceFlow.hasRoleLibrary || !assetVoiceFlow.hasAutoAssignAudio) {
    failures.push("role asset library did not render role voice actions");
  }
  if (assetVoiceFlow.roleCardCount < 1 || !assetVoiceFlow.clickedRoleCard) {
    failures.push(
      `no role asset card could be opened: ${assetVoiceFlow.roleCardCount}`,
    );
  }
  if (!assetVoiceFlow.hasRoleDetail || !assetVoiceFlow.clickedVoicePanel) {
    failures.push(
      "role asset detail did not expose the voice assignment entry",
    );
  }
  if (
    !assetVoiceFlow.hasVoiceDialog ||
    !assetVoiceFlow.hasVoiceDialogAudioSection ||
    !assetVoiceFlow.hasConfirmAssign
  ) {
    failures.push(
      "role voice assignment dialog did not render required controls",
    );
  }
  if (
    !assetVoiceFlow.clickedVoiceCandidate ||
    !assetVoiceFlow.searchedVoiceDialog ||
    !assetVoiceFlow.clickedConfirmAssign ||
    !assetVoiceFlow.hasAssignSuccess
  ) {
    failures.push(
      "role voice assignment did not select and bind the seeded audio",
    );
  }
  if (!assetVoiceFlow.hasBoundVoiceDetail) {
    failures.push(
      "role detail did not show the bound cloned voice after assignment",
    );
  }
  if (!assetVoiceFlow.voiceDialogShowsAudioOrEmptyState) {
    failures.push(
      "role voice assignment dialog did not show audio options or empty state",
    );
  }
  if (
    !assetVoiceFlow.closedVoiceDialog ||
    assetVoiceFlow.openDialogCountBeforeAudio > 0
  ) {
    failures.push(
      `asset voice flow left dialogs open before opening the audio library: ${assetVoiceFlow.openDialogCountBeforeAudio}`,
    );
  }
  if (!assetVoiceFlow.clickedAudio || !assetVoiceFlow.hasAudioLibrary) {
    failures.push(
      "audio asset library could not be reached for playback entry check",
    );
  }
  if (
    !assetVoiceFlow.clickedAudioCard ||
    !assetVoiceFlow.hasAudioControls ||
    !assetVoiceFlow.audioLoadedMetadata
  ) {
    failures.push(
      `audio detail playback control did not load metadata: ${assetVoiceFlow.audioError || assetVoiceFlow.audioReadyState}`,
    );
  }
  if (
    !scriptAssetGenerationVoiceFlow.hasGenerationStage ||
    !scriptAssetGenerationVoiceFlow.hasAutoAssignAudio ||
    !scriptAssetGenerationVoiceFlow.hasCharacterRow
  ) {
    failures.push(
      "script asset generation did not expose role audio assignment",
    );
  }
  if (
    !scriptAssetGenerationVoiceFlow.clickedAutoAssign ||
    !scriptAssetGenerationVoiceFlow.hasVoiceBinding
  ) {
    failures.push(
      "script asset generation voice assignment did not bind a character voice",
    );
  }
  if (!pythonSettings.clickedSettings)
    failures.push("settings route button not found for Python settings check");
  if (!pythonSettings.clickedPythonTab)
    failures.push("Python settings tab was not found");
  if (!pythonSettings.hasRequiredText) {
    failures.push(
      `Python settings missing required content: ${pythonSettings.missingRequiredText.join(", ")}`,
    );
  }
  if (pythonSettings.forbiddenTextFound.length > 0) {
    failures.push(
      `Python settings appears to auto-configure before user action: ${pythonSettings.forbiddenTextFound.join(", ")}`,
    );
  }
  if (!screenshot || screenshot.whiteRatio > 0.75) {
    failures.push(
      `screenshot is too white: ${screenshot ? screenshot.whiteRatio.toFixed(3) : "missing"}`,
    );
  }
  if (!screenshot || screenshot.transparentRatio > 0.1) {
    failures.push(
      `screenshot is unexpectedly transparent: ${screenshot ? screenshot.transparentRatio.toFixed(3) : "missing"}`,
    );
  }
  if (errors.length > 0)
    failures.push(`page reported ${errors.length} runtime/log error(s)`);

  if (failures.length > 0) {
    console.error("Desktop smoke failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    console.error(JSON.stringify(state, null, 2));
    console.error(
      JSON.stringify(
        {
          overviewWorkflow,
          routeChecks,
          workflowEndToEnd,
          assetVoiceFlow,
          scriptAssetGenerationVoiceFlow,
          pythonSettings,
          screenshot,
          pageErrors: errors.map(summarizePageError),
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  console.log(
    `Desktop smoke passed: ${state.title}, rootChildren=${state.rootChildren}, bodyBg=${state.bodyBg}, routes=${routeChecks.length}, workflowE2E=ok, assetVoiceFlow=ok, scriptAssetGenerationVoiceFlow=ok, pythonSettings=ok, whiteRatio=${screenshot.whiteRatio.toFixed(3)}, appBin=${appBin}`,
  );
}

prepareSmokeMedia();

const child = spawn(
  appBin,
  [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${userDataDir}`],
  {
    cwd: process.cwd(),
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1", MYSTUDIO_SMOKE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

child.stdout.on("data", (data) => process.stdout.write(data));
child.stderr.on("data", (data) => process.stderr.write(data));

try {
  const page = await waitForPageTarget();
  const {
    state,
    errors,
    overviewWorkflow,
    routeChecks,
    workflowStages,
    workflowEndToEnd,
    assetVoiceFlow,
    scriptAssetGenerationVoiceFlow,
    pythonSettings,
    screenshot,
  } = await inspectPage(page);
  assertHealthy(
    state,
    errors,
    overviewWorkflow,
    routeChecks,
    workflowStages,
    workflowEndToEnd,
    assetVoiceFlow,
    scriptAssetGenerationVoiceFlow,
    pythonSettings,
    screenshot,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
  rmSync(SMOKE_VIDEO_PATH, { force: true });
}
