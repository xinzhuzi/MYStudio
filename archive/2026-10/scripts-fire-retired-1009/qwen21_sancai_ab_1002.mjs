#!/usr/bin/env node
/**
 * Q2-1 三采一条龙 A/B 实弹床(Trellis 10-02)
 *
 * 验证问题:三采(4步快档粗出 → 25步编辑式精修 → SeedVR2 放大2K)在 Q2-1
 * (生修合一,无 denoise 重绘,编辑式精修)上是否可行有效。
 *
 * 三臂(seed 恒 424242,t2i 提示词/精修指令逐字):
 *   A1 对照·直出40步   纯 t2i(TE res=1024,KSampler 40步) → sancai-a1-direct.png
 *   A2 对照·三采前两段 ①4步 T8 快档粗出 → sancai-a2a-rough.png
 *                      ②粗出上传走编辑链(TE res=0 images.image_1,KSampler 25步,
 *                        指令=英文精修指令) → sancai-a2b-refined.png
 *   A3 主角·一条龙     A2b 产物上传喂 SeedVR2 三件(res=2048) → sancai-a3-upscaled.png
 *
 * 配方出处(实战验证,必守):
 *   - TE 直排:b4_duipai_run_0930 / qi21_consistency_lora_ab_1001.mjs:146(vae 必接、
 *     autogrow 图槽全名 images.image_1、latent 槽2直排采样器、cfg=1/euler/simple/denoise=1)
 *   - 纯 t2i 无参考图:qwen21_t2i_seedvr2_fire_1002.mjs:162(TE 不接 images.*,res=1024)
 *   - SeedVR2 三件:qwen21_t2i_seedvr2_fire_1002.mjs:173-185(件内真名
 *     seedvr2_7b_sharp_fp8_e4m3fn + ema_vae_fp16;VAE 必须 tiled 512/160——10-02 实测
 *     不分块在 MPS 确定性杀引擎×2)
 *
 * 引擎纪律:动态发现(pgrep ComfyUI/main.py → lsof 监听口 → curl /object_info 探活)
 * 复用绝不启停;全无/中途死掉才按已验证配方自拉 17001;收尾只停自己 pid。
 * 产物:apps/output/sancai-ab-1002/{四png,report.json,metrics.json,EXIT.json}
 */
import { spawn, spawnSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const EH = "/Users/zhengbingjin/Library/Application Support/漫影工作室/comfyui";
const REPO = "/Users/zhengbingjin/Project/Github/MYStudio";
const OUT = path.join(REPO, "apps/output/sancai-ab-1002");
const ENGINE_LOG = "/tmp/comfyui-sancai-ab-1002.log";
const SELF_PID_FILE = "/tmp/comfyui-sancai-ab-1002.pid";
const SEED = 424242;

// 提示词逐字(任务口径)
const T2I_PROMPT =
  "水墨山水立轴:远山如黛层峦叠嶂,中景孤亭临溪,近景苍松虬枝,松针根根分明,亭台飞檐斗拱结构清晰,溪水以留白与飞白笔法写出,墨色浓淡干湿五色俱全,宣纸质感,传统国画竖构图,笔触细节丰富";
const REFINE_PROMPT =
  "Refine this image: enhance fine details and textures, sharpen edges and brushwork. Keep the composition, subjects, poses, colors and style exactly unchanged.";

fs.mkdirSync(OUT, { recursive: true });
const report = { runs: [], uploads: {}, engine: {}, prompts: { t2i: T2I_PROMPT, refine: REFINE_PROMPT }, seed: SEED, startedAt: new Date().toISOString() };
let BASE = null;
let selfChild = null;
let selfStarted = false;

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

// ── 引擎发现与生命周期 ──
function findRunningEnginePorts() {
  try {
    const pids = execSync("pgrep -f 'ComfyUI/main.py'").toString().trim().split("\n").filter(Boolean);
    const ports = [];
    for (const pid of pids) {
      try {
        const out = execSync(`lsof -nP -iTCP -sTCP:LISTEN -a -p ${pid} 2>/dev/null`).toString();
        for (const m of out.matchAll(/127\.0\.0\.1:(\d{4,5})\s/g)) ports.push(Number(m[1]));
      } catch {}
    }
    return [...new Set(ports)];
  } catch {
    return [];
  }
}
async function probe(port, ms = 4000) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/object_info`, { signal: AbortSignal.timeout(ms) });
    if (r.ok) return port;
  } catch {}
  return null;
}
async function ensureEngine() {
  for (const p of [...findRunningEnginePorts(), 17001, 17000]) {
    const hit = await probe(p);
    if (hit) {
      BASE = `http://127.0.0.1:${hit}`;
      report.engine = { port: hit, reused: true };
      log(`引擎复用 port ${hit}(App 托管,绝不启停)`);
      return hit;
    }
  }
  log("无引擎,自拉 17001(已验证配方)...");
  selfChild = spawn(
    `${EH}/venv/bin/python`,
    [
      `${EH}/ComfyUI/main.py`,
      "--listen", "127.0.0.1", "--port", "17001",
      "--enable-manager", "--use-pytorch-cross-attention",
      "--gpu-only", "--reserve-vram", "16",
      "--input-directory", `${EH}/input`,
      "--output-directory", `${EH}/output`,
    ],
    {
      detached: true,
      stdio: ["ignore", fs.openSync(ENGINE_LOG, "a"), fs.openSync(ENGINE_LOG, "a")],
      env: { ...process.env, MYSTUDIO_COMFYUI_HOME: EH },
    },
  );
  selfChild.unref();
  selfStarted = true;
  fs.writeFileSync(SELF_PID_FILE, String(selfChild.pid));
  report.engine = { port: 17001, reused: false, pid: selfChild.pid };
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    if (await probe(17001, 4000)) {
      log(`自拉引擎就绪 pid=${selfChild.pid}`);
      BASE = `http://127.0.0.1:17001`;
      return 17001;
    }
    if (i % 10 === 9) log(`引擎启动中... ${(i + 1) * 3}s`);
  }
  throw new Error("自拉引擎 240s 未就绪,日志在 " + ENGINE_LOG);
}
async function stopSelfEngine() {
  if (!selfStarted || !selfChild) return;
  try {
    process.kill(selfChild.pid, "SIGTERM");
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        process.kill(selfChild.pid, 0);
      } catch {
        log(`自拉引擎已停 pid=${selfChild.pid}`);
        report.engine.stopped = true;
        return;
      }
    }
    process.kill(selfChild.pid, "SIGKILL");
    report.engine.stopped = "sigkilled";
    log("自拉引擎 SIGKILL 兜底");
  } catch (e) {
    log(`停引擎异常: ${e.message}`);
  }
}

// ── 三段构图(API 直排)──
function loaders() {
  return {
    unet: { class_type: "UNETLoader", inputs: { unet_name: "qwen_image_2.1_bf16.safetensors", weight_dtype: "default" } },
    clip: { class_type: "CLIPLoader", inputs: { clip_name: "qwen3vl_8b_bf16_heretic.safetensors", type: "qwen_image", device: "default" } },
    vae: { class_type: "VAELoader", inputs: { vae_name: "qwen_image_2.1_vae_bf16.safetensors" } },
    cache: { class_type: "QwenImage21Cache", inputs: { model: ["unet", 0], device: "auto", dtype: "default" } },
  };
}

// 纯 t2i:funacc=true → 4步 T8 快档(A2a);false → KSampler steps 步(A1 直出40步)
function buildT2i(id, steps, funacc) {
  const nodes = loaders();
  nodes.te = {
    class_type: "TextEncodeQwenImage21",
    inputs: { clip: ["clip", 0], vae: ["vae", 0], prompt: T2I_PROMPT, negative_prompt: "", resolution: 1024 },
  };
  if (funacc) {
    nodes.t8 = {
      class_type: "T8QwenImage21FunAccPDD4Step",
      inputs: { model: ["cache", 0], positive: ["te", 0], latent_image: ["te", 2], model_file: "Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors", seed: SEED },
    };
    nodes.dec = { class_type: "VAEDecode", inputs: { samples: ["t8", 0], vae: ["vae", 0] } };
  } else {
    nodes.ks = {
      class_type: "KSampler",
      inputs: { model: ["cache", 0], positive: ["te", 0], negative: ["te", 1], latent_image: ["te", 2], seed: SEED, steps, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1 },
    };
    nodes.dec = { class_type: "VAEDecode", inputs: { samples: ["ks", 0], vae: ["vae", 0] } };
  }
  nodes.save = { class_type: "SaveImage", inputs: { images: ["dec", 0], filename_prefix: `sancai-ab-1002/${id}` } };
  return nodes;
}

// 编辑式精修(A2b):粗出上传图 → TE res=0 images.image_1 → KSampler 25步
function buildEdit(uploadedName) {
  const nodes = loaders();
  nodes.inimg = { class_type: "LoadImage", inputs: { image: uploadedName } };
  nodes.te = {
    class_type: "TextEncodeQwenImage21",
    inputs: { clip: ["clip", 0], vae: ["vae", 0], prompt: REFINE_PROMPT, negative_prompt: "", resolution: 0, "images.image_1": ["inimg", 0] },
  };
  nodes.ks = {
    class_type: "KSampler",
    inputs: { model: ["cache", 0], positive: ["te", 0], negative: ["te", 1], latent_image: ["te", 2], seed: SEED, steps: 25, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1 },
  };
  nodes.dec = { class_type: "VAEDecode", inputs: { samples: ["ks", 0], vae: ["vae", 0] } };
  nodes.save = { class_type: "SaveImage", inputs: { images: ["dec", 0], filename_prefix: "sancai-ab-1002/sancai-a2b-refined" } };
  return nodes;
}

// SeedVR2 放大(A3):精修图上传 → 三件(件内真值,VAE tiled 512/160 必守)
function buildUpscale(uploadedName) {
  return {
    inimg: { class_type: "LoadImage", inputs: { image: uploadedName } },
    dit: {
      class_type: "SeedVR2LoadDiTModel",
      inputs: { model: "seedvr2_7b_sharp_fp8_e4m3fn.safetensors", device: "mps", blocks_to_swap: 0, swap_io_components: false, offload_device: "none", cache_model: false, attention_mode: "sdpa" },
    },
    svae: {
      class_type: "SeedVR2LoadVAEModel",
      inputs: { model: "ema_vae_fp16.safetensors", device: "mps", encode_tiled: true, encode_tile_size: 512, encode_tile_overlap: 160, decode_tiled: true, decode_tile_size: 512, decode_tile_overlap: 160, tile_debug: "false", offload_device: "none", cache_model: false },
    },
    up: {
      class_type: "SeedVR2VideoUpscaler",
      inputs: { image: ["inimg", 0], dit: ["dit", 0], vae: ["svae", 0], seed: SEED, resolution: 2048, max_resolution: 4096, batch_size: 1, uniform_batch_size: false, color_correction: "lab", temporal_overlap: 0, prepend_frames: 0, offload_device: "none", enable_debug: false },
    },
    save: { class_type: "SaveImage", inputs: { images: ["up", 0], filename_prefix: "sancai-ab-1002/sancai-a3-upscaled" } },
  };
}

// ── 引擎 IO ──
async function uploadImage(localPath, remoteName) {
  const fd = new FormData();
  fd.append("image", new Blob([fs.readFileSync(localPath)], { type: "image/png" }), remoteName);
  fd.append("overwrite", "true");
  const r = await fetch(`${BASE}/upload/image`, { method: "POST", body: fd, signal: AbortSignal.timeout(60000) });
  const j = await r.json();
  if (!j.name) throw new Error("上传失败: " + JSON.stringify(j).slice(0, 300));
  log(`上传 ${path.basename(localPath)} → 引擎 ${j.name}`);
  return j.name;
}
async function queue(nodes) {
  const r = await fetch(`${BASE}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: nodes, client_id: "sancai-ab-1002" }),
    signal: AbortSignal.timeout(30000),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.prompt_id) throw new Error("排队失败: " + JSON.stringify(j).slice(0, 500));
  return j.prompt_id;
}
async function waitHistory(promptId, timeoutMs) {
  const t0 = Date.now();
  let deadStreak = 0;
  while (Date.now() - t0 < timeoutMs) {
    const r = await fetch(`${BASE}/history/${promptId}`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!r) {
      deadStreak += 1;
      if (deadStreak >= 5) return { engineDead: true };
    } else {
      deadStreak = 0;
      if (r.ok) {
        const h = await r.json().catch(() => null);
        const e = h && h[promptId];
        if (e && e.status) {
          if (e.status.status_str === "error") return { error: JSON.stringify(e.status.messages).slice(0, 1500) };
          if (e.status.completed) return { entry: e };
        }
      }
    }
    await new Promise((r2) => setTimeout(r2, 3000));
  }
  return { timeout: true };
}
async function fetchImage(remote) {
  const v = await fetch(
    `${BASE}/view?filename=${encodeURIComponent(remote.filename)}&subfolder=${encodeURIComponent(remote.subfolder || "")}&type=${remote.type || "output"}`,
    { signal: AbortSignal.timeout(120000) },
  );
  return Buffer.from(await v.arrayBuffer());
}

async function runArm(id, label, buildNodes, timeoutMs, outName) {
  const t0 = Date.now();
  log(`▶ ${id} 排队(${label})`);
  let pid;
  try {
    pid = await queue(buildNodes());
  } catch (e) {
    log(`  ${id} 排队失败(${e.message}),引擎保活重试`);
    await ensureEngine();
    pid = await queue(buildNodes());
  }
  let res = await waitHistory(pid, timeoutMs);
  if (res.timeout || res.error || res.engineDead) {
    log(`  ${id} 异常(${res.timeout ? "超时" : res.engineDead ? "引擎失联" : res.error}),保活重试一次`);
    await ensureEngine();
    const pid2 = await queue(buildNodes());
    res = await waitHistory(pid2, timeoutMs);
    if (res.timeout || res.error || res.engineDead) throw new Error(`${id} 两轮均失败: ${res.error || (res.engineDead ? "引擎失联" : "超时")}`);
    pid = pid2;
  }
  const imgs = [];
  for (const nodeOut of Object.values(res.entry.outputs || {})) {
    for (const im of nodeOut.images || []) imgs.push(im);
  }
  if (!imgs[0]) throw new Error(`${id} 无出图`);
  const local = path.join(OUT, outName);
  fs.writeFileSync(local, await fetchImage(imgs[0]));
  const dur = Math.round((Date.now() - t0) / 1000);
  report.runs.push({ id, label, prompt_id: pid, seconds: dur, output: local, remote: imgs[0] });
  log(`✔ ${id} 完成 ${dur}s → ${outName}`);
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  return local;
}

async function main() {
  await ensureEngine();

  // 前置门:七节点在册 + DiT combo 件内真名
  const oi = await (await fetch(`${BASE}/object_info`, { signal: AbortSignal.timeout(60000) })).json();
  for (const k of ["TextEncodeQwenImage21", "T8QwenImage21FunAccPDD4Step", "QwenImage21Cache", "KSampler", "SeedVR2LoadDiTModel", "SeedVR2LoadVAEModel", "SeedVR2VideoUpscaler"]) {
    if (!oi[k]) throw new Error(`节点缺注册: ${k}`);
  }
  const ditSpec = oi.SeedVR2LoadDiTModel.input.required.model;
  const ditCombo = Array.isArray(ditSpec[0]) ? ditSpec[0] : ditSpec[1]?.options || [];
  if (!ditCombo.includes("seedvr2_7b_sharp_fp8_e4m3fn.safetensors")) throw new Error("DiT combo 未见 seedvr2_7b_sharp_fp8_e4m3fn.safetensors");
  log(`前置门过:引擎${report.engine.port} / 七节点在册 / DiT真名在combo(${ditCombo.length}项)`);

  // A1 直出40步(对照锚)
  const a1 = await runArm("a1-direct", "对照·纯t2i直出40步", () => buildT2i("sancai-a1-direct", 40, false), 1200000, "sancai-a1-direct.png");
  // A2a 三采①·4步快档粗出
  const a2a = await runArm("a2a-rough", "三采①·4步T8快档粗出", () => buildT2i("sancai-a2a-rough", 4, true), 600000, "sancai-a2a-rough.png");
  // A2b 三采②·25步编辑式精修(粗出上传喂编辑链)
  report.uploads.a2a = await uploadImage(a2a, "sancai-a2a-upload.png");
  await runArm("a2b-refined", "三采②·25步编辑精修", () => buildEdit(report.uploads.a2a), 900000, "sancai-a2b-refined.png");
  // A3 主角·SeedVR2 放大2K(精修图上传,首次载权重,900s)
  report.uploads.a2b = await uploadImage(path.join(OUT, "sancai-a2b-refined.png"), "sancai-a2b-upload.png");
  await runArm("a3-upscaled", "三采③·SeedVR2放大2048", () => buildUpscale(report.uploads.a2b), 900000, "sancai-a3-upscaled.png");

  // ── 指标后处理(venv python:PIL+numpy)──
  const metricsPy = path.join(OUT, "_metrics.py");
  fs.writeFileSync(metricsPy, METRICS_PY);
  const mres = spawnSync(`${EH}/venv/bin/python`, [metricsPy], { encoding: "utf8", timeout: 300000 });
  if (mres.status !== 0) {
    log("指标脚本异常: " + (mres.stderr || "").slice(0, 600));
    throw new Error("指标计算失败");
  }
  log("指标落盘 metrics.json");
  fs.writeFileSync(path.join(OUT, "EXIT.json"), JSON.stringify({ exit: 0, finishedAt: new Date().toISOString(), runs: report.runs.length }));
  console.log(mres.stdout.trim());
}

// 指标:①每张唯一色/拉普拉斯方差÷像素(两位小数)/尺寸,A3 双口径(原生2048+双线性缩回短边1024)
//      ②构图三对:相位相关位移@512宽灰度(汉宁窗)+梯度NCC ③逐段耗时在 report.json
const METRICS_PY = `
import json
from PIL import Image
import numpy as np
import os

out_dir = ${JSON.stringify(OUT)}
FILES = {
    "a1_direct": "sancai-a1-direct.png",
    "a2a_rough": "sancai-a2a-rough.png",
    "a2b_refined": "sancai-a2b-refined.png",
    "a3_upscaled": "sancai-a3-upscaled.png",
}
imgs = {k: Image.open(os.path.join(out_dir, f)).convert("RGB") for k, f in FILES.items()}

def lap_energy(arr):
    # 3x3 拉普拉斯核 [0,1,0;1,-4,1;0,1,0],方差÷像素数,两位小数
    g = arr.astype(np.float32)
    L = np.zeros_like(g)
    L[1:-1, 1:-1] = g[1:-1, 2:] + g[1:-1, :-2] + g[2:, 1:-1] + g[:-2, 1:-1] - 4 * g[1:-1, 1:-1]
    return round(float(np.var(L)) / (g.shape[0] * g.shape[1]), 2)

def unique_colors(im):
    return len(set(im.getdata()))

def resize_short_side(im, s):
    w, h = im.size
    if w <= h:
        return im.resize((s, round(h * s / w)), Image.BILINEAR)
    return im.resize((round(w * s / h), s), Image.BILINEAR)

def gray512(im, force_square=False):
    w, h = im.size
    if force_square:
        a = np.asarray(im.convert("L").resize((512, 512), Image.BILINEAR), dtype=np.float32)
    else:
        a = np.asarray(im.convert("L").resize((512, round(h * 512 / w)), Image.BILINEAR), dtype=np.float32)
    return a

def phase_shift(a, b):
    # 汉宁窗相位相关:b 相对 a 的位移 (dy,dx)
    H, W = a.shape
    win = np.outer(np.hanning(H), np.hanning(W)).astype(np.float32)
    A = np.fft.fft2(a * win)
    B = np.fft.fft2(b * win)
    R = A * np.conj(B)
    R /= np.abs(R) + 1e-9
    r = np.fft.ifft2(R).real
    dy, dx = np.unravel_index(np.argmax(r), r.shape)
    dy, dx = int(dy), int(dx)
    if dy > H // 2:
        dy -= H
    if dx > W // 2:
        dx -= W
    return dy, dx

def grads(a):
    gx = np.zeros_like(a)
    gx[:, 1:-1] = (a[:, 2:] - a[:, :-2]) / 2.0
    gy = np.zeros_like(a)
    gy[1:-1, :] = (a[2:, :] - a[:-2, :]) / 2.0
    return gx, gy

def ncc(x, y):
    x = x - x.mean()
    y = y - y.mean()
    d = np.sqrt((x * x).sum()) * np.sqrt((y * y).sum())
    return float((x * y).sum() / d) if d > 0 else 0.0

def compose_pair(im_ref, im_mov):
    # @512宽灰度;高差>16px(不同生成树纵横比漂移)→ 双图 512×512 拉齐并记 note
    notes = []
    a, b = gray512(im_ref), gray512(im_mov)
    if abs(a.shape[0] - b.shape[0]) > 16:
        a, b = gray512(im_ref, True), gray512(im_mov, True)
        notes.append(f"aspect drift {im_ref.size} vs {im_mov.size} -> 512x512 both")
    else:
        H = min(a.shape[0], b.shape[0])
        a, b = a[:H], b[:H]
    dy, dx = phase_shift(a, b)
    agx, agy = grads(a)
    bgx, bgy = grads(b)
    gncc = round((ncc(agx, bgx) + ncc(agy, bgy)) / 2, 4)
    return {"shiftPx": f"dx={dx},dy={dy}", "gradNcc": gncc, "h512": int(a.shape[0]), "notes": notes}

res = {"perImage": {}, "blackGate": {}, "a3At1024": {}, "composition": {}, "notes": []}

# ① 每张指标 + 黑图门禁(唯一色≥1000)
for k, im in imgs.items():
    g = np.asarray(im.convert("L"), dtype=np.float32)
    uc = unique_colors(im)
    res["perImage"][k] = {"size": f"{im.size[0]}x{im.size[1]}", "uniqueColors": uc, "laplacianEnergy": lap_energy(g)}
    res["blackGate"][k] = uc >= 1000

# A3 双口径:缩回短边1024(与 A1 同口径)再算
a3_1024 = resize_short_side(imgs["a3_upscaled"], 1024)
a3_1024_g = np.asarray(a3_1024.convert("L"), dtype=np.float32)
res["a3At1024"] = {"size": f"{a3_1024.size[0]}x{a3_1024.size[1]}", "uniqueColors": unique_colors(a3_1024), "laplacianEnergy": lap_energy(a3_1024_g)}

# ② 构图三对
res["composition"]["refined_vs_rough"] = compose_pair(imgs["a2a_rough"], imgs["a2b_refined"])       # 第二段保构图
res["composition"]["sancai_vs_direct"] = compose_pair(imgs["a1_direct"], a3_1024)                    # 整链对基线(A3 缩回1024 同口径)
res["composition"]["upscaled_vs_refined"] = compose_pair(imgs["a2b_refined"], a3_1024)               # 第三段保真(A3 缩回1024 同口径)

json.dump(res, open(os.path.join(out_dir, "metrics.json"), "w"), ensure_ascii=False, indent=1)
print(json.dumps(res, ensure_ascii=False))
`;

try {
  await main();
  await stopSelfEngine(); // 只停自己拉起的 pid;复用引擎不碰
  process.exit(0);
} catch (e) {
  report.fatal = e.message;
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, "EXIT.json"), JSON.stringify({ exit: 1, error: e.message, finishedAt: new Date().toISOString() }));
  console.error("FATAL:", e.message);
  await stopSelfEngine();
  process.exit(1);
}
