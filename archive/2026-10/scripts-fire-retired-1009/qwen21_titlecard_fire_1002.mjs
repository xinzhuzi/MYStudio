#!/usr/bin/env node
/**
 * 实弹 标题卡(Trellis 10-02 titlecard livefire)
 *
 * API 直排复刻 workflows/1_图片/Q2-1图像/1_文生图/qwen21-titlecard-t2i.json 的链:
 *   UNET qwen_image_2.1_bf16 → QwenImage21Cache(auto/default) → KSampler(40步·cfg1·euler·simple·denoise1·seed 424242 fixed)
 *   TE qwen3vl_8b_bf16_heretic(type=qwen_image) + VAE qwen_image_2.1_vae_bf16(必接);
 *   TE latent(槽2)直进 KSampler latent_image;纯 t2i 无参考图 → autogrow images 槽整体省略(引擎源码 min=0)。
 *   提示词 = 件内 [5] PrimitiveStringMultiline 默认章标题卡例(程序化从工作流 JSON 抽取,零转写)。
 *   分辨率:件内默认 2048 → 本发降 1024 省时(任务口径允许,report 注明)。
 *
 * 引擎纪律:恒复用 http://127.0.0.1:17599,绝不启停(启停归收摊员);引擎不在则如实失败,不自拉。
 * 产物:apps/output/titlecard-1002/{titlecard-40st-1024.png, report.json, metrics.json, EXIT.json}
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const EH = "/Users/zhengbingjin/Library/Application Support/漫影工作室/comfyui";
const REPO = "/Users/zhengbingjin/Project/Github/MYStudio";
const WF = path.join(REPO, "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qwen21-titlecard-t2i.json");
const OUT = path.join(REPO, "apps/output/titlecard-1002");
const PORT = 17599; // 实弹纪律:恒复用,绝不启停
const SEED = 424242;
const STEPS = 40;
const RESOLUTION = 1024; // 件内默认 2048,本发降档省时(任务口径允许,须注明)

fs.mkdirSync(OUT, { recursive: true });
const report = { case: "titlecard", startedAt: new Date().toISOString(), engine: { port: PORT, policy: "reuse-only" }, resolution_note: `件内默认 2048,本发降至 ${RESOLUTION} 省时(任务允许)`, runs: [] };

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

// 件内默认章标题卡例,程序化抽取(节点 id=5,唯一手写位)
const wf = JSON.parse(fs.readFileSync(WF, "utf8"));
const n5 = wf.nodes.find((n) => n.id === 5);
if (!n5 || n5.type !== "PrimitiveStringMultiline") throw new Error("工作流 [5] 主体句节点缺失");
const PROMPT = n5.widgets_values[0];
report.prompt_source = "workflow [5] PrimitiveStringMultiline widgets_values[0]";
report.prompt_chars = PROMPT.length;

function buildPrompt() {
  return {
    unet: { class_type: "UNETLoader", inputs: { unet_name: "qwen_image_2.1_bf16.safetensors", weight_dtype: "default" } },
    clip: { class_type: "CLIPLoader", inputs: { clip_name: "qwen3vl_8b_bf16_heretic.safetensors", type: "qwen_image", device: "default" } },
    vae: { class_type: "VAELoader", inputs: { vae_name: "qwen_image_2.1_vae_bf16.safetensors" } },
    cache: { class_type: "QwenImage21Cache", inputs: { model: ["unet", 0], device: "auto", dtype: "default" } },
    te: {
      class_type: "TextEncodeQwenImage21",
      // 配方:vae 必接;纯 t2i 无参考图 → images autogrow 槽整体省略(min=0);latent 在槽 2
      inputs: { clip: ["clip", 0], vae: ["vae", 0], prompt: PROMPT, negative_prompt: "", resolution: RESOLUTION },
    },
    ks: {
      class_type: "KSampler",
      inputs: { model: ["cache", 0], positive: ["te", 0], negative: ["te", 1], latent_image: ["te", 2], seed: SEED, steps: STEPS, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1 },
    },
    dec: { class_type: "VAEDecode", inputs: { samples: ["ks", 0], vae: ["vae", 0] } },
    save: { class_type: "SaveImage", inputs: { images: ["dec", 0], filename_prefix: "titlecard-1002/titlecard" } },
  };
}

async function queue(nodes) {
  const r = await fetch(`http://127.0.0.1:${PORT}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: nodes, client_id: "titlecard-fire-1002" }),
    signal: AbortSignal.timeout(30000),
  });
  const j = await r.json();
  if (!j.prompt_id) throw new Error("排队失败: " + JSON.stringify(j).slice(0, 500));
  return j.prompt_id;
}

async function waitHistory(promptId, timeoutMs) {
  const t0 = Date.now();
  let deadStreak = 0;
  while (Date.now() - t0 < timeoutMs) {
    const r = await fetch(`http://127.0.0.1:${PORT}/history/${promptId}`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!r) {
      deadStreak += 1;
      if (deadStreak >= 5) return { engineDead: true };
    } else {
      deadStreak = 0;
      if (r.ok) {
        const h = await r.json().catch(() => null);
        const e = h && h[promptId];
        if (e && e.status) {
          if (e.status.status_str === "error") return { error: JSON.stringify(e.status.messages).slice(0, 800) };
          if (e.status.completed) return { entry: e };
        }
      }
    }
    await new Promise((r2) => setTimeout(r2, 3000));
  }
  return { timeout: true };
}

async function main() {
  // 前置:引擎活性 + 节点注册
  const oi = await (await fetch(`http://127.0.0.1:${PORT}/object_info`, { signal: AbortSignal.timeout(10000) })).json();
  for (const k of ["TextEncodeQwenImage21", "QwenImage21Cache", "KSampler", "UNETLoader", "CLIPLoader", "VAELoader", "VAEDecode", "SaveImage"]) {
    if (!oi[k]) throw new Error(`节点缺注册: ${k}`);
  }
  log(`前置门过:引擎${PORT} / 节点齐 / 主体句 ${PROMPT.length} 字`);

  const nodes = buildPrompt();
  const t0 = Date.now();
  log(`▶ 排队 40步·${RESOLUTION}²·seed${SEED}`);
  const pid = await queue(nodes);
  const res = await waitHistory(pid, 1500000);
  if (res.timeout || res.error || res.engineDead) {
    throw new Error(`渲染失败: ${res.error || (res.engineDead ? "引擎失联" : "超时")}`);
  }
  const imgs = [];
  for (const nodeOut of Object.values(res.entry.outputs || {})) {
    for (const im of nodeOut.images || []) imgs.push(im);
  }
  if (!imgs[0]) throw new Error("完成但无产物图");
  const dur = Math.round((Date.now() - t0) / 1000);
  const v = await fetch(
    `http://127.0.0.1:${PORT}/view?filename=${encodeURIComponent(imgs[0].filename)}&subfolder=${encodeURIComponent(imgs[0].subfolder || "")}&type=${imgs[0].type || "output"}`,
    { signal: AbortSignal.timeout(60000) },
  );
  const local = path.join(OUT, "titlecard-40st-1024.png");
  fs.writeFileSync(local, Buffer.from(await v.arrayBuffer()));
  report.runs.push({ id: "titlecard-40st-1024", prompt_id: pid, seconds: dur, output: local, remote: imgs[0], seed: SEED, steps: STEPS, resolution: RESOLUTION });
  log(`✔ 完成 ${dur}s → ${local}`);
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));

  // ── 内容门禁①:唯一色(venv python PIL) ──
  const metricsPy = path.join(OUT, "_metrics.py");
  fs.writeFileSync(
    metricsPy,
    [
      "import json",
      "from PIL import Image",
      `p=${JSON.stringify(local)}`,
      "im=Image.open(p).convert('RGB')",
      `json.dump({'size':im.size,'unique_colors':len(set(im.getdata()))},open(${JSON.stringify(path.join(OUT, "metrics.json"))},'w'),ensure_ascii=False,indent=1)`,
    ].join("\n"),
  );
  const mres = spawnSync(`${EH}/venv/bin/python`, [metricsPy], { encoding: "utf8", timeout: 120000 });
  if (mres.status !== 0) throw new Error("指标脚本异常: " + (mres.stderr || "").slice(0, 300));
  log("指标落盘 metrics.json: " + fs.readFileSync(path.join(OUT, "metrics.json"), "utf8").trim().replace(/\s+/g, " "));

  fs.writeFileSync(path.join(OUT, "EXIT.json"), JSON.stringify({ exit: 0, finishedAt: new Date().toISOString(), runs: report.runs.length }));
}

try {
  await main();
  process.exit(0);
} catch (e) {
  report.fatal = e.message;
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, "EXIT.json"), JSON.stringify({ exit: 1, error: e.message, finishedAt: new Date().toISOString() }));
  console.error("FATAL:", e.message);
  process.exit(1);
}
