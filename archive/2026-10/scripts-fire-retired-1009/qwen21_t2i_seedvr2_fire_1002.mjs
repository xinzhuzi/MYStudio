#!/usr/bin/env node
/**
 * Q2-1 t2i+SeedVR2 一条龙实弹(Trellis 10-02,单发)
 *
 * API 直排复刻 workflows/1_图片/Q2-1图像/1_文生图/qwen21-t2i-seedvr2.json 的链:
 *   t2i 段改 4步快档(T8QwenImage21FunAccPDD4Step 替代件内 KSampler40步,任务口径),
 *   其余照件内真实值:TE 直排(vae 必接/latent 槽2)、QwenImage21Cache(auto/default)、
 *   SeedVR2 三件(DiT=seedvr2_7b_sharp_fp8_e4m3fn.safetensors 件内真名 / VAE=ema_vae_fp16 /
 *   Upscaler resolution=2048 短边=max_resolution 4096/batch 1/lab 校色,槽位照件)。
 *   seed 恒 424242(纪律;件内 Upscaler 原 seed=42,偏离已在报告注明)。
 *
 * 引擎协同协议(主会话 10-02 授权 B):
 *   ①优先动态发现复用(17599 → pgrep/lsof 动态口 → 17001/17000),复用的引擎绝不启停;
 *   ②发现窗(≤6min)尽仍无引擎 → 按 7da94b9 已验证配方自拉 17001(四参数+家目录+
 *     MYSTUDIO_COMFYUI_HOME,日志 /tmp/comfyui-onestop-1002.log);自拉前末探 17001,
 *     已被兄弟实弹员占用=直接复用;
 *   ③全程自愈:引擎失联(如复用引擎被其属主收走)→ 同配方再自拉重排队一次;
 *   ④收尾只停自己拉起的 pid。
 * 前置布线:家级 models/SEEDVR2 → ComfyUI/models/SEEDVR2 软链(app yaml 键表缺 seedvr2 的
 *   补线;combo 动态刷新,勿删)。
 * 产物:apps/output/t2i-seedvr2-1002/{t2i-1024.png,upscale-2k.png,report.json,metrics.json,EXIT.json}
 */
import { spawn, spawnSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const EH = "/Users/zhengbingjin/Library/Application Support/漫影工作室/comfyui";
const REPO = "/Users/zhengbingjin/Project/Github/MYStudio";
const OUT = path.join(REPO, "apps/output/t2i-seedvr2-1002");
const SEED = 424242;
const TOTAL_TIMEOUT_MS = 1500000; // t2i 快档 + SeedVR2 放大段(任务口径:放大段轮询按 900s 量级给足,总帽 25min)
const ENGINE_LOG = "/tmp/comfyui-onestop-1002.log";
const SELF_PID_FILE = "/tmp/comfyui-onestop-1002.pid";
const DISCOVER_WINDOW_MS = 60000; // 10-02 二轮:引擎确定性崩溃排查期,发现窗缩 60s(协议窗口全空已证)

// 件内 [5] TextEncodeQwenImage21 的 prompt 逐字复刻(qwen21-t2i-seedvr2.json widgets[0])
const PROMPT =
  "A serene watercolor painting of a small wooden cabin beside a mirror-calm mountain lake at early dawn, soft mist drifting over the water, warm golden light touching the ridge line, delicate visible brush texture, muted earthy palette, tranquil and airy atmosphere.";

fs.mkdirSync(OUT, { recursive: true });
const report = { runs: [], engine: { port: null, reused: null, selfStarted: [] }, startedAt: new Date().toISOString() };
let BASE = null;
let selfChild = null;
let selfStarted = false;

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

// ── 引擎发现与生命周期 ──
function findRunningEnginePorts() {
  const ports = [];
  try {
    const pids = execSync("pgrep -f 'main.py'").toString().trim().split("\n").filter(Boolean);
    for (const pid of pids) {
      try {
        const out = execSync(`lsof -nP -iTCP -sTCP:LISTEN -a -p ${pid} 2>/dev/null`).toString();
        for (const m of out.matchAll(/127\.0\.0\.1:(\d{4,5})\s/g)) ports.push(Number(m[1]));
      } catch {}
    }
  } catch {}
  return [...new Set(ports)];
}
async function probe(port, ms = 4000) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/system_stats`, { signal: AbortSignal.timeout(ms) });
    if (r.ok) return port;
  } catch {}
  return null;
}
async function discoverEngine() {
  for (const p of [17599, ...findRunningEnginePorts(), 17001, 17000]) {
    if (await probe(p)) return p;
  }
  return null;
}

async function ensureEngine() {
  // 1) 发现窗内轮询复用(复用的引擎绝不启停)
  const t0 = Date.now();
  while (Date.now() - t0 < DISCOVER_WINDOW_MS) {
    const hit = await discoverEngine();
    if (hit) {
      BASE = `http://127.0.0.1:${hit}`;
      report.engine = { ...report.engine, port: hit, reused: true };
      log(`引擎复用 port ${hit}(协同发现,绝不启停)`);
      return hit;
    }
    await new Promise((r) => setTimeout(r, 15000));
  }
  // 2) 自拉 17001(7da94b9 已验证配方);起前末探,被占=兄弟赢了,复用
  if (await probe(17001)) {
    BASE = `http://127.0.0.1:17001`;
    report.engine = { ...report.engine, port: 17001, reused: true };
    log("17001 已被兄弟实弹员占用,直接复用");
    return 17001;
  }
  log("发现窗尽仍无引擎,自拉 17001(主会话授权 B)...");
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
  report.engine = { ...report.engine, port: 17001, reused: false, selfStarted: [selfChild.pid] };
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    if (await probe(17001, 4000)) {
      log(`自拉引擎就绪 pid=${selfChild.pid} port=17001`);
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

function buildPrompt() {
  return {
    // ── t2i 段(件内 [1][2][3][4][5][6→T8][7][8])──
    unet: { class_type: "UNETLoader", inputs: { unet_name: "qwen_image_2.1_bf16.safetensors", weight_dtype: "default" } },
    clip: { class_type: "CLIPLoader", inputs: { clip_name: "qwen3vl_8b_bf16_heretic.safetensors", type: "qwen_image", device: "default" } },
    vae: { class_type: "VAELoader", inputs: { vae_name: "qwen_image_2.1_vae_bf16.safetensors" } },
    te: {
      class_type: "TextEncodeQwenImage21",
      // TE 直排配方:vae 必接;latent 输出槽2直排采样器;t2i 无参考图,不接 images.*
      inputs: { clip: ["clip", 0], vae: ["vae", 0], prompt: PROMPT, negative_prompt: "", resolution: 1024 },
    },
    cache: { class_type: "QwenImage21Cache", inputs: { model: ["unet", 0], device: "auto", dtype: "default" } },
    // 4步快档(任务口径,替代件内 KSampler 40步;FunAcc 无 negative 槽)
    t8: {
      class_type: "T8QwenImage21FunAccPDD4Step",
      inputs: { model: ["cache", 0], positive: ["te", 0], latent_image: ["te", 2], model_file: "Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors", seed: SEED },
    },
    dec: { class_type: "VAEDecode", inputs: { samples: ["t8", 0], vae: ["vae", 0] } },
    save_t2i: { class_type: "SaveImage", inputs: { images: ["dec", 0], filename_prefix: "t2i-seedvr2-1002/t2i-1024" } },
    // ── SeedVR2 放大三件(件内 [9][11][12][13],模型名/槽位照件内真实值)──
    dit: {
      class_type: "SeedVR2LoadDiTModel",
      inputs: { model: "seedvr2_7b_sharp_fp8_e4m3fn.safetensors", device: "mps", blocks_to_swap: 0, swap_io_components: false, offload_device: "none", cache_model: false, attention_mode: "sdpa" },
    },
    svae: {
      class_type: "SeedVR2LoadVAEModel",
      inputs: { model: "ema_vae_fp16.safetensors", device: "mps", encode_tiled: true, encode_tile_size: 512, encode_tile_overlap: 160, decode_tiled: true, decode_tile_size: 512, decode_tile_overlap: 160, tile_debug: "false", offload_device: "none", cache_model: false }, // 10-02 二轮:不分块在 MPS 上确定性杀引擎×2,改兄弟件实战 tiled 512/160
    },
    up: {
      class_type: "SeedVR2VideoUpscaler",
      inputs: { image: ["dec", 0], dit: ["dit", 0], vae: ["svae", 0], seed: SEED, resolution: 2048, max_resolution: 4096, batch_size: 1, uniform_batch_size: false, color_correction: "lab", temporal_overlap: 0, prepend_frames: 0, offload_device: "none", enable_debug: false },
    },
    save_up: { class_type: "SaveImage", inputs: { images: ["up", 0], filename_prefix: "t2i-seedvr2-1002/upscale-2k" } },
  };
}

async function queue(nodes) {
  const r = await fetch(`${BASE}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: nodes, client_id: "t2i-seedvr2-1002" }),
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

async function fireOnce(tag) {
  const t0 = Date.now();
  const pid = await queue(buildPrompt());
  log(`▶[${tag}] 一条龙排队 prompt_id=${pid}(t2i 4步快档 1024² → SeedVR2 短边2048)`);
  const res = await waitHistory(pid, TOTAL_TIMEOUT_MS);
  if (res.entry) return { pid, entry: res.entry, seconds: Math.round((Date.now() - t0) / 1000) };
  throw Object.assign(new Error(`实弹异常(${tag}): ${res.error || (res.engineDead ? "引擎失联" : `超时 ${TOTAL_TIMEOUT_MS / 1000}s`)}`), { engineDead: !!res.engineDead });
}

async function collectOutputs(entry, seconds, pid) {
  const picks = {};
  for (const [nodeKey, out] of Object.entries(entry.outputs || {})) {
    const im = (out.images || [])[0];
    if (im) picks[nodeKey] = im;
  }
  if (!picks.save_t2i) throw new Error("t2i 段无出图(save_t2i 缺)");
  if (!picks.save_up) throw new Error("放大段无出图(save_up 缺)");
  const localT2i = path.join(OUT, "t2i-1024.png");
  const localUp = path.join(OUT, "upscale-2k.png");
  fs.writeFileSync(localT2i, await fetchImage(picks.save_t2i));
  fs.writeFileSync(localUp, await fetchImage(picks.save_up));
  report.runs.push({
    id: "t2i-seedvr2-one-shot",
    prompt_id: pid,
    seconds,
    outputs: { t2i: localT2i, upscale: localUp },
    remote: { t2i: picks.save_t2i, upscale: picks.save_up },
    seed: SEED,
  });
  log(`✔ 一条龙完成 ${seconds}s → ${localT2i} + ${localUp}`);
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  return { localT2i, localUp };
}

async function main() {
  await ensureEngine();

  // ── 前置门:六节点在册 + DiT combo 有件内真名(软链布线在位)──
  const oiAll = await (await fetch(`${BASE}/object_info`, { signal: AbortSignal.timeout(60000) })).json();
  for (const k of ["TextEncodeQwenImage21", "T8QwenImage21FunAccPDD4Step", "QwenImage21Cache", "SeedVR2LoadDiTModel", "SeedVR2LoadVAEModel", "SeedVR2VideoUpscaler"]) {
    if (!oiAll[k]) throw new Error(`节点缺注册: ${k}`);
  }
  const ditOpts = oiAll.SeedVR2LoadDiTModel.input.required.model;
  const ditCombo = Array.isArray(ditOpts[0]) ? ditOpts[0] : ditOpts[1]?.options || [];
  if (!ditCombo.includes("seedvr2_7b_sharp_fp8_e4m3fn.safetensors")) {
    throw new Error("DiT combo 未见件内真名 seedvr2_7b_sharp_fp8_e4m3fn.safetensors(家级 models/SEEDVR2 → ComfyUI/models/SEEDVR2 软链是否还在?)");
  }
  log(`前置门过:引擎${report.engine.port} / 六节点在册 / DiT真名在 combo(${ditCombo.length}项)`);

  // ── 开火(带一次失联自愈:引擎被属主收走 → 按授权自拉重排队)──
  try {
    const r = await fireOnce("首发");
    await collectOutputs(r.entry, r.seconds, r.pid);
  } catch (e) {
    if (!e.engineDead) throw e;
    log(`首发引擎失联(${e.message}),按授权自愈:重新发现/自拉后重排队一次`);
    selfStarted = false; // 失联的可能是复用引擎;自拉状态复位,由 ensureEngine 重新裁决
    await ensureEngine();
    const r = await fireOnce("自愈重试");
    await collectOutputs(r.entry, r.seconds, r.pid);
  }

  // ── 指标后处理(venv python:PIL+numpy)──
  const metricsPy = path.join(OUT, "_metrics.py");
  fs.writeFileSync(
    metricsPy,
    [
      "import json",
      "from PIL import Image",
      `out_dir=${JSON.stringify(OUT)}`,
      "t2i=Image.open(out_dir+'/t2i-1024.png').convert('RGB')",
      "up=Image.open(out_dir+'/upscale-2k.png').convert('RGB')",
      "uc_t2i=len(set(t2i.getdata())); uc_up=len(set(up.getdata()))",
      "ratio_w=up.size[0]/t2i.size[0]; ratio_h=up.size[1]/t2i.size[1]",
      "gates={",
      " 'gate1_t2i_unique_ge_1000': uc_t2i>=1000,",
      " 'gate2_upscale_ratio_approx_2x': abs(ratio_w-2.0)<=0.05 and abs(ratio_h-2.0)<=0.05,  # 件内 resolution=2048/短边1024 → 目标倍率2.0(短边≈2048)",
      " 'gate3_upscale_unique_ge_1000': uc_up>=1000,",
      "}",
      "res={'t2i':{'size':t2i.size,'unique_colors':uc_t2i},'upscale':{'size':up.size,'unique_colors':uc_up},'ratio':{'w':round(ratio_w,4),'h':round(ratio_h,4)},'gates':gates,'all_pass':all(gates.values())}",
      "json.dump(res,open(out_dir+'/metrics.json','w'),ensure_ascii=False,indent=1)",
      "print(json.dumps(res,ensure_ascii=False))",
    ].join("\n"),
  );
  const mres = spawnSync(`${EH}/venv/bin/python`, [metricsPy], { encoding: "utf8", timeout: 180000 });
  if (mres.status !== 0) {
    log("指标脚本异常: " + (mres.stderr || "").slice(0, 400));
    throw new Error("指标计算失败");
  }
  log("门禁指标: " + mres.stdout.trim());

  fs.writeFileSync(
    path.join(OUT, "EXIT.json"),
    JSON.stringify({ exit: 0, finishedAt: new Date().toISOString(), seconds: report.runs[0].seconds }),
  );
  console.log(mres.stdout.trim());
}

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
