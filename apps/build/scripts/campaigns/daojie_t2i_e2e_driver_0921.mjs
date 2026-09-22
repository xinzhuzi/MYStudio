#!/opt/homebrew/bin/node
// 道劫 t2i 九型实弹 E2E 驱动(0921)
// 用法: node daojie_t2i_e2e_driver_0921.mjs --type <九型之一>
//   人物|场景|道具|美宣|三视图|高清人脸|分镜剧情图|表情差分|概念气氛图
// 流程: 幂等保活引擎(17000) → playwright 真前端(打开/载图/置型/app.queuePrompt(0))
//   → 轮询 /history 至完成 → sips 量测 output 原生分辨率 → 按型达标判定。
// stdout 仅一行最终 JSON(TypeResult);过程日志全走 stderr;ok→exit 0,否则 1。
// 铁律: 生成必须走 ComfyUI 真前端自身的排队路径(app.queuePrompt),禁止自拼 prompt POST。

import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// ---------- 常量(全绝对路径) ----------
const REPO = "/Users/zhengbingjin/Project/Github/MYStudio";
const ENGINE_HOME =
  "/Users/zhengbingjin/Library/Application Support/漫影工作室/comfyui";
const ENGINE_URL = "http://127.0.0.1:17000";
const ENGINE_LOG =
  "/Users/zhengbingjin/Library/Application Support/漫影工作室/engine_e2e.log"; // <家>/../engine_e2e.log
const ENGINE_LOCK = "/tmp/daojie_e2e_engine.lock";
const ENGINE_PY = join(ENGINE_HOME, "venv/bin/python");
const ENGINE_MAIN = join(ENGINE_HOME, "ComfyUI/main.py");
const ENGINE_ARGS = [
  "--listen", "127.0.0.1",
  "--port", "17000",
  "--enable-manager",
  "--gpu-only",
  "--reserve-vram", "16",
  "--use-pytorch-cross-attention",
  "--input-directory", join(ENGINE_HOME, "input"),
  "--output-directory", join(ENGINE_HOME, "output"),
];
const WORKFLOW_JSON =
  "/Users/zhengbingjin/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-文生图-道劫.json";
const OUTPUT_DIR = join(ENGINE_HOME, "output");
const BASE_NODE_ID = "80"; // MyDaojieBase 九选一 widget: base
const APPLIED_NODE_ID = "86"; // easy showAnything 按型线路生效披露
const SUBJECT_NODE_ID = "50"; // PrimitiveStringMultiline widget: value(按型主体句)
const ENGINE_WAIT_MS = 180_000; // 冷拉起等 200 上限
const FRONT_READY_MS = 60_000; // window.app 就绪上限
// 0921 修复(美宣轮):等待窗从「提交后固定 720s」改为「进程级 deadline」+提交前错峰。
// 真因:外层九型并行逐型实弹,8 型 prompt 数秒内同窗入队(engine_e2e.log 11:52:13-17
// number=5..12),引擎串行执行每单 126-313s,队尾型(美宣 number=12)在 720s 内轮不到
// → "no matching history entry within 720s"。prompt 本身 200 入队且 base 参数正确,
// 非工作流/子图/节点问题(契约文档三根因均排除:无 node_errors,同环境队首四型通过)。
// 对策:①提交前 wait-idle 错峰(队列有活则等,把同窗挤入拉成准串行,削队尾深度);
// ②进程级总窗 860s(外层 bash timeoutMs=900s,留 ~40s 给浏览器启动与收尾)。
// 0921 修复(场景轮):PRE_IDLE_MAX_MS 180s→60s。真因:九型并行驱动几乎同时就绪,
// 先到两只见 pending==0 提交(engine_e2e.log 12:27:40 number=16/17),其余在 gate
// 等到 180s 上限同拍「submit anyway」(12:30:40-41 number=18..23 六只同窗挤入),
// 场景(number=19)排第 4 位:前方 3 单串行 ≈612s + 自身 232s,而 180s gate 燃烧后
// 只剩 666s 窗——prompt 本身 200 入队、12:41:55 执行成功、出图 2800×1576 达标
// (16:9±6%、4.4MP±12%),仅比 deadline 12:41:45.8 晚 ~10s。cap 降到 60s:同场景
// t0 提前 120s → 完成 12:40:36 < deadline 12:41:50(余量 ~74s);gate 入口的
// pending>0 短持仍保留首拍错峰,队尾窗耗少烧 120s。
const PROC_DEADLINE_MS = 860_000; // 进程级总限(必须 < 外层 timeoutMs 900s)
const PRE_IDLE_MAX_MS = 60_000; // 提交前等 /queue 清空上限(到时无论空否都提交)
const PRE_IDLE_POLL_MS = 5_000;
const POLL_MS = 3_000; // /history 轮询间隔
const VANISH_GRACE_MS = 30_000; // 自单离队且 /history 无条目的宽限(超此才判真丢:被取消/中断;0921 表情差分轮)
const STALE_LOCK_MS = 300_000; // 锁文件过期阈值
// 0921 修复(概念气氛图轮):提交错峰加进程内一次性随机抖动,快路(pending==0)同沾。
// 真因(本轮 engine_e2e.log 实锤):并行驱动同拍就绪→同拍开始等队列,两条提交路都是
// 「全体同拍」——快路在队列空时同拍见 0 同拍齐发(12:27:40 number=16/17),上限路
// (当时 180s)同拍到点集体 submit anyway(12:30:40-41 number=18..23 六连),串行引擎
// 队尾的概念气氛图(number=20,前方 264.53+278.10+79.71+232.02s)在 666s 窗口到期后
// ~9s 才轮到执行。cap 180→60s(场景轮)只挪 t0,挤入本身未破。对策:每驱动一次性
// 随机抽 0..150s 抖动,快路与上限路都至少等满抖动再提交,把同拍齐发摊成 150s 窗内
// 的珍珠链;单驱动独跑时最多白等 150s(进程窗 860s 级,代价可承受)。
const STAGGER_JITTER_MAX_MS = 150_000; // 提交错峰随机抖动上限(进程内一次性抽取)
// 0921 高清人脸轮第2修(真根因,锁根治): 抖动只把齐发摊慢,不削队尾深度——六驱仍在
// ~210s 内全部入队,高清人脸重跑若抖动抽大(队位 5-6)等待 (k-1)×~230s 依旧超窗,过
// 不过全赌随机顺位。真珍珠链必须「提交时队位≤2」:跨驱动提交准入锁,空闲(含抖动
// 满足)或上限到期都必须先抢到 SUBMIT_LOCK 才进提交临界区;抢不到回圈重等,同伴提交
// 后 pending≥1 自然让位,下个空隙(前单完成、worker 即取、pending 归 0)再抢。如此
// 每单提交时前方至多 1 running+0 pending,队尾等待 ≤1 单时长。锁在提交确证后释放
// (持锁≤30s);持锁者死亡由 stale 抢占兜底。本轮实证:高清人脸 number=21 于 12:30:41
// 六单同窗挤入中被排到队位 6,前方 264.53+278.10+79.71+232.02+~250s≈924s 才轮到,而
// deadline(procStart+855s)=12:41:48 早已过 → "no matching history entry within 667s"
// (自单 667s 内一直活在队列,errors 无 "left engine queue")。该单 200 入队、[MY出图]
// 摘要完整、全程无 node_errors/invalid/traceback——工作流/生成器/节点三层全无罪。
const SUBMIT_LOCK = "/tmp/daojie_e2e_submit.lock"; // 提交准入锁(跨驱动进程互斥)
const SUBMIT_LOCK_STALE_MS = 60_000; // 正常持锁≤30s(提交+确证);超时视为持锁者已死可抢(误抢仅失互斥,不破坏正确性)

// 分辨率达标表(0921 任务书): 比例型=宽高比±6% 且 百万像素±12%;特殊列精确。
const SPECS = {
  人物: { kind: "ratio", w: 3, h: 4, mp: 4.2 },
  场景: { kind: "ratio", w: 16, h: 9, mp: 4.2 },
  道具: { kind: "exact", width: 1024, height: 1024 },
  美宣: { kind: "ratio", w: 21, h: 9, mp: 4.2 },
  三视图: { kind: "exact", width: 3072, height: 1024 },
  高清人脸: { kind: "exact", width: 1024, height: 1024 },
  分镜剧情图: { kind: "ratio", w: 16, h: 9, mp: 4.2 },
  表情差分: { kind: "ratio", w: 1, h: 1, mp: 4.2 },
  概念气氛图: { kind: "ratio", w: 16, h: 9, mp: 4.2 },
};

// 按型主体句(0921 修复): 此前驱动只设 [80] 型值不设 [50] 主体句,九型全用图内
// 默认人物句,场景/概念气氛被人物污染;现逐型注入 [50],句子全角标点逐字照录。
const SUBJECTS = {
  人物: "一位筑基后期的年轻女修，青玉色道袍束月白腰带，长发半束只簪一支素银簪，眉目沉静中带一点锋芒；她立于山门石阶最上一级，双手拢于袖中，目视前方，神色沉静；背景淡墨远山，大面积留白。",
  美宣: "一位筑基后期的年轻女修，青玉色道袍束月白腰带，长发半束只簪一支素银簪，眉目沉静中带一点锋芒；她立于山门石阶最上一级，双手拢于袖中，目视前方；晨光自左侧斜照，衣袂被山风微微掀起，背景大面积留白。",
  三视图: "一位筑基后期的年轻女修，青玉色道袍束月白腰带，长发半束只簪一支素银簪；正面、侧面、背面三视角全身像，双袖自然垂落。",
  高清人脸: "一位筑基后期的年轻女修，青玉色道袍束月白腰带，长发半束只簪一支素银簪，眉目沉静中带一点锋芒；面部特写，眉眼发丝分明。",
  分镜剧情图: "一位筑基后期的年轻女修，青玉色道袍束月白腰带，长发半束只簪一支素银簪，双手拢于袖中，立于山门石阶之上，云海在脚下翻涌；电影感构图。",
  表情差分: "一位筑基后期的年轻女修，青玉色道袍束月白腰带，长发半束只簪一支素银簪；沉静、微怒、含笑三种神情，眉眼口鼻逐项分明。",
  场景: "层叠远山以细墨线勾勒轮廓，淡墨晕染云雾，墨色浓淡干湿层次分明；山石以赭石与石绿低饱和点染，近景一株古松横斜，旧金点缀枝干转折；溪涧以留白作水面，云气大面积流转；温润米白的浅净平涂底，均匀柔光，无投影；仙道古韵的水墨国风画作。",
  概念气氛图: "山门古刹隐于晨雾，远山淡墨层叠，金色晨光斜照云海，灵气光尘缓缓流转；大面积留白，静谧空寂的仙家气象；温润米白的浅净平涂底，均匀柔光，无投影。",
  道具: "一柄三尺青锋古剑，剑身寒光如水，鎏金剑格镂刻云雷灵纹，剑柄缠月白丝绦，剑穗垂青玉坠；青铜与古玉材质质感分明；温润米白的浅净平涂底，均匀柔光，无投影。",
};

const log = (msg) =>
  process.stderr.write(`[daojie-e2e ${new Date().toISOString()}] ${msg}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseType() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--type");
  const type = i >= 0 ? argv[i + 1] : undefined;
  if (!type || !(type in SPECS)) {
    process.stderr.write(
      `usage: node daojie_t2i_e2e_driver_0921.mjs --type <${Object.keys(SPECS).join("|")}>\n`,
    );
    process.exit(2);
  }
  return type;
}

// ---------- 1) 幂等保活引擎 ----------
async function probeEngine() {
  try {
    const r = await fetch(`${ENGINE_URL}/system_stats`, {
      signal: AbortSignal.timeout(3_000),
    });
    return r.status === 200;
  } catch {
    return false;
  }
}

// flock 在 macOS 不可用(实测 which flock 无),以 O_EXCL 原子建锁等价防并发双启;
// 锁内容写启动者 pid 与时刻,超过 STALE_LOCK_MS 视为残锁可抢。
function acquireLock() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = openSync(ENGINE_LOCK, "wx");
      appendFileSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
      closeSync(fd);
      return true;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      try {
        const st = spawnSync("stat", ["-f", "%m", ENGINE_LOCK], { encoding: "utf8" });
        const mtime = Number(st.stdout?.trim());
        if (Number.isFinite(mtime) && Date.now() / 1000 - mtime > STALE_LOCK_MS / 1000) {
          log(`engine lock stale (mtime ${mtime}), stealing`);
          unlinkSync(ENGINE_LOCK);
          continue;
        }
      } catch { /* stat 失败按新鲜处理 */ }
      return false;
    }
  }
  return false;
}

// 提交准入锁(0921 高清人脸轮第2修):同 macOS 无 flock,与 ENGINE_LOCK 同法 O_EXCL
// 原子建锁。tryAcquire 一次性尝试(不含重试自旋,自旋在错峰循环里做);stale 可抢。
function tryAcquireSubmitLock() {
  try {
    const fd = openSync(SUBMIT_LOCK, "wx");
    appendFileSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
    closeSync(fd);
    return true;
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    try {
      const st = spawnSync("stat", ["-f", "%m", SUBMIT_LOCK], { encoding: "utf8" });
      const mtime = Number(st.stdout?.trim());
      if (Number.isFinite(mtime) && Date.now() / 1000 - mtime > SUBMIT_LOCK_STALE_MS / 1000) {
        log(`submit lock stale (mtime ${mtime}), stealing`);
        unlinkSync(SUBMIT_LOCK);
        return tryAcquireSubmitLock(); // 抢占后重试一次;竞态再失手则如实返回 false
      }
    } catch { /* stat 失败按新鲜处理 */ }
    return false;
  }
}
const releaseSubmitLock = () => { try { unlinkSync(SUBMIT_LOCK); } catch {} };

function launchEngineDetached() {
  const fd = openSync(ENGINE_LOG, "a");
  appendFileSync(fd, `\n[driver ${new Date().toISOString()}] 冷拉起引擎 pid 即将 spawn\n`);
  const child = spawn(ENGINE_PY, [ENGINE_MAIN, ...ENGINE_ARGS], {
    detached: true, // setsid,等价 nohup 脱离本驱动生命周期
    stdio: ["ignore", fd, fd],
    env: process.env,
  });
  child.unref();
  closeSync(fd);
  log(`engine spawned detached pid=${child.pid} log=${ENGINE_LOG}`);
  return child.pid;
}

async function ensureEngine() {
  if (await probeEngine()) {
    log("engine already up (200), keep-alive no-op");
    return;
  }
  const got = acquireLock();
  if (!got) {
    log("another launcher holds the lock; waiting for its 200");
  } else {
    appendFileSync(
      ENGINE_LOG,
      `[driver ${new Date().toISOString()}] 探活不通,本驱动拉起引擎\n`,
    );
    launchEngineDetached();
  }
  const t0 = Date.now();
  while (Date.now() - t0 < ENGINE_WAIT_MS) {
    if (await probeEngine()) {
      log(`engine 200 after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      if (got) { try { unlinkSync(ENGINE_LOCK); } catch {} }
      return;
    }
    await sleep(3_000);
  }
  throw new Error(
    `engine not 200 within ${ENGINE_WAIT_MS / 1000}s (launcher=${got ? "self" : "peer"}); log tail see ${ENGINE_LOG}`,
  );
}

// ---------- 2) 定位 playwright 与浏览器通道 ----------
function findPlaywright() {
  const candidates = [
    // 优先本仓 node_modules(仓库根 + apps)
    join(REPO, "node_modules", "playwright"),
    join(REPO, "node_modules", "playwright-core"),
    join(REPO, "apps", "node_modules", "playwright"),
    join(REPO, "apps", "node_modules", "playwright-core"),
    // 本仓未装时的兜底: 全局 npm(@playwright/mcp 自带,实测存在)
    "/opt/homebrew/lib/node_modules/@playwright/mcp/node_modules/playwright",
    "/opt/homebrew/lib/node_modules/@playwright/mcp/node_modules/playwright-core",
    "/opt/homebrew/lib/node_modules/playwright",
    "/opt/homebrew/lib/node_modules/playwright-core",
  ];
  for (const dir of candidates) {
    if (!existsSync(join(dir, "package.json"))) continue;
    const name = dir.endsWith("playwright-core") ? "playwright-core" : "playwright";
    try {
      const req = createRequire(join(dir, "package.json"));
      const mod = req(name);
      log(`playwright: ${dir} (${mod.chromium ? "chromium ok" : "NO chromium"})`);
      if (mod?.chromium) return { mod, dir };
    } catch (e) {
      log(`playwright candidate failed ${dir}: ${e.message}`);
    }
  }
  throw new Error("no usable playwright/playwright-core found (repo or global)");
}

function cacheChromiumExecutables() {
  // ~/Library/Caches/ms-playwright 下 chromium-<rev>/chrome-mac*/…/MacOS/<binary>,按 rev 降序
  const root = join(homedir(), "Library/Caches/ms-playwright");
  const out = [];
  if (!existsSync(root)) return out;
  const revs = readdirSync(root)
    .filter((d) => /^chromium-\d+$/.test(d))
    .map((d) => Number(d.slice("chromium-".length)))
    .sort((a, b) => b - a);
  for (const rev of revs) {
    const d = join(root, `chromium-${rev}`);
    for (const sub of readdirSync(d)) {
      if (!sub.startsWith("chrome-mac")) continue;
      // chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing
      const appDir = join(d, sub, "Google Chrome for Testing.app");
      const exe = join(appDir, "Contents/MacOS/Google Chrome for Testing");
      if (existsSync(exe)) out.push({ rev, exe });
    }
  }
  return out;
}

function repoBundledChromiums() {
  // 仓库自带浏览器(如 repo 内 .cache/ms-playwright 或 PLAYWRIGHT_BROWSERS_PATH 指向仓内)
  const roots = [join(REPO, "node_modules", ".cache", "ms-playwright")];
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) roots.push(process.env.PLAYWRIGHT_BROWSERS_PATH);
  const out = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const d of readdirSync(root)) {
      if (!d.startsWith("chromium-")) continue;
      const base = join(root, d);
      for (const sub of existsSync(base) ? readdirSync(base) : []) {
        if (!sub.startsWith("chrome-mac")) continue;
        const exe = join(base, sub, "Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
        if (existsSync(exe)) out.push({ rev: d, exe });
      }
    }
  }
  return out;
}

async function launchBrowser(pw) {
  const channels = [];
  for (const c of repoBundledChromiums())
    channels.push({ desc: `repo-bundled chromium ${c.rev}`, opts: { executablePath: c.exe } });
  for (const c of cacheChromiumExecutables())
    channels.push({ desc: `ms-playwright cache chromium-${c.rev}`, opts: { executablePath: c.exe } });
  channels.push({ desc: "system Chrome channel=chrome", opts: { channel: "chrome" } });
  const errors = [];
  for (const ch of channels) {
    try {
      const browser = await pw.mod.chromium.launch({ headless: true, ...ch.opts });
      log(`browser channel ok: ${ch.desc}`);
      return { browser, desc: ch.desc };
    } catch (e) {
      errors.push(`${ch.desc}: ${e.message.split("\n")[0]}`);
      log(`browser channel failed: ${ch.desc}: ${e.message.split("\n")[0]}`);
    }
  }
  throw new Error(`all browser channels failed: ${errors.join(" | ")}`);
}

// ---------- 3-6) 真前端: 打开→载图→置型→排队 ----------
const FETCH_HOOK = `
(() => {
  window.__e2e_promptPosts = [];
  const orig = window.fetch;
  window.fetch = async (...args) => {
    const res = await orig(...args);
    try {
      const url = String(args[0]?.url ?? args[0] ?? "");
      if (url.includes("/prompt")) {
        const clone = res.clone();
        let body = "";
        try { body = await clone.text(); } catch {}
        window.__e2e_promptPosts.push({ url, status: res.status, body: body.slice(0, 65536) });
      }
    } catch {}
    return res;
  };
})();`;

async function historySnapshot() {
  const r = await fetch(`${ENGINE_URL}/history?max_items=10`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!r.ok) throw new Error(`/history ${r.status}`);
  return (await r.json()) ?? {};
}

// 0921 修复(三视图轮): 判负退出前清理自己仍挂在引擎队列的单,防僵尸单堆积。
// 真因(本引擎日志 engine_e2e.log 12:30:40-41 实证): 并行逐型实弹时多个驱动同窗齐发
// (错峰 180s 上限同时到期→全体 submit anyway),引擎串行执行每单 80-313s,队尾型
// (三视图 number=22)在 666s 等待窗内轮不到→判负退出;旧驱动一走了之,该单继续占
// 队列 ~200s,下一轮复验的新单排在其后又超时——僵尸滚雪球。判负即清,复验从干净
// 队列起步(至多等一个 running 单)。
// 实测注意: 本引擎清队列是 POST /queue {"delete":[pid]}(DELETE /queue 返回 405);
// /interrupt 只在自单恰为 running 时调用,避免误杀并行同伴正在执行的单。
async function cleanupQueueEntry(pid) {
  if (!pid) return;
  try {
    const q = await (await fetch(`${ENGINE_URL}/queue`, {
      signal: AbortSignal.timeout(5_000),
    })).json();
    const running = (q?.queue_running ?? []).some((it) => Array.isArray(it) && it[1] === pid);
    const pending = (q?.queue_pending ?? []).some((it) => Array.isArray(it) && it[1] === pid);
    if (!running && !pending) return;
    if (pending) {
      const r = await fetch(`${ENGINE_URL}/queue`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ delete: [pid] }),
        signal: AbortSignal.timeout(5_000),
      });
      log(`cleanup: POST /queue delete ${pid} -> ${r.status}`);
    }
    if (running) {
      const r2 = await fetch(`${ENGINE_URL}/interrupt`, {
        method: "POST",
        signal: AbortSignal.timeout(5_000),
      });
      log(`cleanup: POST /interrupt (own prompt was running) -> ${r2.status}`);
    }
  } catch (e) {
    log(`cleanup failed (non-fatal): ${e?.message ?? e}`);
  }
}

async function main() {
  const type = parseType();
  const procStart = Date.now(); // 进程级 deadline 起点(见 PROC_DEADLINE_MS 注释)
  // 提交错峰抖动(0921 概念气氛图轮): 进程内一次性抽取,见常量区注释
  const staggerJitter = Math.floor(Math.random() * STAGGER_JITTER_MAX_MS);
  log(`submit stagger jitter=${(staggerJitter / 1000).toFixed(1)}s (fast path & cap)`);
  const errors = [];
  // promptId 提升到 try 外(0921 三视图轮): FATAL catch 里也要能清理自己的队列单
  let promptId = "";
  const t = { engine: null, browser: null, page: null };

  try {
    await ensureEngine();
    t.engine = "up";

    const pw = findPlaywright();
    const { browser, desc } = await launchBrowser(pw);
    t.browser = browser;
    const ctx = await browser.newContext();
    await ctx.addInitScript(FETCH_HOOK); // 观察真前端自身的 /prompt 提交(非自拼 POST)
    const page = await ctx.newPage();
    t.page = page;
    const consoleErrs = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrs.push(m.text().slice(0, 500));
    });
    page.on("pageerror", (e) => consoleErrs.push(`pageerror: ${String(e).slice(0, 500)}`));

    await page.goto(ENGINE_URL, { timeout: FRONT_READY_MS, waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => !!window.app && !!window.app.graph && window.app.graph.nodes?.length > 0,
      null,
      { timeout: FRONT_READY_MS, polling: 500 },
    );
    log("frontend ready (window.app + graph)");

    const wf = JSON.parse(readFileSync(WORKFLOW_JSON, "utf8"));
    await page.evaluate((data) => window.app.loadGraphData(data), wf);
    await sleep(2_000);
    const graphInfo = await page.evaluate(() => ({
      nodes: window.app.graph.nodes.length,
      ids: window.app.graph.nodes.map((n) => String(n.id)),
    }));
    log(`workflow loaded: ${graphInfo.nodes} nodes`);
    if (!graphInfo.ids.includes(BASE_NODE_ID))
      throw new Error(`node [${BASE_NODE_ID}] not in loaded graph`);

    // 置型: [80] MyDaojieBase 的 base combo(该节点唯一九选一 widget)
    const setRes = await page.evaluate((args) => {
      const n = window.app.graph.nodes.find((x) => String(x.id) === args.nodeId);
      if (!n) return { ok: false, err: "node not found" };
      const w = (n.widgets || []).find((x) => x.name === "base");
      if (!w) return { ok: false, err: `base widget not found (widgets=${(n.widgets || []).map((x) => x.name).join(",")})` };
      const opts = w.options?.values ?? [];
      if (opts.length && !opts.includes(args.type))
        return { ok: false, err: `type "${args.type}" not in combo options [${opts.join(",")}]` };
      w.value = args.type; // combo 赋值后即为当前选中项(options 静态自 INPUT_TYPES)
      try { w.callback?.(args.type); } catch {}
      try { n.setDirtyCanvas?.(true, true); } catch {}
      return { ok: w.value === args.type, value: w.value, options: opts };
    }, { nodeId: BASE_NODE_ID, type });
    if (!setRes.ok) throw new Error(`set base failed: ${setRes.err}`);
    log(`base widget set -> ${setRes.value} (options ${setRes.options.length})`);

    // 置主体句: [50] PrimitiveStringMultiline 的 value 文本(与置型同法;0921 修复)
    const subjRes = await page.evaluate((args) => {
      const n = window.app.graph.nodes.find((x) => String(x.id) === args.nodeId);
      if (!n) return { ok: false, err: "node not found" };
      const w = (n.widgets || []).find((x) => x.name === "value");
      if (!w) return { ok: false, err: `value widget not found (widgets=${(n.widgets || []).map((x) => x.name).join(",")})` };
      w.value = args.sentence;
      try { w.callback?.(args.sentence); } catch {}
      try { n.setDirtyCanvas?.(true, true); } catch {}
      return { ok: w.value === args.sentence, value: w.value };
    }, { nodeId: SUBJECT_NODE_ID, sentence: SUBJECTS[type] });
    if (!subjRes.ok) throw new Error(`set subject failed: ${subjRes.err}`);
    log(`subject widget set -> ${subjRes.value}`);

    // ── 提交前错峰(0921 修复;高清人脸轮补强)──
    // 并行逐型实弹时,同伴驱动的 prompt 占着队列,队尾深度直接吃提交后的等待窗;
    // 把「8 型同窗挤入」拉成「前单完成→下一单提交」的准串行。
    // 补强(0921 高清人脸轮): 等待条件从「running==0 且 pending==0」放宽为
    // 「pending==0 即提交」——若等「完全空闲」,多个并发驱动会在队列清空的同一
    // 轮询拍上齐发提交,又变同窗挤入(与错峰初衷相反);只看 pending 则各自紧跟
    // 当前 running 单入队,形成一单一驱动的珍珠链,消解齐发竞争。
    // 探测失败(临时网络抖动)不强等,按可提交处理;到 PRE_IDLE_MAX_MS 上限也照提交。
    {
      const idleT0 = Date.now();
      for (;;) {
        let q = null;
        try {
          q = await (await fetch(`${ENGINE_URL}/queue`, { signal: AbortSignal.timeout(5_000) })).json();
        } catch { /* 引擎探活已过,此处失败不阻断 */ }
        const running = q?.queue_running?.length ?? 0;
        const pending = q?.queue_pending?.length ?? 0;
        const heldMs = Date.now() - idleT0;
        // 0921 概念气氛图轮: 快路(pending==0)也要等满抖动——并行驱动同拍见 0 同拍
        // 齐发是 12:27:40 number=16/17 的成因;上限路加同一抖动,同拍到点的同伴摊开。
        // 0921 高清人脸轮第2修: 抖动摊开的仍是慢动作齐发(六驱照样全入队,队尾深度
        // 不减,过不过赌随机顺位)。三条提交路(探测失败/快路/上限路)统一过提交准
        // 入锁:同刻只有一个驱动进提交临界区,抢不到的回圈重等——同伴入队后
        // pending≥1 自然让位,下个空隙(前单完成、worker 即取、pending 归 0)再抢,
        // 每单提交时队位≤2(真珍珠链)。锁在提交确证后释放(hookPost 段末)。
        const fastReady = q !== null && pending === 0 && heldMs >= staggerJitter;
        const capReady = heldMs >= PRE_IDLE_MAX_MS + staggerJitter;
        if (!q || fastReady || capReady) {
          if (tryAcquireSubmitLock()) break; // 持锁提交;释放见 hookPost 段末
          if (capReady)
            log(`contending submit gate (held=${(heldMs / 1000).toFixed(1)}s, running=${running} pending=${pending})`);
          else
            log(`submit gate held by peer (running=${running} pending=${pending}), holding submission`);
          await sleep(PRE_IDLE_POLL_MS);
          continue;
        }
        log(`holding submission (held=${(heldMs / 1000).toFixed(1)}s, jitter=${(staggerJitter / 1000).toFixed(1)}s, running=${running} pending=${pending})`);
        await sleep(PRE_IDLE_POLL_MS);
      }
    }

    const before = await historySnapshot();
    const beforeIds = new Set(Object.keys(before));
    const t0 = Date.now();

    // 排队: 与「生成」按钮同一条代码路径(legacy Queue Prompt 按钮即 queuePrompt(0,…))
    const q = await page.evaluate(() =>
      window.app.queuePrompt(0).then((r) => ({ ret: r })).catch((e) => ({ err: String(e?.message ?? e) })),
    );
    log(`app.queuePrompt(0) returned ${JSON.stringify(q)} at +0s`);
    if (q.err) errors.push(`queuePrompt threw: ${q.err}`);

    // 真前端自身的 POST /prompt 结果(fetch 钩子): 200→prompt_id;4xx→错误原文
    let hookPost = null;
    for (let i = 0; i < 10 && !hookPost; i++) {
      await sleep(1_500);
      hookPost = await page.evaluate(() => window.__e2e_promptPosts?.slice(-1)[0] ?? null);
    }
    if (hookPost) {
      log(`hook /prompt status=${hookPost.status} body[0..200]=${hookPost.body.slice(0, 200)}`);
      try {
        const j = JSON.parse(hookPost.body);
        if (j.prompt_id) promptId = j.prompt_id;
        if (hookPost.status !== 200) {
          errors.push(`POST /prompt ${hookPost.status}: ${hookPost.body.slice(0, 4000)}`);
          if (j.node_errors) errors.push(`node_errors: ${JSON.stringify(j.node_errors).slice(0, 4000)}`);
        }
      } catch {
        if (hookPost.status !== 200) errors.push(`POST /prompt ${hookPost.status}: ${hookPost.body.slice(0, 4000)}`);
      }
    }
    if (hookPost?.status === 200 && !promptId)
      errors.push("POST /prompt 200 but no prompt_id in body");
    releaseSubmitLock(); // 提交确证完成(成败皆然)即放锁,让下一驱动进临界区(0921 高清人脸轮第2修)
    // 提交确证失败才快速失败;有 prompt_id 则即便 queuePrompt 抛错也继续等结果
    const submissionFailed =
      (hookPost && hookPost.status !== 200) ||
      (!hookPost && q.err) ||
      (hookPost?.status === 200 && !promptId);
    if (submissionFailed) {
      // 提交已被拒: 无需等 720s,快速失败带回原文
      await browser.close();
      emit(type, { ok: false, image: "", width: 0, height: 0, durationSec: (Date.now() - t0) / 1000, promptId, applied: "", errors: dedupe(errors).concat(tailConsole(consoleErrs)) }, `channel=${desc}`);
      return;
    }

    // 轮询 /history?max_items=10 找排队之后新出现的 prompt_id,直到完成或 deadline 超时。
    // 窗=进程级 deadline(860s 减浏览器启动等前置耗时;提交后保底约 640s),留 5s 收尾。
    const runDeadline = Math.min(t0 + 835_000, procStart + PROC_DEADLINE_MS - 5_000);
    let entry = null, matchedById = false;
    let lastQueuedMs = Date.now(); // 最近一次确认自单仍在引擎队列(running/pending)
    let lastQueued = null; // 最近一次 /queue 活性探测结果(true/false/null=探测失败)
    while (Date.now() < runDeadline) {
      await sleep(POLL_MS);
      const h = await historySnapshot();
      if (promptId && h[promptId]) { entry = h[promptId]; matchedById = true; break; }
      if (!promptId) {
        for (const [pid, e] of Object.entries(h)) {
          if (beforeIds.has(pid)) continue;
          // 归属甄别: 该单 prompt 的 [80] inputs.base 应等于本型号(共享引擎防串单)
          const base = e?.prompt?.[0]?.[BASE_NODE_ID]?.inputs?.base;
          if (base === type) { entry = e; promptId = pid; matchedById = true; break; }
        }
        if (entry) break;
      }
      // ── 队列活性(0921 表情差分轮):实测自单在 720s 超时判定之后仍在 /queue_running
      // 正常执行——「/history 无条目」≠任务死。自单仍在 /queue(running/pending)就继续
      // 等,由 deadline 管总窗;离队且 /history 无条目超宽限才判真丢(被取消/引擎重启)。
      // /queue 探测失败(unknown)不判死,留 deadline 裁决。/queue 条目=[number,prompt_id,…]。
      if (promptId) {
        let queued = null;
        try {
          const q = await (await fetch(`${ENGINE_URL}/queue`, { signal: AbortSignal.timeout(5_000) })).json();
          queued = [...(q?.queue_running ?? []), ...(q?.queue_pending ?? [])]
            .some((it) => Array.isArray(it) && it[1] === promptId);
        } catch { /* unknown: 引擎探活已过,瞬时失败不判死 */ }
        lastQueued = queued;
        if (queued === true) lastQueuedMs = Date.now();
        else if (queued === false && Date.now() - lastQueuedMs > VANISH_GRACE_MS) {
          errors.push(`prompt left engine queue with no history entry for ${Math.round((Date.now() - lastQueuedMs) / 1000)}s (cancelled/interrupted?)`);
          break;
        }
      }
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      if (Number(elapsed) % 30 < POLL_MS / 1000) log(`waiting… +${elapsed}s (pid=${promptId || "?"}, queued=${lastQueued})`);
    }
    await browser.close();
    t.browser = null;

    const durationSec = (Date.now() - t0) / 1000;
    if (!entry) {
      // 判负(超时/真丢)先清自己仍挂着的队列单,防僵尸堆积毒化下一轮复验(0921 三视图轮)
      await cleanupQueueEntry(promptId);
      emit(type, {
        ok: false, image: "", width: 0, height: 0, durationSec, promptId,
        applied: "",
        errors: dedupe(errors).concat([
          `no matching history entry within ${Math.round((Date.now() - t0) / 1000)}s of submission, deadline hit (matchedById=${matchedById}, promptId=${promptId || "none"})`,
        ]).concat(tailConsole(consoleErrs)),
      }, `channel=${desc}`);
      return;
    }

    const statusStr = entry.status?.status_str ?? "";
    if (statusStr !== "success") {
      emit(type, {
        ok: false, image: "", width: 0, height: 0, durationSec, promptId,
        applied: appliedOf(entry),
        errors: dedupe(errors).concat([
          `status_str=${statusStr}`,
          `status=${JSON.stringify(entry.status).slice(0, 4000)}`,
        ]).concat(tailConsole(consoleErrs)),
      }, `channel=${desc}`);
      return;
    }

    // 产出收集: outputs 里 SaveImage 的 images[].filename(type=output) + [86] 披露 text
    const images = [];
    for (const out of Object.values(entry.outputs ?? {})) {
      for (const img of out?.images ?? []) {
        if (img?.type === "output" && img?.filename) images.push(img.filename);
      }
    }
    const applied = appliedOf(entry);
    if (!images.length) {
      emit(type, {
        ok: false, image: "", width: 0, height: 0, durationSec, promptId, applied,
        errors: dedupe(errors).concat(["success but no SaveImage output"]).concat(tailConsole(consoleErrs)),
      }, `channel=${desc}`);
      return;
    }

    // sips 量测每个出图文件原生分辨率
    const measured = [];
    for (const name of images) {
      const p = join(OUTPUT_DIR, name);
      const r = spawnSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", p], { encoding: "utf8" });
      if (r.status !== 0) { measured.push({ name, err: (r.stderr || "sips failed").slice(0, 300) }); continue; }
      const w = Number(/pixelWidth:\s*(\d+)/.exec(r.stdout)?.[1] ?? 0);
      const h = Number(/pixelHeight:\s*(\d+)/.exec(r.stdout)?.[1] ?? 0);
      measured.push({ name, width: w, height: h });
    }
    for (const m of measured) log(`sips ${m.name}: ${m.width ?? "?"}x${m.height ?? "?"}${m.err ? " ERR=" + m.err : ""}`);

    // 达标判定(比例±6% / MP±12% / 特殊列精确),所有出图必须全达标
    const spec = SPECS[type];
    const verdicts = measured.map((m) => judge(m, spec));
    const main = measured.find((m) => !m.err) ?? measured[0];
    const mainV = verdicts[measured.indexOf(main)];
    const allOk = verdicts.every((v) => v.pass) && verdicts.length === measured.length;
    emit(type, {
      ok: allOk,
      image: main?.name ?? "",
      width: main?.width ?? 0,
      height: main?.height ?? 0,
      durationSec, promptId, applied,
      errors: dedupe(errors.concat(verdicts.flatMap((v) => v.issues))).concat(allOk ? [] : tailConsole(consoleErrs)),
    }, `channel=${desc}`);
  } catch (e) {
    log(`FATAL ${e?.stack ?? e}`);
    releaseSubmitLock(); // 持锁途中 FATAL 也放锁,防 60s stale 窗口阻塞同伴(0921 高清人脸轮第2修;未持锁时为 no-op)
    // 提交后因异常中断(如轮询中 /history 网络错)也清自己的队列单,防僵尸堆积;
    // 提交前 FATAL 时 promptId 为空串,清理为安全 no-op(0921 三视图轮)
    try { await cleanupQueueEntry(promptId); } catch {}
    try { t.browser?.close(); } catch {}
    emit(type, {
      ok: false, image: "", width: 0, height: 0, durationSec: 0, promptId: "", applied: "",
      errors: [String(e?.message ?? e)],
    });
  }
}

function appliedOf(entry) {
  const t = entry?.outputs?.[APPLIED_NODE_ID]?.text;
  return Array.isArray(t) ? t.join(" ") : (t ?? "");
}

function judge(m, spec) {
  if (m.err) return { pass: false, issues: [`sips ${m.name}: ${m.err}`] };
  const issues = [];
  if (spec.kind === "exact") {
    if (m.width !== spec.width || m.height !== spec.height)
      issues.push(`${m.name} ${m.width}x${m.height} != exact ${spec.width}x${spec.height}`);
  } else {
    const ratio = m.width / m.height;
    const target = spec.w / spec.h;
    const mp = (m.width * m.height) / 1e6;
    if (Math.abs(ratio / target - 1) > 0.06)
      issues.push(`${m.name} ratio ${ratio.toFixed(4)} vs ${spec.w}:${spec.h}(${target.toFixed(4)}) off >6%`);
    if (Math.abs(mp / spec.mp - 1) > 0.12)
      issues.push(`${m.name} ${mp.toFixed(3)}MP vs ${spec.mp}MP off >12%`);
  }
  return { pass: issues.length === 0, issues };
}

const dedupe = (a) => [...new Set(a.filter(Boolean))];
const tailConsole = (errs) =>
  errs.length ? [`console errors (tail): ${errs.slice(-5).join(" || ").slice(0, 1500)}`] : [];

function emit(type, r, extra = "") {
  const out = {
    type, ok: !!r.ok, image: r.image ?? "", width: r.width ?? 0, height: r.height ?? 0,
    durationSec: Math.round((r.durationSec ?? 0) * 10) / 10,
    promptId: r.promptId ?? "", applied: r.applied ?? "", errors: r.errors ?? [],
  };
  if (extra) log(`result extra: ${extra}`);
  process.stdout.write(JSON.stringify(out) + "\n");
  process.exit(out.ok ? 0 : 1);
}

await main();
