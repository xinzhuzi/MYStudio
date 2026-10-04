#!/usr/bin/env node
/**
 * colorline-ab-shots-1004.mjs — 道劫 qi21 多彩行 A/B 三发直排(实弹)
 *
 * 用途:验证职责句(new)vs 台账句(old)多彩行改写不影响出图 + 概念型定锚图。
 * 直写 API 形态(PE 关——不含任何 PE 改写节点,正槽=装配文全文,负槽=negative.txt),
 * 采样=Fun-Acc 4 步(T8QwenImage21FunAccPDD4Step,与产线默认档同形:该节点物理无 negative 槽,
 * 负文进 TextEncodeQwenImage21.negative_prompt 槽)。
 * new/old 同 seed=42 同参数 896x1152(3:4 人物);gainian 1344x768(16:9 概念)。
 *
 * 参考:apps/build/scripts/daojie-t2i-app-e2e.mjs 的 /history 等终态+60s 心跳+/view 取证
 * +引擎家 output/ 文件直读兜底+PNG 魔数>50KB 校验骨架。
 * 用法:node apps/build/scripts/colorline-ab-shots-1004.mjs [engineBase]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const ENGINE_BASE = process.argv[2] || "http://127.0.0.1:17321";
const AMMO = "/Users/zhengbingjin/Project/Github/MYStudio/apps/output/colorline-ab";
const ENGINE_OUTPUT = join(homedir(), "Library/Application Support/漫影工作室/comfyui/output");
const CLIENT_ID = "colorline-ab-1004";
const FUNACC_FILE = "Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors";

const SHOTS = [
  { key: "new", txt: "new.txt", w: 896, h: 1152, seed: 42 },
  { key: "old", txt: "old.txt", w: 896, h: 1152, seed: 42 },
  { key: "gainian", txt: "gainian.txt", w: 1344, h: 768, seed: 42 },
];

const UNET = "qwen_image_2.1_bf16.safetensors";
const CLIP = "qwen3vl_8b_bf16_heretic.safetensors";
const VAE = "qwen_image_2.1_vae_bf16.safetensors";

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function buildPrompt(shot, positive, negative) {
  return {
    "1": { class_type: "UNETLoader", inputs: { unet_name: UNET, weight_dtype: "default" }, _meta: { title: "[1] UNETLoader" } },
    "2": { class_type: "CLIPLoader", inputs: { clip_name: CLIP, type: "qwen_image", device: "default" }, _meta: { title: "[2] 主TE·CLIPLoader" } },
    "3": { class_type: "VAELoader", inputs: { vae_name: VAE }, _meta: { title: "[3] VAELoader" } },
    "4": { class_type: "EmptyLatentImage", inputs: { width: shot.w, height: shot.h, batch_size: 1 }, _meta: { title: "[4] EmptyLatentImage" } },
    "4015": { class_type: "TextEncodeQwenImage21", inputs: { clip: ["2", 0], prompt: positive, negative_prompt: negative, resolution: 1024 }, _meta: { title: "[4015] 主编码·直写(PE关)" } },
    "7013": { class_type: "T8QwenImage21FunAccPDD4Step", inputs: { model: ["1", 0], positive: ["4015", 0], latent_image: ["4", 0], model_file: FUNACC_FILE, seed: shot.seed }, _meta: { title: "[7013] FunAcc4步·直排" } },
    "5": { class_type: "VAEDecode", inputs: { samples: ["7013", 0], vae: ["3", 0] }, _meta: { title: "[5] VAEDecode" } },
    "8": { class_type: "SaveImage", inputs: { images: ["5", 0], filename_prefix: `colorline-ab/${shot.key}` }, _meta: { title: "[8] SaveImage" } },
  };
}

async function jf(path, opts) {
  const r = await fetch(`${ENGINE_BASE}${path}`, { signal: AbortSignal.timeout(15_000), ...opts });
  const body = await r.text();
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}: ${body.slice(0, 500)}`);
  try { return JSON.parse(body); } catch { return body; }
}

async function preflight() {
  const oi = await jf("/object_info");
  const need = [
    ["UNETLoader", UNET, (d) => d.input.required.unet_name[0]],
    ["CLIPLoader", CLIP, (d) => d.input.required.clip_name[0]],
    ["VAELoader", VAE, (d) => d.input.required.vae_name[0]],
    ["T8QwenImage21FunAccPDD4Step", FUNACC_FILE, (d) => d.input.required.model_file[0]],
    ["TextEncodeQwenImage21", null, null],
    ["EmptyLatentImage", null, null],
    ["VAEDecode", null, null],
    ["SaveImage", null, null],
  ];
  for (const [node, file, combo] of need) {
    if (!oi[node]) throw new Error(`preflight: 引擎缺节点 ${node}`);
    if (file && !combo(oi[node]).includes(file)) throw new Error(`preflight: ${node} 缺文件 ${file}`);
  }
  log(`preflight 绿:8 节点在册,四件权重名命中(FunAcc=${FUNACC_FILE})`);
}

async function queueCounts() {
  const q = await jf("/queue");
  return { run: (q.queue_running || []).length, pend: (q.queue_pending || []).length };
}

function pngDims(buf) {
  if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

async function run() {
  const t0 = Date.now();
  await preflight();
  const negative = readFileSync(join(AMMO, "negative.txt"), "utf8").trim();
  const prompts = {};
  for (const shot of SHOTS) {
    const positive = readFileSync(join(AMMO, shot.txt), "utf8").trim();
    prompts[shot.key] = { shot, positive, prompt: buildPrompt(shot, positive, negative) };
  }
  // 直写证:new/old 提示词唯一差异=多彩行句式(运行时打印差分摘要)
  const [nLines, oLines] = [prompts.new.positive.split("\n"), prompts.old.positive.split("\n")];
  const diffIdx = nLines.map((l, i) => [i, l !== oLines[i]]).filter(([, d]) => d).map(([i]) => i);
  log(`直写差分:new/old 共 ${nLines.length} 行,差异行=${JSON.stringify(diffIdx)}(期望仅第 7 行多彩行)`);
  if (diffIdx.length !== 1 || diffIdx[0] !== 6) throw new Error(`弹药差分异常:差异行=${JSON.stringify(diffIdx)},非唯一第 7 行,停发`);

  const ids = {};
  for (const { key } of SHOTS) {
    const r = await jf("/prompt", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompts[key].prompt, client_id: CLIENT_ID }),
    });
    ids[key] = r.prompt_id;
    log(`已提交 ${key} prompt_id=${r.prompt_id.slice(0, 8)} (${prompts[key].shot.w}x${prompts[key].shot.h} seed=${prompts[key].shot.seed})`);
  }

  const done = {};
  const BUDGET_MS = 150 * 60_000; // 排队含兄弟会话 1h 重活,宽预算
  let lastBeat = 0;
  while (Object.keys(done).length < SHOTS.length) {
    if (Date.now() - t0 > BUDGET_MS) throw new Error(`预算耗尽(${BUDGET_MS / 60_000}min),完成=${Object.keys(done)}`);
    await new Promise((r) => setTimeout(r, 10_000));
    const h = await jf("/history");
    for (const { key } of SHOTS) {
      if (done[key]) continue;
      const rec = h[ids[key]];
      if (!rec || !rec.status) continue;
      const st = rec.status.status_str;
      if (st === "success") {
        const imgs = rec.outputs?.["8"]?.images || [];
        if (!imgs.length) { done[key] = { ok: false, why: "success 但 outputs 无图" }; continue; }
        const img = imgs[0];
        let buf = null;
        try {
          const r = await fetch(`${ENGINE_BASE}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || "")}&type=${encodeURIComponent(img.type || "output")}`, { signal: AbortSignal.timeout(30_000) });
          if (r.ok) buf = Buffer.from(await r.arrayBuffer());
        } catch { /* /view 失败走文件兜底 */ }
        if (!buf) {
          const p = join(ENGINE_OUTPUT, img.subfolder || "", img.filename);
          if (existsSync(p)) buf = readFileSync(p);
        }
        const dims = buf && pngDims(buf);
        const okPath = join(AMMO, `${key}.png`);
        if (buf && dims && dims.w === prompts[key].shot.w && dims.h === prompts[key].shot.h && buf.length > 50_000) {
          writeFileSync(okPath, buf);
          done[key] = { ok: true, file: img.filename, kb: Math.round(buf.length / 1024), dims };
          log(`${key} 完成:${img.filename} ${dims.w}x${dims.h} ${Math.round(buf.length / 1024)}KB → ${okPath}`);
        } else {
          done[key] = { ok: false, why: `取证异常 buf=${!!buf} dims=${JSON.stringify(dims)} bytes=${buf?.length}` };
          log(`${key} 取证异常:`, done[key].why);
        }
      } else if (st === "error") {
        const err = (rec.status.messages || []).filter((m) => m[0] === "execution_error").map((m) => m[1])[0];
        done[key] = { ok: false, why: `执行错误 node=${err?.node_id}(${err?.node_type}): ${String(err?.exception_message).slice(0, 300)}` };
        log(`${key} 执行错误:`, done[key].why);
      }
    }
    if (Date.now() - lastBeat > 60_000) {
      lastBeat = Date.now();
      const c = await queueCounts();
      log(`心跳 running=${c.run} pending=${c.pend} 完成=[${Object.keys(done)}] 用时=${Math.round((Date.now() - t0) / 1000)}s`);
    }
  }
  const fail = SHOTS.filter((s) => !done[s.key].ok);
  for (const s of SHOTS) log(`RESULT ${s.key}: ${JSON.stringify(done[s.key])}`);
  log(`总用时=${Math.round((Date.now() - t0) / 1000)}s;队列终态=${JSON.stringify(await queueCounts())}`);
  if (fail.length) { console.error("FAILED:", fail.map((s) => s.key).join(",")); process.exit(1); }
}

run().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
