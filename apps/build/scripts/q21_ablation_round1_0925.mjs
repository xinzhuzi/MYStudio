#!/usr/bin/env node
// ============================================================================
// ⛔ 1001 退役警示(Trellis 10-01-qi21-assembly-blueprint)——勿再运行本脚本!
// 2026-10-01 退役:0925 噪点消融第1轮役已收官入库;锚 d["141"].inputs.switch 的 [141]
// 提示词开关已随 S8 集成轮换型为自研装配器(if/else 内置)——重跑必红(断言红)。
// ============================================================================

/**
 * 噪点根因消融·第1轮(0925)驱动——直排出图阶段。
 *
 * 用法:node apps/build/scripts/q21_ablation_round1_0925.mjs queue
 * 依赖:① dry 阶段产物 /tmp/q21-ablation-0925/api-{person,scene}.json
 *      ② 九拍冻结文本 ~/Downloads/q21-nine-pe-0924/2-pe-rewritten.txt
 *
 * 臂表(A/B/C=场景型,D=人物型;seed 全 0;队列串行;引擎直排 /prompt):
 *   D1  人物直写装配原文·40步·原生TE(锚≈2.00;兼作 D 系手术文本源)
 *   A0  场景 PE 真改写·0924裸前缀种子句·6步LoRA·Heretic(复现锚≈8.2)
 *   C1  场景 PE 真改写·反噪前缀种子句·6步LoRA·Heretic(PE pp=1.5 seed42)
 *   A1  场景冻文直贴(2-pe-rewritten 全文)·6步LoRA·Heretic
 *   A2  同 A1 冻文·40步无LoRA·Heretic(步数/LoRA 份额)
 *   B1  冻文删三处整幅纹理句·6步LoRA·Heretic(词汇·删除法)
 *   B2  同位置换描述性正写+补平滑底句·6步LoRA·Heretic(词汇·换描述法)
 *   A3  同 A1 冻文·6步LoRA·原生TE(TE 份额)
 *   D2a/D2b 人物『克制的矿物颗粒』→『纯净均匀的罩染面』·40步/6步LoRA·原生TE
 *   D3a/D3b 人物④行『宣纸白』→『暖米白』·40步/6步LoRA·原生TE
 *   D4  人物摘除③层否定式纸纹禁令三处·40步·原生TE(纯科研臂)
 *
 * 手术全部在 API 图字面层(冻文/手术文直写 [40:142].prompt;TE 换 [2].clip_name;
 * steps/model 直改 [7] 字面),零改仓库真源。
 * 产物:~/Downloads/q21-ablation-0925/<臂名>.png + <臂名>.txt(当次提示词全文)
 * 日志:/tmp/q21-ablation-0925/queue-log.jsonl(逐臂)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { randomUUID } from "node:crypto";

const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17000";
const TMP = "/tmp/q21-ablation-0925";
const OUT_DIR = `${process.env.HOME}/Downloads/q21-ablation-0925`;
const LOG = `${TMP}/queue-log.jsonl`;
const OFFICIAL_TE = "qwen3vl_8b_bf16.safetensors";
const SCENE_W = 2800, SCENE_H = 1568;   // =九拍 2-场景.png 实拍(型档 16:9@4.2MP)
const PERSON_W = 1824, PERSON_H = 2432; // =九拍 1-人物.png 实拍

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ── 文本源 ──────────────────────────────────────────────────────
const FROZEN = readFileSync(`${process.env.HOME}/Downloads/q21-nine-pe-0924/2-pe-rewritten.txt`, "utf8").trim();

// A0 种子句=0924 九拍逐字(裸前缀+场景库主体句;qi21_nine_pe_0924.mjs SEED_PREFIX+TYPES[1])
const A0_SEED = "水墨国风修仙:" + "暮春时节的黄昏，废弃的上古祭坛深藏在群山环抱的谷底，九根断裂的石柱围成半圆，坛心一泓浅潭映出残阳；谷口白雾正缓缓漫入，远山三重叠影渐次淡去。";
// C1 种子句=反噪前缀(0925 真源措辞)+同主体句
const C1_SEED = "水墨国风修仙,画面干净平滑,墨与色落在浅净平涂色场上,而非纸面纹理:" + "暮春时节的黄昏，废弃的上古祭坛深藏在群山环抱的谷底，九根断裂的石柱围成半圆，坛心一泓浅潭映出残阳；谷口白雾正缓缓漫入，远山三重叠影渐次淡去。";

// B1:删三处整幅纹理句(整句删除;句 a 含 rough ink textures+textured with charcoal strokes)
const CLIFF_SENT = "The far left and far right edges are framed by steep, dark cliff faces: the left cliff is almost black-gray with rough ink textures and overhanging vegetation, while the right cliff is similarly jagged, textured with charcoal strokes, and dotted with sparse tree silhouettes clinging to ledges.";
const PILLAR_SENT = "The pillars are dark gray-brown with worn edges, carved relief-like details, rough stone texture, and patches of discoloration.";
const SUMMARY_SENT = "The style resembles Chinese shanshui-inspired digital painting with xianxia fantasy atmosphere: expressive ink textures, smoky gradients, fine linework in the stone carvings, and warm cinematic sunset lighting.";
function buildB1() {
  let t = FROZEN;
  const checks = [[CLIFF_SENT, "cliff"], [PILLAR_SENT, "pillar"], [SUMMARY_SENT, "summary"]];
  for (const [s, tag] of checks) {
    if (!t.includes(s)) throw new Error(`B1 源句未命中:${tag}`);
    t = t.replace(s + " ", "").replace(s, "");
  }
  return t;
}
// B2:同位置换描述性正写(矩阵指定两处措辞;charcoal 与总结句按同义描述法补)+补平滑底句
function buildB2() {
  let t = FROZEN;
  const pairs = [
    ["with rough ink textures and overhanging vegetation", "with soft diffused pale ink receding in layers and overhanging vegetation"],
    ["textured with charcoal strokes", "edged in smooth low-contrast gradations"],
    ["rough stone texture, and patches of discoloration", "smooth low-contrast stone edges, and patches of discoloration"],
    ["expressive ink textures, smoky gradients", "soft diffused washes receding in layers, smoky gradients"],
  ];
  for (const [a, b] of pairs) {
    if (!t.includes(a)) throw new Error(`B2 源片段未命中:${a.slice(0, 40)}`);
    t = t.replace(a, b);
  }
  return t + "\n\nThe overall surface keeps a smooth matte flat background throughout.";
}

// D 系手术(源=D1 装配全文,运行时取得)
function d2Surgery(t) {
  const a = "只用纯净罩染与克制的矿物颗粒";
  if (!t.includes(a)) throw new Error("D2 源句未命中");
  return t.replace(a, "只用纯净均匀的罩染面");
}
function d3Surgery(t) {
  if (!t.includes("宣纸白")) throw new Error("D3 源词未命中");
  return t.split("宣纸白").join("暖米白");
}
function d4Surgery(t) {
  // 摘除③层否定式纸纹禁令三处(清单句+线描段禁令+成片段禁令;逐字=05 库常量A)
  const cuts = [
    "禁用表面观感（若占主导则拒收）：揉皱纸纹、波纹、横向纤维条、纸浆网纹、摩尔纹、满幅噪点、实色区水波噪点、扫描纸纹滤镜、发黄旧纸、任何强纸纹褶皱纹样。",
    "禁止用揉皱纸纹、纤维条、波纹或满幅噪点覆盖伪造工艺。",
    "底色保持浅净哑光平涂——不得有揉皱纸纹、纤维条、波纹、纸浆网纹、满幅噪点。",
  ];
  let out = t;
  for (const c of cuts) {
    if (!out.includes(c)) throw new Error(`D4 源句未命中:${c.slice(0, 20)}`);
    out = out.replace(c, "");
  }
  return out;
}

// ── API 图手术 ──────────────────────────────────────────────────
function loadBase(kind) {
  return JSON.parse(readFileSync(`${TMP}/api-${kind}.json`, "utf8"));
}
function makeArm(name, kind, opts) {
  const d = loadBase(kind);
  d["7"].inputs.seed = 0;
  d["7"].inputs.steps = opts.fast ? 6 : 40;
  d["7"].inputs.model = opts.fast ? ["31", 0] : ["1", 0];
  if (opts.te === "official") d["2"].inputs.clip_name = OFFICIAL_TE;
  d["5"].inputs.width = kind === "scene" ? SCENE_W : PERSON_W;
  d["5"].inputs.height = kind === "scene" ? SCENE_H : PERSON_H;
  d["9"].inputs.filename_prefix = `ablation-0925/${name}`;
  if (opts.frozenText) {
    d["40:142"].inputs.prompt = opts.frozenText; // 字面直贴,绕开 [141]
  }
  if (opts.peOn) {
    d["141"].inputs.switch = true;
    d["140"].inputs.prompt = opts.seedPrompt;
  }
  // 清理不可达节点无必要:引擎按输出可达集执行
  return { name, graph: d, opts };
}

// ── 引擎直排 ────────────────────────────────────────────────────
async function postPrompt(arm) {
  const cid = randomUUID();
  const r = await fetch(`${ENGINE}/prompt`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: arm.graph, client_id: cid }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.prompt_id) throw new Error(`排队失败 ${arm.name}: ${JSON.stringify(j).slice(0, 300)}`);
  return j.prompt_id;
}

async function waitHistory(pid, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const h = await (await fetch(`${ENGINE}/history/${pid}`)).json();
      const e = h[pid];
      if (e) {
        const st = e.status?.status_str || "";
        if (st === "error") {
          return { error: `execution_error: ${JSON.stringify(e.status?.messages || []).slice(0, 1500)}` };
        }
        const imgs = [];
        for (const o of Object.values(e.outputs || {})) if (o.images) imgs.push(...o.images);
        let text27 = null;
        const t = e.outputs?.["27"]?.text;
        if (Array.isArray(t) && t.length) text27 = String(t[t.length - 1]);
        if (imgs.length) return { imgs, text27, status: st, secs: Math.round((Date.now() - t0) / 1000) };
        if (st === "success" && !imgs.length) {
          // success 但无图=验证阶段拒了输出(validation error 在 messages 里,状态仍 success)
          const msgs = JSON.stringify(e.status?.messages || []);
          const vErr = /Failed to validate prompt[^\]]*/.exec(msgs);
          return { error: `success 无图(输出被验证拒绝):${vErr ? vErr[0].slice(0, 400) : msgs.slice(0, 400)}` };
        }
      }
    } catch (e) { /* transient */ }
    await sleep(4000);
  }
  return { error: `history 超时 ${timeoutMs / 1000}s` };
}

async function fetchView(img) {
  const q = `filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || "")}&type=${encodeURIComponent(img.type || "output")}`;
  const r = await fetch(`${ENGINE}/view?${q}`);
  if (!r.ok) throw new Error(`/view ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

function pngMagic(b) { return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47; }

async function runArm(arm, timeoutMs) {
  log(`── 排队 ${arm.name} (fast=${arm.opts.fast ? 6 : 40}步, te=${arm.opts.te || "heretic"}, pe=${arm.opts.peOn ? "on" : "off"})`);
  const t0 = Date.now();
  const pid = await postPrompt(arm);
  const res = await waitHistory(pid, timeoutMs);
  const rec = { name: arm.name, pid, wallSec: Math.round((Date.now() - t0) / 1000) };
  if (res.error) {
    rec.ok = false; rec.error = res.error;
    log(`✗ ${arm.name}: ${res.error.slice(0, 300)}`);
    appendFileSync(LOG, JSON.stringify(rec) + "\n");
    return rec;
  }
  const saveImg = res.imgs.find((i) => (i.type || "output") === "output" && /\.png$/i.test(i.filename)) || res.imgs[0];
  const buf = await fetchView(saveImg);
  const ok = pngMagic(buf) && buf.length > 50_000;
  writeFileSync(join(OUT_DIR, `${arm.name}.png`), buf);
  // 当次提示词:PE 臂=PE 产出文([27]);冻文/手术臂=注入文本;直写臂=装配全文([27])
  const effText = arm.opts.peOn ? res.text27 : (arm.opts.frozenText || res.text27);
  writeFileSync(join(OUT_DIR, `${arm.name}.txt`), effText || "(未捕获)");
  rec.ok = ok; rec.bytes = buf.length; rec.engineFile = saveImg.filename;
  rec.effTextLen = effText ? effText.length : 0; rec.text27Len = res.text27 ? res.text27.length : 0;
  log(`✓ ${arm.name} ${(buf.length / 1024 / 1024).toFixed(1)}MB ${res.secs}s 引擎文件=${saveImg.filename} 生效文本=${rec.effTextLen}字`);
  appendFileSync(LOG, JSON.stringify(rec) + "\n");
  return { ...rec, text27: res.text27 };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const alive = await (await fetch(`${ENGINE}/system_stats`, { signal: AbortSignal.timeout(8000) })).json();
  log("引擎就绪:", alive.system?.comfyui_version);

  const T_FAST = 1200_000, T_SLOW = 2100_000, T_PE = 1500_000;

  // ① D1 先行(锚+D 系文本源)
  const d1 = await runArm(makeArm("人物_直写D1_Normal", "person", { fast: false, te: "official" }), T_SLOW);
  if (!d1.ok) { log("D1 失败,D 系手术无源,中止"); process.exit(1); }
  const d1Full = d1.text27;
  log(`D1 装配全文 ${d1Full.length} 字符(手术源)`);
  writeFileSync(`${TMP}/d1-full-text.txt`, d1Full);

  // ② A/B/C 系(场景;heretic 组先)
  await runArm(makeArm("场景_PE复现A0_Fast", "scene", { fast: true, peOn: true, seedPrompt: A0_SEED }), T_PE);
  await runArm(makeArm("场景_PE反噪C1_Fast", "scene", { fast: true, peOn: true, seedPrompt: C1_SEED }), T_PE);
  await runArm(makeArm("场景_冻文A1_Fast", "scene", { fast: true, frozenText: FROZEN }), T_FAST);
  await runArm(makeArm("场景_冻文A2_Normal", "scene", { fast: false, frozenText: FROZEN }), T_SLOW);
  await runArm(makeArm("场景_删纹理句B1_Fast", "scene", { fast: true, frozenText: buildB1() }), T_FAST);
  await runArm(makeArm("场景_换描述B2_Fast", "scene", { fast: true, frozenText: buildB2() }), T_FAST);
  await runArm(makeArm("场景_冻文A3_原生TE_Fast", "scene", { fast: true, frozenText: FROZEN, te: "official" }), T_FAST);

  // ③ D 系手术臂(原生 TE)
  const d2t = d2Surgery(d1Full), d3t = d3Surgery(d1Full), d4t = d4Surgery(d1Full);
  writeFileSync(`${TMP}/d2-text.txt`, d2t); writeFileSync(`${TMP}/d3-text.txt`, d3t); writeFileSync(`${TMP}/d4-text.txt`, d4t);
  await runArm(makeArm("人物_矿物改D2_Normal", "person", { fast: false, te: "official", frozenText: d2t }), T_SLOW);
  await runArm(makeArm("人物_矿物改D2_Fast", "person", { fast: true, te: "official", frozenText: d2t }), T_FAST);
  await runArm(makeArm("人物_宣纸白改D3_Normal", "person", { fast: false, te: "official", frozenText: d3t }), T_SLOW);
  await runArm(makeArm("人物_宣纸白改D3_Fast", "person", { fast: true, te: "official", frozenText: d3t }), T_FAST);
  await runArm(makeArm("人物_摘否定清单D4_Normal", "person", { fast: false, te: "official", frozenText: d4t }), T_SLOW);

  log("════ 直排阶段完成(13 臂)════");
  process.exit(0);
}

main().catch((e) => { console.error("驱动失败:", e.message); process.exit(1); });
