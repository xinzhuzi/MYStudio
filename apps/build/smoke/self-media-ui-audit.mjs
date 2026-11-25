// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 自媒体面板界面视觉审计(1125 二轮收尾计划 L14 脚手架)。
 *
 * 拉起一个隔离档案的应用实例,经 CDP 逐个进入状态矩阵里的状态,采集原始事实、按规则判定、
 * 截图、出报告。判定全在 self-media-ui-audit-rules.mjs(纯函数,有单测);本文件只做守卫、
 * 拉起、连接、导航、采集、截图、出报告、收尾。不改应用代码,不加 npm 别名。
 *
 * 跑法(cwd=apps/;解锁变量只能由主会话在用户明确同意后设置):
 *   MANYYING_ALLOW_APP_LAUNCH=1 node build/smoke/self-media-ui-audit.mjs [--no-screenshot]
 * 环境变量:MYSTUDIO_SMOKE_APP_BIN(应用二进制)、MYSTUDIO_UI_AUDIT_DEBUG_PORT(调试端口,默认 9343)。
 * 产出:output/automation/self-media-ui-audit/<时间戳>/report.json 与 <主题>/<状态>.png。
 * 退出码:0 没有失败项;1 有失败项;2 运行失败。
 *
 * 运行生命周期(状态 → 事件 → 守卫 → 次态;★ 是破坏性转移):
 *   boot        读环境     缺解锁 / 带强杀开关        → done(2),零 IO
 *   guarded     解析产物   打包产物不存在 / 调试端口被占 → done(2),不建档案不拉起
 *   launched    等页面目标 子进程先退 / 超时          → 收尾;不回落 LaunchServices
 *   connected   隔离核对   连接后的第一件事,只读;   相等 → 导航;不等 → 收尾(这条连接上不再发别的命令)
 *   auditing    进入态断言 不过 / 稳定化超时          → 记失败项跳过该状态 / 记运行警告继续
 *   auditing    截图       失败                       → 收尾(运行失败,不回落截屏命令)
 *   收尾        还原度量 → Browser.close → 等子进程退出 → 宽限后仍在才★收自己的子进程
 *              → ★删自建档案(须是 tmpdir 之下 mystudio-smoke- 开头,且子进程已退)
 *
 * 本波实现状态矩阵的 a1–a9(九个页签默认态)、b1–b5(种子态)与 c1/c2(种子任务态,
 * 依赖 L6 的 batchId/batchRole 字段名,L6 落地后才出预期状态)。
 * 运行时行为尚未实跑:首次探针要确认的事见任务档 implement.md 第 5 节。
 */

import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSmokeApp } from "./smoke-launch.mjs";
import { terminateSpawnedApp } from "./smoke-process-lifecycle.mjs";
import {
  AUDIT_PROJECT_ID, AUDIT_STATES, DEFAULT_VIEWPORT, EXIT_CODES, SCREENSHOT_THEME_IDS,
  classifyContrastScope, countByScope, evaluateContrast, evaluateOverlap, evaluateTruncation,
  isOwnedTempProfile, parseThemeTokens, planCollectionUnits, resolveExitCode, resolveLaunchGuard,
} from "./self-media-ui-audit-rules.mjs";

const LOG_PREFIX = "[ui-audit]";
/** 应用壳侧栏里进自媒体面板的按钮文字。 */
const NAV_LABEL = "自媒体";
// CDP 单次调用上限必须大于页面侧动作的内部超时(NAVIGATION_TIMEOUT_MS 等 10s),
// 否则页面侧「等不到就优雅返回失败」的路径会先撞死在 CDP 超时上,真实原因被吃掉(1125 首跑实证)。
const CDP_CALL_TIMEOUT_MS = 20_000;
const SCREENSHOT_TIMEOUT_MS = 30_000;
const PAGE_TARGET_TIMEOUT_MS = 15_000;
const DOCUMENT_READY_TIMEOUT_MS = 30_000;
const SMOKE_BRIDGE_TIMEOUT_MS = 15_000;
const NAVIGATION_TIMEOUT_MS = 10_000;
const SETTLE_SPIN_TIMEOUT_MS = 10_000;
const TRANSITION_SETTLE_MS = 600;
const QUIT_GRACE_MS = 5_000;
const EXIT_CONFIRM_MS = 4_000;

const GUARD_MESSAGES = {
  locked:
    "[死守卫] 拒跑:未设置 MANYYING_ALLOW_APP_LAUNCH=1。无用户亲手解锁,任何人不许启动 漫影App;"
    + "解锁只能由主会话在用户明确同意后设置。",
  "prekill-force":
    "[死守卫] 拒跑:环境里带了 MYSTUDIO_SMOKE_PREKILL_FORCE=1。这是冒烟脚本的强杀开关,"
    + "审计不做任何预清理,带上它只会让人顺手照搬冒烟的做法;去掉再跑。",
};

/**
 * 页面侧的全部动作,一个自包含函数:它被序列化成字符串送进页面求值,所以不能引用本模块的
 * 任何标识符,参数一律经 payload 传入。只做导航、种子写入、稳定化和采集原始事实,不做判定。
 * 导航一律用 DOM 的 click(),不派发真实的键盘鼠标按键。导出它只是为了能脱离应用做冒烟。
 */
export async function pageAudit(action, payload = {}) {
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  const squash = (text) => (text || "").replace(/\s+/g, " ").trim();
  const box = (rect) => ({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
  const waitFor = async (probe, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = probe();
      if (value) return value;
      if (Date.now() > deadline) return null;
      await sleep(100);
    }
  };
  const findPanel = () => {
    const heading = [...document.querySelectorAll("h1")].find((node) => squash(node.textContent) === "自媒体发布台");
    const shell = heading?.closest("header")?.parentElement ?? null;
    const nav = shell?.querySelector("nav") ?? null;
    const main = shell?.querySelector("main") ?? null;
    return shell && nav && main ? { root: shell.parentElement ?? shell, nav, main } : null;
  };
  const findTab = (nav, label) => [...nav.querySelectorAll("button")].find((node) => squash(node.textContent) === label) ?? null;
  const tabLabels = (nav) => [...nav.querySelectorAll("button")].map((node) => squash(node.textContent));

  if (action === "enterProject") {
    // 首屏可能是仪表盘(有项目卡片),也可能已经停在项目里。仪表盘上可能同时有默认项目和
    // 预建恢复的审计项目(卡片按 updatedAt 倒序,次序不保证),所以按 data-project-card
    // 的项目 ID 精确点中;种子任务都挂在审计项目下,点错卡片任务就进不了当前项目。
    // 「已在项目里」的判据必须是项目级导航(概览/MY 工作流):仪表盘模式的侧栏按钮
    // (项目/帮助/设置)也带 .studio-nav-button 类,拿任意按钮当判据会把仪表盘误判成
    // 已进项目、漏点卡片(1125 首跑实证,探针取证的侧栏快照见任务档)。
    const cardSelector = payload.projectId ? `[data-project-card="${payload.projectId}"]` : ".dashboard-project-card";
    const entry = await waitFor(() => {
      const card = document.querySelector(cardSelector);
      if (card) return card;
      const inProjectNav = [...document.querySelectorAll(".studio-nav-button")]
        .some((node) => squash(node.textContent).includes("概览"));
      return inProjectNav ? document.querySelector(".studio-nav-button") : null;
    }, payload.timeoutMs);
    if (!entry) return { ok: false, reason: payload.projectId ? `找不到项目卡片 ${payload.projectId},也没有应用壳导航` : "既没有项目卡片也没有应用壳导航" };
    const fromDashboard = entry.matches(".dashboard-project-card") || entry.matches("[data-project-card]");
    if (fromDashboard) entry.click();
    return { ok: true, enteredFrom: fromDashboard ? "dashboard" : "project" };
  }

  if (action === "openPanel") {
    const isNavButton = (node) => node.tagName === "BUTTON" && squash(node.textContent).includes(payload.navLabel);
    const navButton = await waitFor(
      () => [...document.querySelectorAll(".studio-nav-button")].find(isNavButton),
      payload.timeoutMs,
    );
    if (!navButton) return { ok: false, reason: `应用壳里找不到「${payload.navLabel}」导航按钮` };
    navButton.click();
    const panel = await waitFor(findPanel, payload.timeoutMs);
    return panel ? { ok: true } : { ok: false, reason: "点了导航之后面板壳没有出现" };
  }

  if (action === "clickTab") {
    const panel = await waitFor(findPanel, payload.timeoutMs);
    const tab = panel ? findTab(panel.nav, payload.label) : null;
    if (!tab) {
      return { ok: false, reason: `页签「${payload.label}」不存在`, navLabels: panel ? tabLabels(panel.nav) : [] };
    }
    tab.click();
    return { ok: true };
  }

  if (action === "assertPanel") {
    const panel = await waitFor(findPanel, payload.timeoutMs);
    if (!panel) return { ok: false, reason: "面板壳不存在", selected: false, missing: payload.texts };
    const texts = payload.texts ?? [];
    const missingNow = () => texts.filter((text) => !squash(panel.main.textContent).includes(text));
    const missing = (await waitFor(() => missingNow().length === 0, payload.timeoutMs)) ? [] : missingNow();
    const tab = findTab(panel.nav, payload.label);
    const selected = Boolean(tab?.classList.contains("bg-primary"));
    return {
      ok: selected && missing.length === 0,
      selected,
      missing,
      navLabels: tabLabels(panel.nav),
      mainSample: squash(panel.main.textContent).slice(0, 300),
    };
  }

  if (action === "applyTheme") {
    const classes = document.documentElement.classList;
    for (const name of [...classes]) {
      if (name === "light" || name === "dark" || name.startsWith("theme-preset-")) classes.remove(name);
    }
    classes.add(payload.mode);
    if (payload.preset) classes.add(`theme-preset-${payload.preset}`);
    const presets = [...classes].filter((name) => name.startsWith("theme-preset-"));
    const confirmed = classes.contains(payload.mode)
      && (payload.preset ? presets.includes(`theme-preset-${payload.preset}`) : presets.length === 0);
    // 顺手回读这套主题的主色与主色前景:对比度失败项靠它区分「主题 token 级」与「面板自身」。
    // 用一个不渲染的探针元素把 CSS 变量解析成 rgb 串(Tailwind v4 的 bg-primary / text-primary-foreground 用的就是这两个变量)。
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;";
    probe.style.backgroundColor = "var(--color-primary)";
    probe.style.color = "var(--color-primary-foreground)";
    document.body.appendChild(probe);
    const probeStyle = getComputedStyle(probe);
    const tokens = { primary: probeStyle.backgroundColor, primaryForeground: probeStyle.color };
    probe.remove();
    return { ok: confirmed, classes: [...classes], tokens };
  }

  if (action === "settle") {
    const panel = findPanel();
    if (!panel) throw new Error("面板壳不存在,无法稳定化");
    // 两处会常驻的转圈不算:「一键全平台发布」按钮(批次进行时一直转)和进度面板里的逐条状态图标。
    const persistent = (node) => {
      const publish = node.closest("button");
      if (publish && /发布中|一键全平台发布/.test(publish.textContent)) return true;
      for (let current = node.parentElement; current && panel.root.contains(current); current = current.parentElement) {
        if (current.textContent.includes("发布进度")) return true;
      }
      return false;
    };
    const pendingSpinners = () => [...panel.root.querySelectorAll(".animate-spin")].filter((node) => !persistent(node)).length;
    const spinDeadline = Date.now() + payload.spinTimeoutMs;
    while (pendingSpinners() > 0 && Date.now() < spinDeadline) await sleep(50);
    const spinnersLeft = pendingSpinners();
    const layoutSignature = () => {
      let signature = "";
      for (const node of panel.root.querySelectorAll("*")) {
        const rect = node.getBoundingClientRect();
        signature += `${rect.x.toFixed(1)},${rect.y.toFixed(1)},${rect.width.toFixed(1)},${rect.height.toFixed(1)};`;
      }
      return signature;
    };
    // 相邻两帧的布局矩形一致才算稳定。窗口不可见时动画帧不来,1 秒后按不稳定处理。
    const nextFrame = () => new Promise((done) => {
      const bail = setTimeout(() => done(null), 1_000);
      requestAnimationFrame(() => {
        clearTimeout(bail);
        done(layoutSignature());
      });
    });
    let layoutStable = false;
    let previous = await nextFrame();
    for (let attempt = 0; attempt < 60 && previous !== null && !layoutStable; attempt += 1) {
      const current = await nextFrame();
      layoutStable = current !== null && current === previous;
      previous = current;
    }
    await sleep(payload.transitionMs);
    return { spinnersLeft, layoutStable };
  }

  if (action === "collect") {
    const panel = findPanel();
    if (!panel) throw new Error("面板壳不存在,无法采集");
    const { root } = panel;
    const controls = new Set(root.querySelectorAll(
      'button,a[href],input,select,textarea,[role="button"],[role="tab"],[role="link"],'
      + '[role="checkbox"],[role="radio"],[role="switch"],[role="combobox"],[role="option"]',
    ));
    // 面板根以上的祖先先入表:背景要从根元素起逐层合成。svg 内部的元素不采(没有文字)。
    const ancestors = [];
    for (let node = root; node; node = node.parentElement) ancestors.unshift(node);
    const nodes = [...ancestors, ...[...root.querySelectorAll("*")].filter((node) => !node.ownerSVGElement)];
    const pathOf = (node) => {
      const parts = [];
      for (let current = node; ; current = current.parentElement) {
        const sameTag = [...(current.parentElement?.children ?? [current])].filter((sibling) => sibling.tagName === current.tagName);
        parts.unshift(`${current.tagName.toLowerCase()}:${sameTag.indexOf(current) + 1}`);
        if (current === root || !current.parentElement) break;
      }
      return parts.join(">");
    };
    const elements = [];
    const idOf = new Map();
    for (const node of nodes) {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      const overflowX = style.overflowX;
      const overflowY = style.overflowY;
      const clips = overflowX !== "visible" || overflowY !== "visible";
      const isControl = controls.has(node);
      const hasText = [...node.childNodes].some((child) => child.nodeType === Node.TEXT_NODE && child.textContent.trim());
      idOf.set(node, elements.length);
      elements.push({
        id: elements.length,
        parent: -1,
        tag: node.tagName.toLowerCase(),
        path: isControl || clips || hasText ? pathOf(node) : "",
        text: isControl ? squash(node.textContent).slice(0, 80) : "",
        rect: box(rect),
        clip: clips ? { x: rect.x + node.clientLeft, y: rect.y + node.clientTop, w: node.clientWidth, h: node.clientHeight } : null,
        bg: style.backgroundColor,
        opacity: style.opacity,
        color: style.color,
        overflowX,
        overflowY,
        ellipsis: style.textOverflow === "ellipsis",
        // 行数截断的声明值是 none 或一个正整数;属性读不到(undefined、NaN)按没有声明处理。
        lineClamp: Number(style.webkitLineClamp) > 0,
        image: style.backgroundImage !== "none",
        // 背景图原串(本仓外壳靠渐变背景图画底色,规则要靠它合成背景;none 不上送)
        bgImage: style.backgroundImage === "none" ? "" : style.backgroundImage,
        ariaHidden: node.getAttribute("aria-hidden") === "true",
        nativeDisabled: node.matches(":disabled"),
        ariaDisabled: node.getAttribute("aria-disabled") === "true",
        hidden: style.visibility !== "visible",
        fontSize: Number.parseFloat(style.fontSize),
        fontWeight: Number(style.fontWeight),
      });
    }
    nodes.forEach((node, index) => {
      const parent = node.parentElement ? idOf.get(node.parentElement) : undefined;
      elements[index].parent = parent ?? -1;
    });
    const texts = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = squash(node.textContent);
      const element = node.parentElement;
      if (!value || !idOf.has(element) || element.closest("script, style, noscript")) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()].map(box).filter((rect) => rect.w > 0 && rect.h > 0);
      if (rects.length > 0) texts.push({ el: idOf.get(element), text: value.slice(0, 120), rects });
    }
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      elements,
      texts,
      controls: [...controls].filter((node) => idOf.has(node)).map((node) => idOf.get(node)),
    };
  }

  if (action === "contentOverflow") {
    // 内容区比视口高多少:取面板内纵向滚动容器里超出最多的那个。
    const panel = findPanel();
    if (!panel) throw new Error("面板壳不存在,无法量内容高度");
    let extraHeight = 0;
    for (const node of panel.root.querySelectorAll("*")) {
      const { overflowY } = getComputedStyle(node);
      if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight + 1) {
        extraHeight = Math.max(extraHeight, node.scrollHeight - node.clientHeight);
      }
    }
    return { extraHeight };
  }

  if (action === "seedProducts" || action === "seedTemplate") {
    // 种子走真实的 preload 桥接写库,不直接改库。
    const bridgeName = action === "seedProducts" ? "productBridge" : "templateBridge";
    const bridge = window[bridgeName];
    if (!bridge?.upsert) return { ok: false, reason: `页面里没有 ${bridgeName}` };
    const items = action === "seedProducts"
      ? payload.products.map((product) => ["product", product])
      : [["template", payload.template]];
    for (const [key, value] of items) {
      const reply = await bridge.upsert({ [key]: value });
      if (!reply?.success) return { ok: false, reason: `${bridgeName}.upsert 被拒:${reply?.error?.message ?? "无回执"}` };
    }
    return { ok: true };
  }

  if (action === "seedTasks") {
    // 种子任务走真实的建单桥:失败任务(草稿无 scheduledAt)在建单处理器里同步走完发布
    // 路径,以 failure 状态回到回执;定时任务立即回执 scheduled。回执带回的状态不符即报。
    const bridge = window.selfMedia;
    if (!bridge?.createTask) return { ok: false, reason: "页面里没有 selfMedia 桥" };
    const created = [];
    for (const spec of payload.tasks ?? []) {
      const reply = await bridge.createTask({ projectId: payload.projectId, providerId: "aitoearn-local", draft: spec.draft });
      if (!reply?.success) return { ok: false, reason: `createTask(${spec.id}) 被拒:${reply?.error?.message ?? "无回执"}`, created };
      const task = Array.isArray(reply.value) ? reply.value[0] : null;
      if (!task) return { ok: false, reason: `createTask(${spec.id}) 没有带回任务`, created };
      created.push({ spec: spec.id, taskId: task.id, status: task.status });
      if (task.status !== spec.expectStatus) {
        return { ok: false, reason: `种子任务 ${spec.id} 状态是 ${task.status},预期 ${spec.expectStatus}`, created };
      }
    }
    return { ok: true, created };
  }

  if (action === "clickProductEdit") {
    // 卡片上的编辑按钮没有文字也没有 aria-label,悬停才显示,只能按结构定位:
    // 先找文字等于产品名的 span,再向上找第一个含按钮的祖先,取其中第一个按钮。
    const panel = await waitFor(findPanel, payload.timeoutMs);
    if (!panel) return { ok: false, reason: "面板壳不存在" };
    const nameNode = [...panel.main.querySelectorAll("span")].find((node) => squash(node.textContent) === payload.name);
    let card = nameNode ? nameNode.parentElement : null;
    while (card && card !== panel.main && !card.querySelector("button")) card = card.parentElement;
    const edit = card && card !== panel.main ? card.querySelector("button") : null;
    if (!edit) return { ok: false, reason: `找不到产品「${payload.name}」卡片上的编辑按钮` };
    edit.click();
    return { ok: true };
  }

  if (action === "clickMainButton") {
    const button = await waitFor(() => {
      const panel = findPanel();
      return panel ? [...panel.main.querySelectorAll("button")].find((node) => squash(node.textContent) === payload.text) : null;
    }, payload.timeoutMs);
    if (!button) return { ok: false, reason: `内容区里找不到「${payload.text}」按钮` };
    button.click();
    return { ok: true };
  }

  throw new Error(`未知的页面动作:${action}`);
}

// ── CDP:不依赖额外的库,用 Node 自带的 fetch 与 WebSocket(连接方式同 smoke-desktop.mjs) ──

const PAGE_AUDIT_SOURCE = pageAudit.toString();
const READY_PROBE = `(() => document.readyState === "complete" && (document.getElementById("root")?.children.length ?? 0) > 0)()`;

/** 读调试端口上的 /json/list。两秒不应答就放弃这一轮。 */
const readJson = (url) => fetch(url, { signal: AbortSignal.timeout(2_000) }).then((response) => response.json());

function connectWebSocket(url) {
  return new Promise((resolveSocket, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => resolveSocket(socket), { once: true });
    socket.addEventListener("error", () => reject(new Error(`连不上调试页面 ${url}`)), { once: true });
  });
}

function withTimeout(promise, label, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} 超过 ${timeoutMs}ms 没有返回`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** 一条页面连接上的 CDP 客户端:带超时的 send、求值的 evaluate、关闭。请求是串行的,不并发。 */
function createClient(socket) {
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`));
    else entry.resolve(message.result);
  });
  socket.addEventListener("close", () => {
    for (const [, entry] of pending) entry.reject(new Error("CDP 连接已关闭"));
    pending.clear();
  });
  const send = (method, params = {}, timeoutMs = CDP_CALL_TIMEOUT_MS) => {
    const id = ++nextId;
    const request = new Promise((resolveResult, reject) => {
      pending.set(id, { method, resolve: resolveResult, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    return withTimeout(request, method, timeoutMs).finally(() => pending.delete(id));
  };
  const evaluate = async (expression, label, timeoutMs) => {
    const reply = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
    const exception = reply?.exceptionDetails;
    if (exception) {
      throw new Error(`${label}: ${exception.exception?.description ?? exception.text ?? "页面求值出错"}`);
    }
    return reply?.result?.value;
  };
  return { send, evaluate, close: () => socket.close() };
}

// ── 环境解析与子进程跟踪 ────────────────────────────────────────────────────

/** 应用二进制:MYSTUDIO_SMOKE_APP_BIN 优先,其次相对 cwd 找打包产物(候选顺序同冒烟)。 */
function resolveAppBin(env, cwd) {
  const candidates = [
    env.MYSTUDIO_SMOKE_APP_BIN,
    resolve(cwd, "release", "build", "mac-arm64", "mac-arm64", "漫影工作室.app", "Contents", "MacOS", "漫影工作室"),
    resolve(cwd, "release", "build", "mac-arm64", "漫影工作室.app", "Contents", "MacOS", "漫影工作室"),
  ].filter(Boolean);
  return { appBin: candidates.find((candidate) => existsSync(candidate)) ?? null, candidates };
}

/** 调试端口此刻能不能绑上。已被占用说明可能有别的实例在这个端口上,不能连过去操作它。 */
function isPortFree(port) {
  return new Promise((resolveFree) => {
    const probe = createServer();
    probe.once("error", () => resolveFree(false));
    probe.listen({ port, host: "127.0.0.1", exclusive: true }, () => probe.close(() => resolveFree(true)));
  });
}

function trackChildExit(child) {
  const state = { exit: null };
  child.once("exit", (code, signal) => {
    state.exit = { code, signal };
  });
  child.once("error", (error) => {
    state.exit = { error: error.message };
  });
  // 等子进程退出;超时返回 null,表示还在。
  state.waitForExit = (timeoutMs) =>
    (state.exit ? Promise.resolve(state.exit)
      : withTimeout(new Promise((done) => child.once("exit", (code, signal) => done({ code, signal }))), "应用退出", timeoutMs))
      .catch(() => null);
  return state;
}

function describeExit(exit) {
  if (!exit) return "尚未退出";
  return exit.error ? `error=${exit.error}` : `code=${exit.code ?? "null"}, signal=${exit.signal ?? "none"}`;
}

/** 带类别的运行错误:isolation-mismatch(隔离核对不过)、screenshot(截图出不了图)。 */
class AuditError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

/**
 * 档案目录同判定:先 realpath 归一化(macOS 的 /var/folders 是 /private/var/folders 的别名,
 * mkdtempSync 返回 /var/... 而应用经 Electron 解析汇报 /private/var/...),realpath 不可用时
 * 退回剥 /private 前缀比较。1125 首跑实证:严格字符串相等会把这一别名误判成隔离失败。
 */
function isSameUserDataDir(a, b) {
  if (a === b) return true;
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    const stripPrivate = (p) => p.replace(/^\/private/, "");
    return stripPrivate(a) === stripPrivate(b);
  }
}

// ── 主流程 ─────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const SMOKE_BRIDGE_PROBE =
  '(() => { const bridge = window.mystudioSmoke; return { exposed: Boolean(bridge), enabled: bridge?.enabled ?? null, userDataDir: bridge?.userDataDir ?? "" }; })()';

/** 在页面里执行一个动作:页面函数序列化成字符串,参数经 JSON 传入。 */
const pageAction = (client) => (action, payload = {}, timeoutMs = CDP_CALL_TIMEOUT_MS) =>
  client.evaluate(`(${PAGE_AUDIT_SOURCE})(${JSON.stringify(action)}, ${JSON.stringify(payload)})`, action, timeoutMs);

async function waitForPageTarget(debugPort, childState) {
  const deadline = Date.now() + PAGE_TARGET_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const targets = await readJson(`http://127.0.0.1:${debugPort}/json/list`);
      const page = Array.isArray(targets) ? targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl) : null;
      if (page) return page;
    } catch {
      // 调试服务要等 Electron 起来才开,连不上是正常的。
    }
    if (childState.exit) {
      throw new Error(`拉不起实例:审计实例在页面出现之前就退出了(${describeExit(childState.exit)})`);
    }
    await sleep(250);
  }
  throw new Error(`拉不起实例:${PAGE_TARGET_TIMEOUT_MS}ms 内调试端口上没有出现页面目标`);
}

/** 就绪轮询而不是固定等待:空档案首启的文档加载可能超过 4 秒。 */
async function waitForDocument(client) {
  const deadline = Date.now() + DOCUMENT_READY_TIMEOUT_MS;
  for (;;) {
    const ready = await client.evaluate(READY_PROBE, "就绪探测", 2_500).catch(() => false);
    if (ready || Date.now() > deadline) return Boolean(ready);
    await sleep(500);
  }
}

/**
 * 读页面上的冒烟桥:隔离核对用的就是它。这是连接之后、核对通过之前唯一允许发的命令,
 * 而且只读。桥随 preload 注入就有了,还没露出来就等一会儿再读;读到之后再由调用方比对。
 */
async function readSmokeBridge(client) {
  const deadline = Date.now() + SMOKE_BRIDGE_TIMEOUT_MS;
  for (;;) {
    const smoke = await client.evaluate(SMOKE_BRIDGE_PROBE, "隔离核对", 2_500).catch(() => null);
    if (smoke?.exposed || Date.now() > deadline) return smoke;
    await sleep(250);
  }
}

async function enterState(page, state) {
  for (const [action, payload] of state.steps) {
    const step = await page(action, { timeoutMs: NAVIGATION_TIMEOUT_MS, ...payload });
    if (!step?.ok) return { ok: false, reason: `${action}:${step?.reason ?? "无回执"}`, detail: step ?? null };
  }
  const assertion = await page("assertPanel", { label: state.label, texts: state.texts, timeoutMs: NAVIGATION_TIMEOUT_MS });
  return assertion?.ok ? { ok: true } : { ok: false, reason: "进入后的断言不过", detail: assertion ?? null };
}

/**
 * 审计主体。逐个进入状态;每个状态按 planCollectionUnits 的顺序走采集单元:
 * 切视口 → 切主题并回读 → 把指针移到面板外 → 稳定化 → 采集 → 判定;默认亮/默认暗各截图。
 * 指针移开放在稳定化之前:悬停态的淡出也是过渡动画,要落在「等 600 毫秒」里面。
 */
async function auditStates({ client, report, runDir, noScreenshot }) {
  const page = pageAction(client);
  const settle = () => page("settle", { spinTimeoutMs: SETTLE_SPIN_TIMEOUT_MS, transitionMs: TRANSITION_SETTLE_MS }, 30_000);
  let currentViewportId = null;
  const setViewport = async (width, height, viewportId) => {
    await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 0, mobile: false });
    currentViewportId = viewportId;
  };
  const applyViewport = async (viewport) => {
    if (currentViewportId !== viewport.id) await setViewport(viewport.width, viewport.height, viewport.id);
  };
  const shoot = async (fileName) => {
    const filePath = resolve(runDir, fileName);
    mkdirSync(dirname(filePath), { recursive: true });
    let data = null;
    try {
      const shot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, SCREENSHOT_TIMEOUT_MS);
      data = shot?.data ?? null;
    } catch (error) {
      throw new AuditError("screenshot", `Page.captureScreenshot 失败:${error.message}`);
    }
    if (!data) throw new AuditError("screenshot", "Page.captureScreenshot 没有返回图像数据");
    writeFileSync(filePath, Buffer.from(data, "base64"));
    report.screenshots.push(relative(process.cwd(), filePath));
  };
  const ruleEvaluators = { contrast: evaluateContrast, truncation: evaluateTruncation, overlap: evaluateOverlap };

  for (const state of AUDIT_STATES) {
    console.log(`${LOG_PREFIX} 状态 ${state.id}(页签「${state.label}」)`);
    const entered = await enterState(page, state);
    if (!entered.ok) {
      report.failures.push({ rule: "navigation", state: state.id, tab: state.label, reason: entered.reason, detail: entered.detail });
      report.states.push({ id: state.id, collected: false });
      continue;
    }
    let collectedUnits = 0;
    for (const unit of planCollectionUnits()) {
      await applyViewport(unit.viewport);
      const themed = await page("applyTheme", unit.theme);
      if (!themed?.ok) {
        report.warnings.push({ rule: "runtime", kind: "theme-not-applied", state: state.id, theme: unit.theme.id, classes: themed?.classes ?? null });
      }
      const themeTokens = parseThemeTokens(themed?.tokens);
      if (themeTokens) report.themeTokens[unit.theme.id] = themed.tokens;
      await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
      const settled = await settle();
      if (settled.spinnersLeft > 0 || !settled.layoutStable) {
        report.warnings.push({
          rule: "runtime", kind: "unstable", state: state.id, theme: unit.theme.id, viewport: unit.viewport.id, ...settled,
        });
      }
      const snapshot = await page("collect", {}, 60_000);
      const context = { state: state.id, tab: state.label, theme: unit.theme.id, viewport: unit.viewport.id };
      for (const rule of unit.rules) {
        const outcome = ruleEvaluators[rule](snapshot, context);
        // 对比度失败项标归属:theme-token(全应用的主色按钮都是这一对)或 panel(本面板自己的类名选择)
        report.failures.push(...outcome.failures.map((finding) => (
          finding.rule === "contrast" ? { ...finding, scope: classifyContrastScope(finding, themeTokens) } : finding
        )));
        report.warnings.push(...outcome.warnings);
      }
      collectedUnits += 1;

      const wantsScreenshot = !noScreenshot && SCREENSHOT_THEME_IDS.includes(unit.theme.id) && unit.viewport.id === DEFAULT_VIEWPORT.id;
      if (!wantsScreenshot) continue;
      await shoot(`${unit.theme.id}/${state.id}.png`);
      const { extraHeight } = await page("contentOverflow");
      if (extraHeight > 1) {
        // 内容区比视口高:把设备度量的高度临时提到内容高度再截一张,截完还原。
        await setViewport(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height + extraHeight, "full");
        await settle();
        await shoot(`${unit.theme.id}/${state.id}-full.png`);
        currentViewportId = null;
        await applyViewport(DEFAULT_VIEWPORT);
      }
    }
    report.states.push({ id: state.id, collected: true, units: collectedUnits });
  }
}

/**
 * 收尾。只有隔离核对通过过,才对这条连接发还原度量和 Browser.close;核对不过时连到的
 * 可能是别人的实例,那就只关自己的连接、收自己的子进程。宽限后还在,才对自己的子进程 pid
 * 调 terminateSpawnedApp。★ 删自建档案要过两道守卫:是本脚本在 tmpdir 下建的,且子进程已退出。
 */
async function shutdown({ child, childState, client, isolationVerified, userDataDir, tmpRoot }) {
  const problems = [];
  if (client && isolationVerified) {
    await client.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
    // 应用关闭时会断开连接,这条请求多半等不到回应,不等它。
    client.send("Browser.close", {}, 1_000).catch(() => {});
    await childState.waitForExit(QUIT_GRACE_MS);
  }
  client?.close();
  if (child && childState.exit === null) {
    await terminateSpawnedApp(child, { detached: false, logPrefix: LOG_PREFIX });
    await childState.waitForExit(EXIT_CONFIRM_MS);
  }
  child?.stdout?.destroy();
  child?.stderr?.destroy();
  if (!isOwnedTempProfile(userDataDir, tmpRoot)) {
    problems.push(`临时档案不在预期位置,没有清理:${userDataDir}`);
  } else if (childState.exit === null) {
    problems.push(`应用还没有退出,临时档案留着没有删:${userDataDir}`);
  } else {
    try { rmSync(userDataDir, { recursive: true, force: true }); }
    catch (error) { problems.push(`清理临时档案失败(可忽略,系统会自清):${error.message}`); }
  }
  return problems;
}

function describeError(error) {
  const described = { message: error instanceof Error ? error.message : String(error), kind: error?.kind ?? null };
  if (error?.kind === "screenshot") {
    described.hint = "窗口不可见。审计默认按可见窗口拉起;隐藏窗口下请加 --no-screenshot 只做检查。没有回落到任何截屏命令。";
  }
  return described;
}

async function main() {
  // 守卫在任何 IO 之前。
  const guard = resolveLaunchGuard(process.env);
  if (!guard.ok) {
    for (const reason of guard.reasons) console.error(GUARD_MESSAGES[reason]);
    return EXIT_CODES.runFailed;
  }
  const { appBin, candidates } = resolveAppBin(process.env, process.cwd());
  const debugPort = Number(process.env.MYSTUDIO_UI_AUDIT_DEBUG_PORT || "9343");
  const noScreenshot = process.argv.includes("--no-screenshot");
  const refuse = (message) => {
    console.error(`${LOG_PREFIX} 拉不起实例:${message}`);
    return EXIT_CODES.runFailed;
  };
  if (!appBin) return refuse(`找不到打包产物。找过:\n${candidates.join("\n")}\n可用 MYSTUDIO_SMOKE_APP_BIN 指定应用二进制。`);
  if (!Number.isInteger(debugPort) || debugPort <= 0 || debugPort > 65535) {
    return refuse(`MYSTUDIO_UI_AUDIT_DEBUG_PORT 不是合法端口:${process.env.MYSTUDIO_UI_AUDIT_DEBUG_PORT}`);
  }
  if (!(await isPortFree(debugPort))) {
    return refuse(`调试端口 ${debugPort} 已被占用。可能有别的实例在这个端口上,审计不会连过去操作它;换端口或等它退出。`);
  }

  const tmpRoot = resolve(tmpdir());
  const userDataDir = mkdtempSync(resolve(tmpRoot, "mystudio-smoke-"));
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const runDir = resolve(process.cwd(), "output", "automation", "self-media-ui-audit", stamp);
  const reportPath = resolve(runDir, "report.json");
  const report = {
    generatedAt: new Date().toISOString(), ok: false, exitCode: null, appBin, launchMode: null, noScreenshot,
    states: [], failures: [], warnings: [], runErrors: [], screenshots: [],
    themeTokens: {}, summary: null,
  };
  let child = null;
  let childState = { exit: null, waitForExit: async () => null };
  let client = null;
  let isolationVerified = false;
  try {
    // 进项目:启动前在隔离档案里预建 _p 下的项目目录,应用启动后会把它恢复成一个项目。
    // 种子 script 键用旧布局 v0 路径(script.json):布局 v1 激活时 ensureProjectStoreLayout
    // 会把它迁进 store/,两条解析路都认;内容形状照 recoverProjectFromDisk 的读取处
    // ({state:{projects:{<pid>}:{title}}}),让恢复出的项目带确定的名字(1125 首跑实证:
    // 纯空目录依赖恢复兜底,首跑没等到卡片出现)。
    const auditProjectDir = resolve(userDataDir, "projects", "_p", AUDIT_PROJECT_ID);
    mkdirSync(auditProjectDir, { recursive: true });
    writeFileSync(
      resolve(auditProjectDir, "script.json"),
      `${JSON.stringify({ state: { projects: { [AUDIT_PROJECT_ID]: { title: "自媒体界面审计" } } } }, null, 2)}\n`,
    );
    const env = { ...process.env, ELECTRON_ENABLE_LOGGING: "1", MYSTUDIO_SMOKE: "1", MYSTUDIO_SMOKE_BACKGROUND: "0" };
    // 开发态的 MYSTUDIO_REMOTE_DEBUG 会把调试端口固定成 9222,不透传给审计实例。
    delete env.MYSTUDIO_REMOTE_DEBUG;
    // 只直接拉起二进制,不回落 LaunchServices:回落模式下子进程是 open,拿不到应用真身的 pid。
    const launch = spawnSmokeApp({
      appBin,
      args: [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${userDataDir}`],
      cwd: process.cwd(),
      env,
      launchMode: "direct",
    });
    child = launch.child;
    report.launchMode = launch.launchMode;
    childState = trackChildExit(child);
    child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr?.on("data", (chunk) => process.stderr.write(chunk));

    const target = await waitForPageTarget(debugPort, childState);
    client = createClient(await connectWebSocket(target.webSocketDebuggerUrl));

    // 隔离核对排在连接之后的第一件事:实例用的档案目录必须就是脚本建的那个。
    // 不等就只收自己的实例并退出,这条连接上不再发任何别的命令。
    const smoke = await readSmokeBridge(client);
    if (!smoke?.exposed || smoke.enabled !== true || !isSameUserDataDir(smoke.userDataDir, userDataDir)) {
      throw new AuditError(
        "isolation-mismatch",
        `隔离核对不过:实例报告的档案目录是「${smoke?.userDataDir || "未暴露"}」,脚本建的是「${userDataDir}」`,
      );
    }
    isolationVerified = true;

    await client.send("Runtime.enable");
    await client.send("Page.enable");
    if (!(await waitForDocument(client))) {
      throw new Error(`首屏在 ${DOCUMENT_READY_TIMEOUT_MS}ms 内没有就绪`);
    }

    const page = pageAction(client);
    const entered = await page("enterProject", { projectId: AUDIT_PROJECT_ID, timeoutMs: NAVIGATION_TIMEOUT_MS });
    if (!entered?.ok) throw new Error(`进项目失败:${entered?.reason ?? "无回执"}`);
    const opened = await page("openPanel", { navLabel: NAV_LABEL, timeoutMs: NAVIGATION_TIMEOUT_MS });
    if (!opened?.ok) throw new Error(`进自媒体面板失败:${opened?.reason ?? "无回执"}`);

    await auditStates({ client, report, runDir, noScreenshot });
  } catch (error) {
    report.runErrors.push(describeError(error));
  } finally {
    report.runErrors.push(
      ...(await shutdown({ child, childState, client, isolationVerified, userDataDir, tmpRoot })).map((message) => ({ message })),
    );
  }

  const exitCode = resolveExitCode(report);
  report.exitCode = exitCode;
  report.ok = exitCode === EXIT_CODES.ok;
  // 归属小计:退出码只看「有没有失败项」,面板自身与主题 token 级各是多少写进 summary,由人判读
  report.summary = {
    failures: report.failures.length, warnings: report.warnings.length, runErrors: report.runErrors.length,
    ...countByScope(report.failures),
  };
  mkdirSync(runDir, { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `${LOG_PREFIX} 报告:${relative(process.cwd(), reportPath)};失败 ${report.failures.length} 条`
    + `(面板自身 ${report.summary.panel}、主题 token 级 ${report.summary.themeToken}、其它规则 ${report.summary.other}),`
    + `警告 ${report.warnings.length} 条,运行错误 ${report.runErrors.length} 条,截图 ${report.screenshots.length} 张;退出码 ${exitCode}`,
  );
  return exitCode;
}

const isMain = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`${LOG_PREFIX} 运行失败:${describeError(error).message}`);
    process.exitCode = EXIT_CODES.runFailed;
  }
}
