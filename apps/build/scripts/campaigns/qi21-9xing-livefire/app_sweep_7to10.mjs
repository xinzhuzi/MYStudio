#!/usr/bin/env node
/**
 * app_sweep_7to10.mjs — qi21 九型实弹·App 驱动型 7-10 扫场(本会话)
 * ————————————————————————————————————————————————
 * 任务书流程逐条照办:
 *  1. 短连:画布宿主节点(type=uuid 且 title 含「提示词」)widget「型选择」.value=本型,回读确认。
 *  2. 短连:window.app.queuePrompt() 排队。
 *  3. 引擎 HTTP 轮询(17000/17001 两口都探)/queue+/history:队列清空且 history 出新终态=完成;单型上限 15 分钟。
 *  4. 短连:读 [401] __myPreviewDisplay 显示框 len/head;读最新产物文件名。
 *  5. 透明型:引擎 venv PIL 开产物图取四角 alpha(≤8=过);非透明型"不检"。
 *  6. 每型结果立刻写 /tmp/nine_type_results.json(增量覆盖);失败型记录实况继续;连续 3 型失败停(由外层处置)。
 * 纪律:即连即断(ws ≤15s);引擎长等待只走 HTTP;App 保持运行(绝不 quit/kill);1-6 型为前役在档证据,本脚本只跑 7-10。
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { withCDP, scanCdp } from "./app_short_conn.mjs";

const CAMP = "/Users/zhengbingjin/Project/Github/MYStudio/apps/build/scripts/campaigns/qi21-9xing-livefire";
const IMAGES = join(CAMP, "images");
const RUNS = join(CAMP, "runs");
const VERIFY = join(CAMP, "verify");
const RESULTS = "/tmp/nine_type_results.json";
const VENV_PY = "/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/venv/bin/python3";
const BUDGET_MS = 15 * 60_000; // 任务书:单型上限 15 分钟

// 前役 1-6 型在档结论(本会话已复验:runs/*.json 读回 + 透明型四角 alpha 现场重测 + postcheck 判读)
const PREV = [
  { idx: 1, key: "人物", transparent: false, pid: "9c4d3719", durMin: 4.23, pass: true, files: "images/type-1-人物.direct.png + .2k.png", alpha: "不检", previewLen: 5194, note: "前役同战役上一会话 09:19-09:24 实拍(引擎直排链,canon 主体句,seed=4101 破缓存);status=success 非回声;本会话复验 runs/type-1-人物.json+postcheck ok=true(18 查全绿)。" },
  { idx: 2, key: "场景", transparent: false, pid: "c1707be8", durMin: 6.9, pass: true, files: "images/type-2-场景.direct.png + .2k.png", alpha: "不检", previewLen: 4656, note: "前役 09:37-09:44 实拍;status=success;本会话复验 postcheck ok=true(18 查全绿)。" },
  { idx: 3, key: "道具", transparent: true, pid: "fc46aba4", durMin: 6.72, pass: false, files: "images/type-3-道具.direct.png + .2k.png", alpha: "[255,255,1,0]", previewLen: 4941, note: "前役 10:08-10:15 实拍;透明门红:本会话现场重测直出四角 [255,255,1,0],2/4 角>8(2K 角 [255,255,0,0] 达标但门在直出);透明指令三重全在正向而模型未服从(PDD T8 4步+官方英文 pe_t2i)。" },
  { idx: 4, key: "美宣", transparent: false, pid: "ad8280e7", durMin: 6.89, pass: true, files: "images/type-4-美宣.direct.png + .2k.png", alpha: "不检", previewLen: 6146, note: "前役 10:31-10:38 实拍;status=success;本会话复验 postcheck ok=true(18 查全绿)。" },
  { idx: 5, key: "多视图", transparent: true, pid: "c972ae02", durMin: 6.83, pass: false, files: "images/type-5-多视图.direct.png + .2k.png", alpha: "[255,255,255,255]", previewLen: 6258, note: "前役 10:56-11:03 实拍;透明门红:本会话现场重测直出四角 [255,255,255,255] 全不透明(2K [0,255,255,188] 亦红);全图 alpha>250 占 100%。" },
  { idx: 6, key: "高清人脸", transparent: true, pid: "a00b747a", durMin: 6.21, pass: false, files: "images/type-6-高清人脸.direct.png + .2k.png", alpha: "[255,255,254,254]", previewLen: 5066, note: "前役 11:15-11:22 实拍;透明门红:本会话现场重测直出四角 [255,255,254,254](2K [255,255,255,218]);canon 主体句自带背景子句与透明底诉求内生冲突(§7 分析在 runs/type-6-高清人脸.md)。" },
];

const TYPES = [
  { idx: 7, key: "分镜剧情图", transparent: false },
  { idx: 8, key: "表情差分", transparent: true },
  { idx: 9, key: "概念气氛图", transparent: false },
  { idx: 10, key: "自由", transparent: false },
];

const t0 = Date.now();
const log = (...a) => console.log(`[T+${Math.round((Date.now() - t0) / 1000)}s]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 结果看板落盘(增量覆盖;1-6 前役在档 + 7-10 本会话) ──
const live = []; // 本会话 7-10 结果
function writeBoard() {
  const all = [...PREV.map(p => ({
    idx: p.idx, 型: p.key, 透明预期: p.transparent, 跑次: "前役同战役会话(09:19-11:22 落盘,本会话复验)",
    产物文件: p.files, alpha四角: p.alpha, 预览框: `有文(${p.previewLen}字)`, 通过: p.pass, 备注: p.note,
  })), ...live];
  const body = { updated: new Date().toISOString(), sweep: "qi21-九型+自由 实弹(6 前役在档 + 本会话 7-10 App 驱动)", results: all };
  writeFileSync(RESULTS, JSON.stringify(body, null, 1));
  const done = all.filter(r => r.通过).length;
  log(`📋 看板落盘 ${RESULTS}(10 项中 ${all.filter(r => r["产物文件"]).length} 有产物,绿 ${done})`);
}

// ── 引擎口解析(17000/17001 都探;漂移自愈) ──
async function engineBase() {
  for (const p of [17000, 17001]) {
    try {
      const r = await fetch(`http://127.0.0.1:${p}/system_stats`, { signal: AbortSignal.timeout(2500) });
      if (r.ok) return `http://127.0.0.1:${p}`;
    } catch { /* 下一个 */ }
  }
  return null;
}

async function engineJson(base, path, timeout = 8000) {
  const r = await fetch(base + path, { signal: AbortSignal.timeout(timeout) });
  return r.json();
}

// 排队图类型闸:prompt 图里找 MyQi21DaojieBase.base === key
function shotHasBase(promptObj, key) {
  return Object.values(promptObj || {}).some((n) => n && n.class_type === "MyQi21DaojieBase" && n.inputs?.base === key);
}

// ── venv PIL 四角 alpha ──
function cornerAlpha(imgPath) {
  return new Promise((resolve) => {
    const p = spawn(VENV_PY, ["-c", `import sys, json
from PIL import Image
im = Image.open(sys.argv[1]); im.load()
w, h = im.size
ca = [im.getpixel(x)[3] for x in [(1,1),(w-2,1),(1,h-2),(w-2,h-2)]]
print(json.dumps({"mode": im.mode, "size": list(im.size), "cornerAlpha": ca}))`, imgPath], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", () => { try { resolve(JSON.parse(out)); } catch { resolve({ error: (err || out).slice(0, 300) }); } });
  });
}

// ═══════════ 主扫场 ═══════════
let consecutiveFails = 0;
mkdirSync(IMAGES, { recursive: true });

for (const T of TYPES) {
  const slug = `type-${T.idx}-${T.key}`;
  const res = { idx: T.idx, 型: T.key, 透明预期: T.transparent, 跑次: "本会话 App 驱动(真前端 queuePrompt)", 产物文件: "", alpha四角: "", 预览框: "空", 通过: false, 备注: "" };
  log(`═══ 型 ${T.idx}/10 「${T.key}」(透明预期=${T.transparent})═══`);
  try {
    // S1 短连①:置型选择 + 回读确认 + graphToPrompt 干跑核排队图 base
    const setR = await withCDP(async ({ evalJs }) => {
      const st = {};
      st.host = await evalJs(`(() => { const n = (window.app.graph._nodes||[]).find(n => /^[0-9a-f]{8}-/.test(n.type) && (n.title||'').includes('提示词')); if (!n) return 'host-missing'; const w = (n.widgets||[]).find(w => w.name === '型选择'); if (!w) return 'widget-missing'; const old = w.value; w.value = ${JSON.stringify(T.key)}; try { n.onWidgetChanged && n.onWidgetChanged('型选择', ${JSON.stringify(T.key)}, old, w); } catch(e) {} return 'set:old=' + String(old); })()`);
      st.readback = await evalJs(`(() => { const n = (window.app.graph._nodes||[]).find(n => /^[0-9a-f]{8}-/.test(n.type) && (n.title||'').includes('提示词')); const w = n && (n.widgets||[]).find(w => w.name === '型选择'); return w ? String(w.value) : 'no-widget'; })()`);
      st.n400 = await evalJs(`(() => { const n = (window.app.graph._nodes||[]).find(x => String(x.id)==='400'); const w = n && (n.widgets||[]).find(w => w.name==='value'); return w ? String(w.value).length : -1; })()`);
      st.prev401Len = await evalJs(`(() => { const n = (window.app.graph._nodes||[]).find(x => String(x.id)==='401'); const w = n && (n.widgets||[]).find(w => w.__myPreviewDisplay); return w ? String(w.value||'').length : -1; })()`);
      st.dryBase = await evalJs(`(async () => { try { const p = await window.app.graphToPrompt(); const ks = Object.keys(p.output||{}); const hits = ks.filter(k => (p.output[k]||{}).class_type === 'MyQi21DaojieBase'); return hits.map(k => p.output[k].inputs.base).join(',') || 'no-base-node'; } catch(e) { return 'ERR:' + e.message; } })()`);
      return st;
    });
    log(`S1 置型: ${JSON.stringify(setR)}`);
    if (setR.host !== "host-missing" && !String(setR.host).startsWith("set:") ) throw new Error("置型失败: " + JSON.stringify(setR.host));
    if (setR.readback !== T.key) throw new Error(`回读=${setR.readback} ≠ ${T.key}`);
    if (setR.dryBase !== T.key) throw new Error(`graphToPrompt 干跑 base=${setR.dryBase} ≠ ${T.key}(排队图类型闸)`);

    // S2 短连②:排队(先抓 knownPids 基线)
    const base0 = await engineBase();
    if (!base0) throw new Error("引擎 17000/17001 均不应答");
    const knownPids = new Set(Object.keys(await engineJson(base0, "/history", 15000)));
    const tQueue = Date.now();
    const queued = await withCDP(async ({ evalJs }) => evalJs(`(async () => { const app = window.app; if (!app || typeof app.queuePrompt !== 'function') return null; try { await app.queuePrompt(); return 'queued'; } catch (e) { return 'err:' + (e && (e.message || e)); } })()`));
    if (queued !== "queued") throw new Error("queuePrompt 失败: " + JSON.stringify(queued));
    log(`🚀 queued(引擎=${base0},history 基线 ${knownPids.size} 条)`);

    // S3 引擎 HTTP 轮询(无 CDP):抓 pid(类型闸)→ /history/{pid} 终态;≤15min
    let pid = null, entry = null, errStr = null, queueEmptySeen = false;
    const deadline = tQueue + BUDGET_MS;
    let lastBeat = 0;
    while (Date.now() < deadline) {
      const base = (await engineBase()) || base0;
      try {
        if (!pid) {
          // 先查 history 新终态(秒完路径),再查 queue
          const hist = await engineJson(base, "/history", 8000);
          for (const [p, e] of Object.entries(hist)) {
            if (knownPids.has(p)) continue;
            const pr = Array.isArray(e.prompt) ? e.prompt[2] : e.prompt;
            if (shotHasBase(pr, T.key)) { pid = p; entry = e; }
          }
          if (!entry) {
            const q = await engineJson(base, "/queue", 8000);
            const items = [...(q.queue_running || []), ...(q.queue_pending || [])];
            for (const it of items) {
              const p = it[1];
              if (knownPids.has(p)) continue;
              if (shotHasBase(it[2], T.key)) pid = p;
            }
            if (!items.length) queueEmptySeen = true;
          }
        }
        if (pid && !entry) {
          const h = await engineJson(base, `/history/${pid}`, 8000);
          const e = h[pid];
          if (e && e.status && (e.status.status_str === "success" || e.status.status_str === "error" || e.status.completed)) entry = e;
        }
      } catch (e) { errStr = String(e).slice(0, 200); }
      if (entry) break;
      if (Date.now() - lastBeat > 60_000) {
        lastBeat = Date.now();
        let run = "?";
        try { run = ((await engineJson(base, "/queue", 5000)).queue_running || []).length; } catch {}
        log(`⏳ 执行中 T+${Math.round((Date.now() - tQueue) / 1000)}s(pid=${pid ? pid.slice(0, 8) : "未捕"} queue running=${run}${errStr ? " lastErr=" + errStr : ""})`);
      }
      await sleep(4000);
    }
    if (!entry) {
      // 超预算清枪(防占队列毒化后型)——与 drive_type 同纪律
      try { const base = (await engineBase()) || base0; await fetch(base + "/interrupt", { method: "POST", signal: AbortSignal.timeout(5000) }); log("POST /interrupt(超 15min 清枪)"); } catch {}
      throw new Error(`超 15min 无终态(pid=${pid ? pid.slice(0, 8) : "未捕"} queueEmptySeen=${queueEmptySeen})`);
    }
    const durMin = +((Date.now() - tQueue) / 60000).toFixed(2);
    const statusStr = entry.status?.status_str;
    writeFileSync(join(RUNS, `${slug}.history.json`), JSON.stringify(entry, null, 1));
    if (statusStr !== "success") throw new Error(`history status=${statusStr}: ` + JSON.stringify(entry.status?.messages || []).slice(0, 800));
    const cachedMsg = (entry.status?.messages || []).find((m) => m[0] === "execution_cached");
    const cachedN = cachedMsg?.[1]?.nodes?.length || 0;
    const promptN = Object.keys(Array.isArray(entry.prompt) ? entry.prompt[2] : entry.prompt || {}).length;
    log(`✅ 引擎终态 success pid=${pid.slice(0, 8)} dur=${durMin}min cached=${cachedN}/${promptN}`);

    // S4 短连③:[401] __myPreviewDisplay 回读(完成后 WS 回包有延迟,15s 内三次探)
    let pv = { len: 0, head: "" };
    for (let i = 0; i < 3; i++) {
      await sleep(5000);
      pv = await withCDP(async ({ evalJs }) => evalJs(`(() => { const n = (window.app.graph._nodes||[]).find(x => String(x.id)==='401'); if (!n) return {err:'no-node'}; const w = (n.widgets||[]).find(w => w.__myPreviewDisplay); if (!w) return {err:'no-widget'}; const v = String(w.value||''); return { len: v.length, head: v.slice(0, 50).replace(/[\\n\\r]/g, '|') }; })()`));
      if (pv && pv.len > 0) break;
    }
    res.预览框 = pv && pv.len > 0 ? `有文(${pv.len}字)` : "空";
    log(`S4 [401] __myPreviewDisplay: ${JSON.stringify(pv)}`);

    // S5 产物图(直出 [8] + 2K [504])/view 取证
    const outs = entry.outputs || {};
    const imgEntries = [];
    for (const nk of ["8", "504"]) {
      const im = outs[nk]?.images?.[0];
      if (im) imgEntries.push({ nk, ...im });
    }
    if (!imgEntries.length) throw new Error("history outputs 无图([8]/[504] 皆空)");
    const fileNames = [];
    for (const im of imgEntries) {
      const url = `${(await engineBase()) || base0}/view?filename=${encodeURIComponent(im.filename)}&subfolder=${encodeURIComponent(im.subfolder || "")}&type=${encodeURIComponent(im.type || "output")}`;
      const buf = Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(20000) })).arrayBuffer());
      const local = join(IMAGES, `${slug}.${im.nk === "8" ? "direct" : "2k"}.png`);
      writeFileSync(local, buf);
      const pngMagic = buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50;
      fileNames.push(`images/${slug}.${im.nk === "8" ? "direct" : "2k"}.png(${im.filename},${buf.length}B,${pngMagic ? "PNG✓" : "MAGIC✗"})`);
      if (im.nk === "8") res.产物文件 = `images/${slug}.direct.png`;
    }
    log(`🖼 ${fileNames.join(" ; ")}`);

    // S6 透明门(仅透明型):venv PIL 四角 alpha ≤8
    if (T.transparent) {
      const d = await cornerAlpha(join(IMAGES, `${slug}.direct.png`));
      const k = await cornerAlpha(join(IMAGES, `${slug}.2k.png`));
      res.alpha四角 = JSON.stringify(d.cornerAlpha);
      const okA = Array.isArray(d.cornerAlpha) && d.cornerAlpha.every((a) => a <= 8);
      log(`S6 alpha 直出=${JSON.stringify(d.cornerAlpha)} 2K=${JSON.stringify(k.cornerAlpha)} → ${okA ? "PASS" : "FAIL"}`);
      if (!okA) { res.备注 = `透明门红:直出四角 ${JSON.stringify(d.cornerAlpha)}(2K ${JSON.stringify(k.cornerAlpha)}),门=四角≤8;${cachedN > 0 ? `部分缓存 cached=${cachedN}/${promptN};` : ""}pid=${pid.slice(0, 8)} dur=${durMin}min;预览框=${res.预览框}。`; }
      else res.备注 = `透明门过:直出四角 ${JSON.stringify(d.cornerAlpha)} 全≤8(2K ${JSON.stringify(k.cornerAlpha)});pid=${pid.slice(0, 8)} dur=${durMin}min。`;
      res.通过 = okA;
    } else {
      res.alpha四角 = "不检";
      res.通过 = true;
      res.备注 = `非透明型(alpha 不设门);status=success 非回声(cached=${cachedN}/${promptN});pid=${pid.slice(0, 8)} dur=${durMin}min;预览框=${res.预览框};[400]主体句=${setR.n400}字(画布保存态,本流程零改)。`;
    }
    if (res.通过 && (!(pv && pv.len > 0))) {
      res.备注 += " ⚠[401]App显示框未回文(history 侧 merged 在)";
    }
  } catch (e) {
    res.通过 = false;
    res.备注 = `失败实况: ${String(e && e.message || e).slice(0, 400)}`;
    log(`❌ 型 ${T.idx} 失败: ${res.备注}`);
  }
  live.push(res);
  writeBoard();
  consecutiveFails = res.通过 ? 0 : consecutiveFails + 1;
  if (consecutiveFails >= 3) { log("🛑 连续 3 型失败,停止扫场(上报处置)"); break; }
  await sleep(3000); // 拍间呼吸
}

const okCount = live.filter(r => r.通过).length;
log(`═══ 扫场结束: 本会话 7-10 绿 ${okCount}/${live.length} ═══`);
process.exit(0); // 看板已落盘;终判由返回值与看板承载
