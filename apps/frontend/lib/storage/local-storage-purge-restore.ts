// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * C1③ leveldb 明文物理清除——渲染侧两拍执行面(0924,权威:
 * .trellis/tasks/09-24-c1-leveldb-purge/design.md)。
 *
 * 本模块由 main.tsx **首位 import**(先于 React/一切 store 模块):ESM 按导入序
 * 求值,模块体在首个 store 求值前同步跑完拍1 回写,保证 store hydrate 读到的
 * 已是回写后的完整 localStorage。按主进程 boot 判定模式分支:
 *
 *   pending(拍0):同步快照 Object.entries(localStorage) 全量 → IPC purge:stage
 *     原子落盘 → purge:relaunch 自动重启;等待期挂全屏覆盖层挡住 UI 交互。
 *     stage 失败则撤覆盖层照常启动(数据未动,下个 boot 重试)。
 *   quarantine(拍1):sendSync 同步取 staged → 同步逐键 setItem 全量回写 →
 *     fire-and-forget confirm(失败靠下个 boot 回滚状态机自愈,不丢数据)。
 *   idle / 桥缺席 / 任何异常:no-op。
 *
 * 纪律(spec frontend/state-management C4):模块体绝不抛错——入口模块炸掉会白屏;
 * 全路径 try/catch。幂等:模块级 + globalThis 双标记,热重载/双执行零副作用。
 */
declare global {
  interface Window {
    c1Purge?: {
      getMode: () => { mode: "idle" | "pending" | "quarantine" };
      getStagedSync: () =>
        | { ok: true; entries: Array<[string, string]> }
        | { ok: false; reason: string };
      stage: (entries: Array<[string, string]>) => Promise<{ ok: true } | { ok: false; reason?: string }>;
      confirm: () => Promise<{ ok: boolean }>;
      relaunch: () => Promise<{ ok: boolean }>;
    };
  }
}

type C1PurgeBridge = NonNullable<Window["c1Purge"]>;

const STARTED_FLAG = "__mystudioC1PurgeRestoreStarted";
const OVERLAY_ID = "c1-purge-pending-overlay";

let moduleStarted = false;

/** 全量捕获 localStorage(逐键 getItem,不用Storage.prototype 上的污染键)。 */
function captureLocalStorageEntries(): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key === null) continue;
    const value = localStorage.getItem(key);
    if (value === null) continue;
    entries.push([key, value]);
  }
  return entries;
}

/** 拍0 等待态:原生 DOM 全屏覆盖层(此时 React 尚未挂载,不能依赖组件树)。 */
function installPendingOverlay(): void {
  try {
    if (typeof document === "undefined" || document.getElementById(OVERLAY_ID)) return;
    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.setAttribute("role", "status");
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      background: "rgba(10, 10, 12, 0.96)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "#e5e7eb",
      font: "14px system-ui, -apple-system, sans-serif",
      pointerEvents: "all",
    } satisfies Partial<CSSStyleDeclaration>);
    overlay.textContent = "正在完成安全迁移,应用即将自动重启…";
    document.documentElement.appendChild(overlay);
  } catch {
    // 覆盖层失败不拦协议;relaunch 后进程本就会退出
  }
}

/** 拍0:暂存+重启。异步执行不阻塞入口;stage 成功即请求 relaunch,失败撤等待态照常启动。 */
async function runPendingPhase(bridge: C1PurgeBridge): Promise<void> {
  const entries = captureLocalStorageEntries();
  // 空库守卫:boot 判定 pending 意味着盘上有明文残留,渲染侧同步读到的
  // localStorage 必然非空;若异常地空(读取失败/隐私模式),stage 空表会让拍1
  // 回写出空库=毁数据。放弃协议,留给下个 boot 重试。
  if (entries.length === 0) return;
  installPendingOverlay();
  try {
    const reply = await bridge.stage(entries);
    if (reply && reply.ok) {
      // relaunch 通道立即返回=主进程已调度延迟成熟退出(5s,避开启动早期原生
      // 阻塞窗口),**不假设立即重启**:保持覆盖层静待主进程收尾,期间不做任何
      // 后续动作;若用户手动退出,主进程取消 relaunch、staged 保留,下次启动走拍1。
      await bridge.relaunch();
      return;
    }
  } catch {
    // 桥异常:撤等待态照常启动(数据未动)
  }
  removePendingOverlay();
}

function removePendingOverlay(): void {
  try {
    if (typeof document === "undefined") return;
    document.getElementById(OVERLAY_ID)?.remove();
  } catch {
    // 尽力而为
  }
}

/**
 * 拍1:同步取档+同步回写。必须在首个 store 模块求值前完成(本模块居 main.tsx
 * 首位保证),故全程同步:sendSync 取 staged → 逐键 setItem → confirm 异步收尾。
 * 取档失败:no-op(旧库仍在主进程 quarantine 原样保留,下个 boot 走回滚恢复重来,
 * 绝不丢数据);confirm 失败同样靠下个 boot 自愈。
 */
function runQuarantinePhase(bridge: C1PurgeBridge): void {
  const reply = bridge.getStagedSync();
  if (!reply || !reply.ok) return;
  for (const [key, value] of reply.entries) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // 单键回写失败(配额等):继续其余键,尽最大覆盖;差异下个 boot 无法自愈
      // 但 staged/quarantine 已由 confirm 收尾,维持现状是损失最小的形态
    }
  }
  void bridge
    .confirm()
    .then(() => undefined)
    .catch(() => undefined);
}

/** 幂等入口(模块体自动执行;也支持显式调用,双守卫防热重载/双执行)。 */
export function runLocalStoragePurgeRestore(): void {
  if (moduleStarted) return;
  const globals = globalThis as typeof globalThis & { [STARTED_FLAG]?: boolean };
  if (globals[STARTED_FLAG]) return;
  moduleStarted = true;
  globals[STARTED_FLAG] = true;
  try {
    if (typeof window === "undefined") return;
    const bridge = window.c1Purge;
    if (!bridge || typeof bridge.getMode !== "function") return;
    const modeReply = bridge.getMode();
    const mode = modeReply && modeReply.mode;
    if (mode === "pending") {
      void runPendingPhase(bridge);
    } else if (mode === "quarantine") {
      runQuarantinePhase(bridge);
    }
    // idle:零动作
  } catch {
    // 入口模块绝不抛(抛=白屏);任何异常都视同未发生,协议靠下个 boot 磁盘状态自愈
  }
}

runLocalStoragePurgeRestore();
