#!/usr/bin/env node
/**
 * Q2-1 一致性 LoRA 三组 A/B 实拍床(Trellis 10-01-consistency-lora-eval)
 *
 * 五发(种子恒 424242,输入=qi21-livefire 旧产物 edit-2-result.png,改画水彩=漂移重灾场景):
 *   g1a 40步直出·无LoRA·英文指令      (基线)
 *   g1b 40步直出·一致性LoRA1.0·英文    (作者配方域)
 *   g2a 4步Fun-Acc·无一致性LoRA·英文   (加速基线)
 *   g2b 4步Fun-Acc·一致性LoRA1.0·英文  (无人区:作者未测turbo叠加)
 *   g3a 40步直出·一致性LoRA1.0·中文指令 (中文坑检定,对照=g1b)
 *
 * 引擎纪律:先探 17001/17000,有则复用绝不停;全无才自拉(家目录四参数),自拉的收尾只杀自己 pid。
 * 产物:apps/output/consistency-lora-ab-1001/{五发png,report.json,metrics.json,EXIT.json}
 */
import { spawn, spawnSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const EH = "/Users/zhengbingjin/Library/Application Support/漫影工作室/comfyui";
const REPO = "/Users/zhengbingjin/Project/Github/MYStudio";
const OUT = path.join(REPO, "apps/output/consistency-lora-ab-1001");
const ENGINE_LOG = "/tmp/comfyui-consistency-ab-1001.log";
const LORA_PATH = path.join(EH, "models/loras/qwen-image-2.1-consistency.safetensors");
const LORA_SIZE = 159436496;
const INPUT = "/Users/zhengbingjin/Downloads/qi21-livefire-0929/edit-2-result.png";
const SEED = 424242;
const EN = "Repaint this image as a watercolor painting.";
const ZH = "把这张图改画成水彩画。";

fs.mkdirSync(OUT, { recursive: true });
const report = { runs: [], engine: {}, startedAt: new Date().toISOString() };
let selfChild = null;
let selfStarted = false;

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function probe(port, ms = 4000) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/object_info`, {
      signal: AbortSignal.timeout(ms),
    });
    if (r.ok) return port;
  } catch {}
  return null;
}

function findRunningEnginePorts() {
  // App 托管引擎端口浮动(17599 实测),动态发现:pgrep 进程 → lsof 监听口
  try {
    const pids = execSync("pgrep -f 'ComfyUI/main.py'")
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean);
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

async function ensureEngine(forceSelf = false) {
  if (!forceSelf) {
    for (const p of [...findRunningEnginePorts(), 17001, 17000]) {
      const hit = await probe(p);
      if (hit) {
        report.engine = { port: hit, reused: true, pid: null };
        log(`引擎复用 port ${hit}`);
        return hit;
      }
  }
  }
  log("无引擎,自拉 17001...");
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
  fs.writeFileSync("/tmp/comfyui-consistency-ab-1001.pid", String(selfChild.pid));
  report.engine = { port: 17001, reused: false, pid: selfChild.pid };
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const hit = await probe(17001, 4000);
    if (hit) {
      log(`自拉引擎就绪 pid=${selfChild.pid}`);
      return 17001;
    }
    if (i % 10 === 9) log(`引擎启动中... ${(i + 1) * 3}s`);
  }
  throw new Error("引擎 240s 未就绪,日志在 " + ENGINE_LOG);
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

function buildPrompt(spec) {
  const { lora, funacc, steps, promptText } = spec;
  const nodes = {
    unet: { class_type: "UNETLoader", inputs: { unet_name: "qwen_image_2.1_bf16.safetensors", weight_dtype: "default" } },
    clip: { class_type: "CLIPLoader", inputs: { clip_name: "qwen3vl_8b_bf16_heretic.safetensors", type: "qwen_image", device: "default" } },
    vae: { class_type: "VAELoader", inputs: { vae_name: "qwen_image_2.1_vae_bf16.safetensors" } },
    inimg: { class_type: "LoadImage", inputs: { image: report.uploadedName } },
    te: {
      class_type: "TextEncodeQwenImage21",
      // 配方照 b4_duipai_run_0930.py(实弹绿):vae 必接;autogrow 图槽=全名 images.image_1
      inputs: { clip: ["clip", 0], vae: ["vae", 0], prompt: promptText, negative_prompt: "", resolution: 0, "images.image_1": ["inimg", 0] },
    },
  };
  let modelSrc = ["unet", 0];
  if (lora) {
    nodes.lora = {
      class_type: "LoraLoaderModelOnly",
      inputs: { model: ["unet", 0], lora_name: "qwen-image-2.1-consistency.safetensors", strength_model: 1.0 },
    };
    modelSrc = ["lora", 0];
  }
  nodes.cache = { class_type: "QwenImage21Cache", inputs: { model: modelSrc, device: "auto", dtype: "default" } };
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
  nodes.save = { class_type: "SaveImage", inputs: { images: ["dec", 0], filename_prefix: `consistency-ab-1001/${spec.id}` } };
  return nodes;
}

async function uploadInput(port) {
  const fd = new FormData();
  fd.append("image", new Blob([fs.readFileSync(INPUT)], { type: "image/png" }), "consistency-ab-input.png");
  fd.append("overwrite", "true");
  const r = await fetch(`http://127.0.0.1:${port}/upload/image`, { method: "POST", body: fd, signal: AbortSignal.timeout(30000) });
  const j = await r.json();
  report.uploadedName = j.name;
  log(`输入图上传: ${j.name}`);
}

async function queue(port, nodes) {
  const r = await fetch(`http://127.0.0.1:${port}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: nodes, client_id: "consistency-ab-1001" }),
    signal: AbortSignal.timeout(30000),
  });
  const j = await r.json();
  if (!j.prompt_id) throw new Error("排队失败: " + JSON.stringify(j).slice(0, 300));
  return j.prompt_id;
}

async function waitHistory(port, promptId, timeoutMs) {
  const t0 = Date.now();
  let deadStreak = 0;
  while (Date.now() - t0 < timeoutMs) {
    const r = await fetch(`http://127.0.0.1:${port}/history/${promptId}`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!r) {
      deadStreak += 1;
      if (deadStreak >= 5) return { engineDead: true };
    } else {
      deadStreak = 0;
      if (r.ok) {
        const h = await r.json().catch(() => null);
        const e = h && h[promptId];
        if (e && e.status) {
          if (e.status.status_str === "error") return { error: JSON.stringify(e.status.messages).slice(0, 500) };
          if (e.status.completed) return { entry: e };
        }
      }
    }
    await new Promise((r2) => setTimeout(r2, 3000));
  }
  return { timeout: true };
}

async function runOne(port, spec) {
  const nodes = buildPrompt(spec);
  const t0 = Date.now();
  log(`▶ ${spec.id} 排队(${spec.label})`);
  let pid;
  try {
    pid = await queue(port, nodes);
  } catch (e) {
    log(`  ${spec.id} 排队失败(${e.message}),引擎保活重试`);
    port = await ensureEngine();
    pid = await queue(port, buildPrompt(spec));
  }
  let res = await waitHistory(port, pid, 1100000);
  if (res.timeout || res.error || res.engineDead) {
    log(`  ${spec.id} 异常(${res.timeout ? "超时" : res.engineDead ? "引擎失联" : res.error}),保活重试一次`);
    port = await ensureEngine();
    const pid2 = await queue(port, buildPrompt(spec));
    res = await waitHistory(port, pid2, 1100000);
    if (res.timeout || res.error || res.engineDead) throw new Error(`${spec.id} 两轮均失败: ${res.error || (res.engineDead ? "引擎失联" : "超时")}`);
    pid = pid2;
  }
  const imgs = [];
  for (const nodeOut of Object.values(res.entry.outputs || {})) {
    for (const im of nodeOut.images || []) imgs.push(im);
  }
  const dur = Math.round((Date.now() - t0) / 1000);
  let local = null;
  if (imgs[0]) {
    const v = await fetch(
      `http://127.0.0.1:${port}/view?filename=${encodeURIComponent(imgs[0].filename)}&subfolder=${encodeURIComponent(imgs[0].subfolder || "")}&type=${imgs[0].type || "output"}`,
      { signal: AbortSignal.timeout(60000) },
    );
    const buf = Buffer.from(await v.arrayBuffer());
    local = path.join(OUT, `${spec.id}.png`);
    fs.writeFileSync(local, buf);
  }
  report.runs.push({ id: spec.id, label: spec.label, prompt_id: pid, seconds: dur, output: local, remote: imgs[0] || null });
  log(`✔ ${spec.id} 完成 ${dur}s → ${local}`);
}

const MATRIX = [
  { id: "g1a-40-nolora-en", label: "40步·无LoRA·英文(基线)", lora: false, funacc: false, steps: 40, promptText: EN },
  { id: "g1b-40-lora-en", label: "40步·LoRA1.0·英文(作者域)", lora: true, funacc: false, steps: 40, promptText: EN },
  { id: "g2a-4-funacc-en", label: "4步Fun-Acc·无LoRA·英文", lora: false, funacc: true, steps: 4, promptText: EN },
  { id: "g2b-4-funacc-lora-en", label: "4步Fun-Acc·LoRA1.0·英文(无人区)", lora: true, funacc: true, steps: 4, promptText: EN },
  { id: "g3a-40-lora-zh", label: "40步·LoRA1.0·中文(对照g1b)", lora: true, funacc: false, steps: 40, promptText: ZH },
];

async function main() {
  // ── 前置门 ──
  const st = fs.statSync(LORA_PATH);
  if (st.size !== LORA_SIZE) throw new Error(`LoRA 未下完: ${st.size}/${LORA_SIZE}`);
  if (!fs.existsSync(INPUT)) throw new Error("输入图缺失: " + INPUT);

  let port = await ensureEngine();
  // object_info 双断言:LoRA 在 combo + 关键节点在册
  const oi = await (await fetch(`http://127.0.0.1:${port}/object_info`, { signal: AbortSignal.timeout(60000) })).json();
  const combo = oi.LoraLoaderModelOnly.input.required.lora_name[0];
  if (!combo.includes("qwen-image-2.1-consistency.safetensors")) {
    if (report.engine.reused) {
      log("复用引擎未见 LoRA(扫描早于下载),自拉替代");
      port = await ensureEngine(true);
      const oi2 = await (await fetch(`http://127.0.0.1:${port}/object_info`, { signal: AbortSignal.timeout(60000) })).json();
      if (!oi2.LoraLoaderModelOnly.input.required.lora_name[0].includes("qwen-image-2.1-consistency.safetensors"))
        throw new Error("自拉引擎仍不见 LoRA");
    } else {
      throw new Error("LoRA 不在引擎 combo(缓存未刷新)");
    }
  }
  for (const k of ["TextEncodeQwenImage21", "T8QwenImage21FunAccPDD4Step", "QwenImage21Cache"]) if (!oi[k]) throw new Error(`节点缺注册: ${k}`);
  log(`前置门过:引擎${port} / LoRA在册 / 节点齐`);

  await uploadInput(port);
  for (const spec of MATRIX) {
    await runOne(port, spec);
  }
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));

  // ── 指标后处理(venv python:PIL+numpy)──
  const metricsPy = path.join(OUT, "_metrics.py");
  fs.writeFileSync(
    metricsPy,
    [
      "import json,sys",
      "from PIL import Image",
      "import numpy as np",
      `inp=Image.open(${JSON.stringify(INPUT)}).convert('RGB')`,
      "def g64(im):",
      "    a=np.asarray(im.convert('L').resize((64,64)),dtype=np.float32)",
      "    gx=np.abs(np.diff(a,axis=1)); gy=np.abs(np.diff(a,axis=0))",
      "    return gx,gy",
      "def ncc(x,y):",
      "    x=x-x.mean(); y=y-y.mean()",
      "    d=(np.sqrt((x*x).sum())*np.sqrt((y*y).sum()))",
      "    return float((x*y).sum()/d) if d>0 else 0.0",
      "igx,igy=g64(inp)",
      "out={}",
      `for rid in ${JSON.stringify(MATRIX.map((m) => m.id))}:`,
      `    p=${JSON.stringify(OUT)+'/'}+rid+'.png'`,
      "    try:",
      "        im=Image.open(p).convert('RGB')",
      "        ogx,ogy=g64(im)",
      "        uc=len(set(im.getdata()))",
      "        out[rid]={'size':im.size,'unique_colors':uc,'structure_ncc':round((ncc(igx,ogx)+ncc(igy,ogy))/2,4),'size_match_input':im.size==inp.size}",
      "    except Exception as e:",
      "        out[rid]={'error':str(e)}",
      `json.dump(out,open(${JSON.stringify(path.join(OUT, "metrics.json"))},'w'),ensure_ascii=False,indent=1)`,
    ].join("\n"),
  );
  const mres = spawnSync(`${EH}/venv/bin/python`, [metricsPy], { encoding: "utf8", timeout: 120000 });
  if (mres.status !== 0) log("指标脚本异常: " + (mres.stderr || "").slice(0, 300));
  else log("指标落盘 metrics.json");

  fs.writeFileSync(
    path.join(OUT, "EXIT.json"),
    JSON.stringify({ exit: 0, finishedAt: new Date().toISOString(), runs: report.runs.length }),
  );
  console.log(JSON.stringify(report.runs.map((r) => ({ id: r.id, s: r.seconds, out: path.basename(r.output || "") })), null, 1));
}

try {
  await main();
  await stopSelfEngine();
  process.exit(0);
} catch (e) {
  report.fatal = e.message;
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, "EXIT.json"), JSON.stringify({ exit: 1, error: e.message, finishedAt: new Date().toISOString() }));
  console.error("FATAL:", e.message);
  await stopSelfEngine();
  process.exit(1);
}
