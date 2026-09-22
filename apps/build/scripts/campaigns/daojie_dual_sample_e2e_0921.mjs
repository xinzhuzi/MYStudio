#!/opt/homebrew/bin/node
// 道劫 t2i「二采版」E2E 驱动(0921;Trellis 09-21-daojie-k2-dual-sample I4/I5)
// 用法: node daojie_dual_sample_e2e_0921.mjs --type <九型之一> [--dry]
//   --dry 干跑模式: 载图→app.graphToPrompt() 取 .output 断言二采组(常态/整组旁路/
//       还原三态)后退出,不排队不出图(--type 可选,给了则先置型/置主体句)。
// 流程(实弹): 幂等保活引擎(17000) → playwright 真前端(打开/载图/置型/
//   app.queuePrompt(0)) → 轮询 /history 至完成 → sips 量测全部 output 原生分辨率
//   → 按型达标判定 + 双产物判定([4] 一采图与二采保存图都必须在案)。
// stdout 仅一行最终 JSON;过程日志全走 stderr;ok→exit 0,否则 1。
// emit JSON 在 0921 t2i 驱动基础上增加 images:[{node,filename,width,height}] 数组。
// 铁律: 生成必须走 ComfyUI 真前端自身的排队路径(app.queuePrompt),禁止自拼 prompt POST。
// 改造自 daojie_t2i_e2e_driver_0921.mjs(错峰/准入锁/队列活性等修复注释全部承袭)。

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
// 0921 二采版: 母版 v3 增量五节点(159 预览/160 回炉/161 KSampler②/162 解码②/
// 163 保存②),生成器 daojie_dual_sample_build_0921.py 产物,id 由探测 max+1 分配。
const WORKFLOW_JSON =
  "/Users/zhengbingjin/Project/Github/MYStudio/apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-文生图-道劫-二采版.json";
const OUTPUT_DIR = join(ENGINE_HOME, "output");
const BASE_NODE_ID = "80"; // MyDaojieBase 九选一 widget: base
const APPLIED_NODE_ID = "86"; // easy showAnything 按型线路生效披露
const SUBJECT_NODE_ID = "50"; // PrimitiveStringMultiline widget: value(按型主体句)
const ENGINE_WAIT_MS = 180_000; // 冷拉起等 200 上限
const FRONT_READY_MS = 60_000; // window.app 就绪上限
// 0921 二采版: 双采 ≈1.7-2× 单采时长(单采人物档实测 416.9s → 双采约 700-840s,
// 含回炉 encode/decode);进程级总窗 860s→1500s(外层调用须给 ≥1540s timeout)。
const PROC_DEADLINE_MS = 2_100_000; // 进程级总限(0922 v2 实弹实证:1.5×二采全链
  // 提交后约 1344s 采样+~90s 大图解码,原 1500s 帽在解码段掐死,提至 2100s)
const POST_SUBMIT_BUDGET_MS = 2_000_000; // 提交后等待上限(原 t2i 驱动为 835s 写死)
const PRE_IDLE_MAX_MS = 60_000; // 提交前等 /queue 清空上限(到时无论空否都提交)
const PRE_IDLE_POLL_MS = 5_000;
const POLL_MS = 3_000; // /history 轮询间隔
const VANISH_GRACE_MS = 30_000; // 自单离队且 /history 无条目的宽限(超此才判真丢)
const STALE_LOCK_MS = 300_000; // 锁文件过期阈值
const STAGGER_JITTER_MAX_MS = 150_000; // 提交错峰随机抖动上限(进程内一次性抽取)
const SUBMIT_LOCK = "/tmp/daojie_e2e_submit.lock"; // 提交准入锁(跨驱动进程互斥)
const SUBMIT_LOCK_STALE_MS = 60_000; // 正常持锁≤30s;超时视为持锁者已死可抢

// 分辨率达标表(与母版 t2i 同表): 比例型=宽高比±6% 且 百万像素±12%;特殊列精确。
// 二采版两路出图([4] 一采图与二采保存图)分辨率应同源同规格,全量逐张判定。
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

// 按型主体句(与母版 t2i 驱动同源;句子全角标点逐字照录)
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
  process.stderr.write(`[daojie-dual ${new Date().toISOString()}] ${msg}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs() {
  const argv = process.argv.slice(2);
  const dry = argv.includes("--dry");
  const i = argv.indexOf("--type");
  const type = i >= 0 ? argv[i + 1] : undefined;
  if (type && !(type in SPECS)) {
    process.stderr.write(
      `unknown --type "${type}" (must be one of ${Object.keys(SPECS).join("|")})\n`,
    );
    process.exit(2);
  }
  if (!dry && !type) {
    process.stderr.write(
      `usage: node daojie_dual_sample_e2e_0921.mjs --type <${Object.keys(SPECS).join("|")}> [--dry]\n` +
      `  --dry 干跑: 载图→graphToPrompt 三态断言(常态/整组旁路/还原)后退出,不排队;--type 可选\n`,
    );
    process.exit(2);
  }
  return { type, dry };
}

// 二采五节点定位: 从新档 JSON 文件读取实际 id(生成器探测分配,勿写死)。
// KS2=KSampler 且非母版 [12];Dec2=VAEDecode 且非 [11];Save2=SaveImage 且非 [4];
// Enc/Preview 为新档独有类型。启动即校验,定位失败快速失败。
function locateDualNodes(wfJson) {
  const other = (t, excludeId) =>
    wfJson.nodes.filter((n) => n.type === t && String(n.id) !== excludeId);
  const only = (t) => wfJson.nodes.filter((n) => n.type === t);
  const ids = {
    ks2: String(other("KSampler", "12")[0]?.id ?? ""),
    enc: String(only("VAEEncode")[0]?.id ?? ""),
    lu: String(only("LatentUpscaleBy")[0]?.id ?? ""),
    dec2: String(other("VAEDecode", "11")[0]?.id ?? ""),
    prev: String(only("PreviewImage")[0]?.id ?? ""),
    save2: String(other("SaveImage", "4")[0]?.id ?? ""),
  };
  const missing = Object.entries(ids).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length)
    throw new Error(
      `二采六节点在新档中定位失败: ${missing.join(",")} (ids=${JSON.stringify(ids)})`,
    );
  return ids;
}

// ---------- 1) 幂等保活引擎(承袭 t2i 驱动) ----------
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

// flock 在 macOS 不可用,以 O_EXCL 原子建锁等价防并发双启;
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

// 提交准入锁: 同 macOS 无 flock,与 ENGINE_LOCK 同法 O_EXCL 原子建锁。
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

// ---------- 2) 定位 playwright 与浏览器通道(承袭) ----------
function findPlaywright() {
  const candidates = [
    join(REPO, "node_modules", "playwright"),
    join(REPO, "node_modules", "playwright-core"),
    join(REPO, "apps", "node_modules", "playwright"),
    join(REPO, "apps", "node_modules", "playwright-core"),
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
      const appDir = join(d, sub, "Google Chrome for Testing.app");
      const exe = join(appDir, "Contents/MacOS/Google Chrome for Testing");
      if (existsSync(exe)) out.push({ rev, exe });
    }
  }
  return out;
}

function repoBundledChromiums() {
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

// ---------- 3) 真前端通道与 /history(承袭) ----------
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

// 判负退出前清理自己仍挂在引擎队列的单,防僵尸单堆积(承袭)。
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

// ---------- 4) --dry 干跑断言(design §6.1/§6.2:常态→整组旁路→还原 三态) ----------
// 页内执行: 必须先 await app.loadGraphData(主流程已做)再 await app.graphToPrompt(),
// 此版前端返回 {workflow, output} 包装——取 .output(Object.keys 数壳是坑)。
// ① 常态: output[ks2] 为 KSampler、model 指向 [90] 子图产模输出 slot0(真前端展开
//    实测形如 ["90:1",0];0922 审查修正: 原稿写死 ["90",0] 与实跑事实不符,恒判负)
//    且与一采 [12] 的 model 引用深度相等(R2 同栈共享)、latent_image=[enc,0];
// ② 五节点 mode=4 重转换: ks2 消失且 [4].inputs.images 仍指 ["11",0](退化=单采版);
// ③ 还原 mode 并复验 ks2 复活后退出。
const DRY_EVAL = async (ids) => {
  const app = window.app;
  const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const find = (id, type) => {
    const n = app.graph.nodes.find((x) => String(x.id) === id);
    if (!n) throw new Error(`node [${id}] not in loaded graph`);
    if (n.type !== type) throw new Error(`node [${id}] type=${n.type} != ${type}`);
    return n;
  };
  const prev = find(ids.prev, "PreviewImage");
  const enc = find(ids.enc, "VAEEncode");
  const lu = find(ids.lu, "LatentUpscaleBy");
  const ks2 = find(ids.ks2, "KSampler");
  const dec2 = find(ids.dec2, "VAEDecode");
  const save2 = find(ids.save2, "SaveImage");
  const conv = async () => {
    const d = await app.graphToPrompt();
    return d?.output ?? d; // {workflow, output} 包装 → 取 output
  };
  // ① 常态(model 断言 0922 审查修正: [90] 是子图实例,graphToPrompt 展开后产模节点
  // 引用实测形如 ["90:1",0];写死 ["90",0] 对正确产物恒判负)
  const out1 = await conv();
  const ks = out1[ids.ks2];
  if (!ks) throw new Error(`常态 output 无 "${ids.ks2}"`);
  if (ks.class_type !== "KSampler")
    throw new Error(`output["${ids.ks2}"].class_type=${ks.class_type} != KSampler`);
  const m = ks.inputs.model;
  const mOk = Array.isArray(m) && m.length === 2 && m[1] === 0
    && (m[0] === "90" || (typeof m[0] === "string" && m[0].startsWith("90:")));
  if (!mOk)
    throw new Error(`model 引用 ${JSON.stringify(m)} 非法: 应指向 [90] 子图产模输出 slot0(真前端展开实测形如 ["90:1",0])`);
  const ks1 = out1["12"];
  if (!ks1) throw new Error('常态 output 无母版 "12"(一采 KSampler,同栈共享对照锚缺失)');
  if (!deepEq(m, ks1.inputs?.model))
    throw new Error(`两采 model 引用不一致: 二采 ${JSON.stringify(m)} vs 一采[12] ${JSON.stringify(ks1.inputs?.model)}(R2 同栈共享)`);
  // 0922 v2: latent 链=回炉→LU(×1.5)→二采;断言 LU 在图且 scale_by=1.5
  const luOut = out1[ids.lu];
  if (!luOut || luOut.class_type !== "LatentUpscaleBy")
    throw new Error(`常态 output 无 LU "${ids.lu}"(回炉放大段缺失)`);
  if (luOut.inputs?.scale_by !== 1.5)
    throw new Error(`LU scale_by=${luOut.inputs?.scale_by} != 1.5(极清档)`);
  if (!deepEq(ks.inputs.latent_image, [ids.lu, 0]))
    throw new Error(`latent_image 引用 ${JSON.stringify(ks.inputs.latent_image)} != ["${ids.lu}",0](须经回炉放大)`);
  // ② 整组旁路(二采组六节点 mode=4=数据穿行;[12] 不动)
  const five = [prev, enc, lu, ks2, dec2, save2];
  const saved = five.map((n) => n.mode);
  for (const n of five) n.mode = 4;
  const out2 = await conv();
  if (ids.ks2 in out2) throw new Error(`旁路态 output 仍含 "${ids.ks2}"(应消失)`);
  const n4 = out2["4"];
  if (!n4 || !deepEq(n4.inputs?.images, ["11", 0]))
    throw new Error(`旁路态 [4].inputs.images=${JSON.stringify(n4?.inputs?.images)} != ["11",0]`);
  // ③ 还原 mode(复验二采复活,证明还原生效)后退出
  five.forEach((n, i) => { n.mode = saved[i]; });
  const out3 = await conv();
  if (!(ids.ks2 in out3)) throw new Error("还原 mode 后二采 KSampler 未复活(还原失败)");
  return {
    ks2: ids.ks2, enc: ids.enc, lu: ids.lu, dec2: ids.dec2, prev: ids.prev,
    save2: ids.save2,
    nodesNormal: Object.keys(out1).length,
    nodesBypass: Object.keys(out2).length,
    nodesRestored: Object.keys(out3).length,
    modelRef: ks.inputs.model,
    latentRef: ks.inputs.latent_image,
    bypassSave4Ref: n4.inputs.images,
  };
};

async function runDry(page, ids) {
  const t0 = Date.now();
  let info = null;
  try {
    info = await page.evaluate(DRY_EVAL, ids);
  } catch (e) {
    return { ok: false, info: null, errors: [String(e?.message ?? e)], durationSec: (Date.now() - t0) / 1000 };
  }
  log(`DRY OK ${JSON.stringify(info)}`);
  return { ok: true, info, errors: [], durationSec: (Date.now() - t0) / 1000 };
}

// ---------- 5) 主流程 ----------
async function main() {
  const { type, dry } = parseArgs();
  const procStart = Date.now(); // 进程级 deadline 起点(见 PROC_DEADLINE_MS 注释)
  const wfJson = JSON.parse(readFileSync(WORKFLOW_JSON, "utf8"));
  const DUAL_IDS = locateDualNodes(wfJson); // {ks2,enc,dec2,prev,save2} 实际 id
  log(`dual nodes located: ${JSON.stringify(DUAL_IDS)}`);
  const staggerJitter = Math.floor(Math.random() * STAGGER_JITTER_MAX_MS);
  if (!dry) log(`submit stagger jitter=${(staggerJitter / 1000).toFixed(1)}s (fast path & cap)`);
  const errors = [];
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

    // 载图: page.evaluate 对返回 Promise 的页内函数自动 await(design §6.1 必 await)
    await page.evaluate((data) => window.app.loadGraphData(data), wfJson);
    await sleep(2_000);
    const graphInfo = await page.evaluate(() => ({
      nodes: window.app.graph.nodes.length,
      ids: window.app.graph.nodes.map((n) => String(n.id)),
    }));
    log(`workflow loaded: ${graphInfo.nodes} nodes`);
    if (!graphInfo.ids.includes(BASE_NODE_ID))
      throw new Error(`node [${BASE_NODE_ID}] not in loaded graph`);
    for (const [k, v] of Object.entries(DUAL_IDS))
      if (!graphInfo.ids.includes(v))
        throw new Error(`dual node ${k}=[${v}] not in loaded graph`);

    // 置型/置主体句(与 t2i 驱动同法;--dry 未给 --type 时跳过)
    if (type) {
      const setRes = await page.evaluate((args) => {
        const n = window.app.graph.nodes.find((x) => String(x.id) === args.nodeId);
        if (!n) return { ok: false, err: "node not found" };
        const w = (n.widgets || []).find((x) => x.name === "base");
        if (!w) return { ok: false, err: `base widget not found (widgets=${(n.widgets || []).map((x) => x.name).join(",")})` };
        const opts = w.options?.values ?? [];
        if (opts.length && !opts.includes(args.type))
          return { ok: false, err: `type "${args.type}" not in combo options [${opts.join(",")}]` };
        w.value = args.type;
        try { w.callback?.(args.type); } catch {}
        try { n.setDirtyCanvas?.(true, true); } catch {}
        return { ok: w.value === args.type, value: w.value, options: opts };
      }, { nodeId: BASE_NODE_ID, type });
      if (!setRes.ok) throw new Error(`set base failed: ${setRes.err}`);
      log(`base widget set -> ${setRes.value} (options ${setRes.options.length})`);

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
    } else {
      log("dry 模式未指定 --type,跳过置型/置主体句");
    }

    // ── --dry: 三态断言后退出(不排队不出图) ──
    if (dry) {
      const dryRun = await runDry(page, DUAL_IDS);
      await browser.close();
      t.browser = null;
      if (!dryRun.ok) {
        log(`DRY FAIL ${dryRun.errors.join(" | ")}`);
        emit(type ?? "--dry", {
          ok: false, image: "", width: 0, height: 0,
          durationSec: dryRun.durationSec, promptId: "", applied: "",
          images: [], errors: dedupe(dryRun.errors).concat(tailConsole(consoleErrs)),
        });
        return;
      }
      emit(type ?? "--dry", {
        ok: true, image: "", width: 0, height: 0,
        durationSec: dryRun.durationSec, promptId: "", applied: "",
        images: [], errors: [], dry: dryRun.info,
      });
      return;
    }

    // ── 提交前错峰(承袭 t2i 驱动: 珍珠链准入锁) ──
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

    // 排队: 与「生成」按钮同一条代码路径
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
    releaseSubmitLock(); // 提交确证完成(成败皆然)即放锁
    const submissionFailed =
      (hookPost && hookPost.status !== 200) ||
      (!hookPost && q.err) ||
      (hookPost?.status === 200 && !promptId);
    if (submissionFailed) {
      await browser.close();
      t.browser = null;
      emit(type, { ok: false, image: "", width: 0, height: 0, durationSec: (Date.now() - t0) / 1000, promptId, applied: "", images: [], errors: dedupe(errors).concat(tailConsole(consoleErrs)) }, `channel=${desc}`);
      return;
    }

    // 轮询 /history 找排队之后新出现的 prompt_id,直到完成或 deadline 超时。
    // 窗=进程级 deadline(1500s 减前置耗时),留 5s 收尾。
    const runDeadline = Math.min(t0 + POST_SUBMIT_BUDGET_MS, procStart + PROC_DEADLINE_MS - 5_000);
    let entry = null, matchedById = false;
    let lastQueuedMs = Date.now();
    let lastQueued = null;
    while (Date.now() < runDeadline) {
      await sleep(POLL_MS);
      const h = await historySnapshot();
      if (promptId && h[promptId]) { entry = h[promptId]; matchedById = true; break; }
      if (!promptId) {
        for (const [pid, e] of Object.entries(h)) {
          if (beforeIds.has(pid)) continue;
          const base = e?.prompt?.[0]?.[BASE_NODE_ID]?.inputs?.base;
          if (base === type) { entry = e; promptId = pid; matchedById = true; break; }
        }
        if (entry) break;
      }
      if (promptId) {
        let queued = null;
        try {
          const q2 = await (await fetch(`${ENGINE_URL}/queue`, { signal: AbortSignal.timeout(5_000) })).json();
          queued = [...(q2?.queue_running ?? []), ...(q2?.queue_pending ?? [])]
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
      await cleanupQueueEntry(promptId);
      emit(type, {
        ok: false, image: "", width: 0, height: 0, durationSec, promptId,
        applied: "", images: [],
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
        applied: appliedOf(entry), images: [],
        errors: dedupe(errors).concat([
          `status_str=${statusStr}`,
          `status=${JSON.stringify(entry.status).slice(0, 4000)}`,
        ]).concat(tailConsole(consoleErrs)),
      }, `channel=${desc}`);
      return;
    }

    // 产出收集: outputs 里 SaveImage 的 images[].filename(type=output)带节点号;
    // 二采版期望双产物: [4] 一采图 + [save2] 二采保存图(PreviewImage 出的是 temp 不计)
    const outputs = [];
    for (const [nodeId, out] of Object.entries(entry.outputs ?? {})) {
      for (const img of out?.images ?? []) {
        if (img?.type === "output" && img?.filename)
          outputs.push({ node: nodeId, filename: img.filename, width: 0, height: 0 });
      }
    }
    const applied = appliedOf(entry);
    if (!outputs.length) {
      emit(type, {
        ok: false, image: "", width: 0, height: 0, durationSec, promptId, applied,
        images: [],
        errors: dedupe(errors).concat(["success but no SaveImage output"]).concat(tailConsole(consoleErrs)),
      }, `channel=${desc}`);
      return;
    }

    // sips 量测每个出图文件原生分辨率
    const sipsFailed = [];
    for (const o of outputs) {
      const p = join(OUTPUT_DIR, o.filename);
      const r = spawnSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", p], { encoding: "utf8" });
      if (r.status !== 0) { sipsFailed.push(o.filename); continue; }
      o.width = Number(/pixelWidth:\s*(\d+)/.exec(r.stdout)?.[1] ?? 0);
      o.height = Number(/pixelHeight:\s*(\d+)/.exec(r.stdout)?.[1] ?? 0);
    }
    for (const o of outputs) log(`sips [${o.node}] ${o.filename}: ${o.width}x${o.height}${sipsFailed.includes(o.filename) ? " ERR=sips failed" : ""}`);

    // 达标判定: [4] 一采图按型规格(比例±6%/MP±12%/特殊列精确);二采图经 LU×1.5,
    // 按「一采图边长×1.5(±2%)」判定(0922 v2:二采在放大 latent 上精修,规格随档)
    const spec = SPECS[type];
    const pass1 = outputs.find((o) => o.node === "4");
    const measured = outputs.map((o) => ({
      name: o.filename, width: o.width, height: o.height,
      err: sipsFailed.includes(o.filename) ? "sips failed" : undefined,
    }));
    const verdicts = measured.map((m, i) => {
      const o = outputs[i];
      if (o.node !== "4" && pass1 && pass1.width > 0 && !sipsFailed.includes(pass1.filename)) {
        // 二采图: 边长应≈一采×1.5(nearest-exact ×1.5 后取整到 8 的倍数,容差 2%)
        const issues = [];
        for (const [got, want, axis] of [[m.width, pass1.width * 1.5, "宽"], [m.height, pass1.height * 1.5, "高"]]) {
          if (Math.abs(got / want - 1) > 0.02)
            issues.push(`${m.name} ${axis} ${got} != 一采×1.5≈${Math.round(want)}(±2%)`);
        }
        return { pass: issues.length === 0, issues };
      }
      return judge(m, spec);
    });
    const dualMissing = ["4", DUAL_IDS.save2]
      .filter((n) => !outputs.some((o) => o.node === n));
    if (dualMissing.length)
      errors.push(`双产物缺 [${dualMissing.join("]/[")}] 的输出(实得 [${outputs.map((o) => o.node).join(",")}])`);
    // 主图=二采保存图(精修结果是主交付),缺则回落首个
    const main = outputs.find((o) => o.node === DUAL_IDS.save2 && !sipsFailed.includes(o.filename))
      ?? outputs.find((o) => !sipsFailed.includes(o.filename))
      ?? outputs[0];
    const allOk = verdicts.length === outputs.length
      && outputs.length > 0
      && dualMissing.length === 0
      && verdicts.every((v) => v.pass);
    emit(type, {
      ok: allOk,
      image: main?.filename ?? "",
      width: main?.width ?? 0,
      height: main?.height ?? 0,
      durationSec, promptId, applied,
      images: outputs,
      errors: dedupe(errors.concat(verdicts.flatMap((v) => v.issues))).concat(allOk ? [] : tailConsole(consoleErrs)),
    }, `channel=${desc}`);
  } catch (e) {
    log(`FATAL ${e?.stack ?? e}`);
    releaseSubmitLock(); // 持锁途中 FATAL 也放锁(未持锁时为 no-op)
    try { await cleanupQueueEntry(promptId); } catch {}
    try { t.browser?.close(); } catch {}
    emit(type ?? "--dry", {
      ok: false, image: "", width: 0, height: 0, durationSec: 0, promptId: "", applied: "",
      images: [], errors: [String(e?.message ?? e)],
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
    promptId: r.promptId ?? "", applied: r.applied ?? "",
    images: r.images ?? [], errors: r.errors ?? [],
  };
  if (r.dry) out.dry = r.dry; // --dry 模式附三态断言详情(节点号/引用/计数)
  if (extra) log(`result extra: ${extra}`);
  process.stdout.write(JSON.stringify(out) + "\n");
  process.exit(out.ok ? 0 : 1);
}

await main();
