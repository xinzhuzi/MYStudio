#!/usr/bin/env node
/**
 * 实弹 道具透明底(Trellis 10-02 daotu-rgba,实弹员-透明底)
 *
 * API 直排复刻 workflows/1_图片/Q2-1图像/1_文生图/qwen21-daotu-rgba-t2i.json 的链:
 *   UNET/CLIP/VAE 三件套 → QwenImage21Cache → TextEncodeQwenImage21(纯t2i·不接图·res1024)
 *   → 采样(任务指定 4 步快档 T8QwenImage21FunAccPDD4Step 替件内 40 步 KSampler)
 *   → VAEDecode → SplitImageWithAlpha → SaveImageWithAlpha(透明 PNG)
 * 提示词 = 件内默认道具例(逐字);seed 恒 424242。
 *
 * 引擎纪律:恒复用 http://127.0.0.1:17599,绝不启停(启停归收摊员)。
 * 驱动模板:qi21_consistency_lora_ab_1001.mjs(队列/轮询/取图已实战验证)。
 * 产物:apps/output/daotu-rgba-1002/{shot1.png,metrics.json,report.json,EXIT.json}
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const EH = "/Users/zhengbingjin/Library/Application Support/漫影工作室/comfyui";
const REPO = "/Users/zhengbingjin/Project/Github/MYStudio";
const OUT = path.join(REPO, "apps/output/daotu-rgba-1002");
const PORT = 17599;
const BASE = `http://127.0.0.1:${PORT}`;
const SEED = 424242;
const CLIENT = "daotu-rgba-fire-1002";
// 件内默认道具例,qwen21-daotu-rgba-t2i.json [5] widgets_values_named.prompt 逐字
const PROMPT =
  "This is an RGBA format image with transparency. 一柄青铜古剑的道具素材:剑身暗金底色上盘绕细密云雷纹,剑格铸成兽首衔环,剑柄缠深红丝绳;器物以正侧面平视水平居中,单一主体完整入画,四周留出空边,轮廓干净利落,如一件可直接裁切的平面素材。The image has an alpha channel and a transparent background.";

fs.mkdirSync(OUT, { recursive: true });
const report = { case: "daotu-rgba", engine: { port: PORT, policy: "reuse-never-start" }, startedAt: new Date().toISOString() };

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

// ── API 图:照件内链复刻,唯一替换 = KSampler(40步) → T8 4步快档(任务指定) ──
function buildGraph() {
  const nodes = {
    unet: { class_type: "UNETLoader", inputs: { unet_name: "qwen_image_2.1_bf16.safetensors", weight_dtype: "default" } },
    clip: { class_type: "CLIPLoader", inputs: { clip_name: "qwen3vl_8b_bf16_heretic.safetensors", type: "qwen_image", device: "default" } },
    vae: { class_type: "VAELoader", inputs: { vae_name: "qwen_image_2.1_vae_bf16.safetensors" } },
    // TE 直排配方(实战坑):vae 必接;纯 t2i 不接 images → resolution=1024 出方图;latent 槽 2 直进采样
    te: {
      class_type: "TextEncodeQwenImage21",
      inputs: { clip: ["clip", 0], vae: ["vae", 0], prompt: PROMPT, negative_prompt: "", resolution: 1024 },
    },
    cache: { class_type: "QwenImage21Cache", inputs: { model: ["unet", 0], device: "auto", dtype: "default" } },
    // 4 步快档:positive/latent_image 接 TE,seed 恒 424242(cfg=1 语义内化于 Fun-Acc PDD,无 negative 槽)
    t8: {
      class_type: "T8QwenImage21FunAccPDD4Step",
      inputs: {
        model: ["cache", 0],
        positive: ["te", 0],
        latent_image: ["te", 2],
        model_file: "Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors",
        seed: SEED,
      },
    },
    dec: { class_type: "VAEDecode", inputs: { samples: ["t8", 0], vae: ["vae", 0] } },
    split: { class_type: "SplitImageWithAlpha", inputs: { image: ["dec", 0] } },
    save: { class_type: "SaveImageWithAlpha", inputs: { images: ["split", 0], mask: ["split", 1], filename_prefix: "daotu-rgba-1002/shot1" } },
  };
  return nodes;
}

async function queue(nodes) {
  const r = await fetch(`${BASE}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: nodes, client_id: CLIENT }),
    signal: AbortSignal.timeout(30000),
  });
  const j = await r.json();
  if (!j.prompt_id) throw new Error("排队失败: " + JSON.stringify(j).slice(0, 400));
  return j.prompt_id;
}

async function waitHistory(promptId, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await fetch(`${BASE}/history/${promptId}`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (r && r.ok) {
      const h = await r.json().catch(() => null);
      const e = h && h[promptId];
      if (e && e.status) {
        if (e.status.status_str === "error") return { error: JSON.stringify(e.status.messages).slice(0, 800) };
        if (e.status.completed) return { entry: e };
      }
    }
    await new Promise((r2) => setTimeout(r2, 3000));
  }
  return { timeout: true };
}

async function main() {
  // 前置门:引擎活性
  const st = await fetch(`${BASE}/system_stats`, { signal: AbortSignal.timeout(8000) });
  if (!st.ok) throw new Error(`引擎 ${PORT} 无响应(HTTP ${st.status})`);
  log(`引擎在线 port=${PORT}`);

  const nodes = buildGraph();
  const t0 = Date.now();
  log(`▶ shot1 排队(4步Fun-Acc快档·seed=${SEED}·透明链)`);
  const pid = await queue(nodes);
  const res = await waitHistory(pid, 1100000);
  if (res.timeout || res.error || !res.entry) throw new Error(`shot1 失败: ${res.error || (res.timeout ? "超时" : "无history")}`);
  const dur = Math.round((Date.now() - t0) / 1000);

  const imgs = [];
  for (const nodeOut of Object.values(res.entry.outputs || {})) for (const im of nodeOut.images || []) imgs.push(im);
  if (!imgs[0]) throw new Error("history 无输出图");
  const v = await fetch(
    `${BASE}/view?filename=${encodeURIComponent(imgs[0].filename)}&subfolder=${encodeURIComponent(imgs[0].subfolder || "")}&type=${imgs[0].type || "output"}`,
    { signal: AbortSignal.timeout(60000) },
  );
  const buf = Buffer.from(await v.arrayBuffer());
  const local = path.join(OUT, "shot1.png");
  fs.writeFileSync(local, buf);
  report.run = { id: "shot1", prompt_id: pid, seconds: dur, output: local, remote: imgs[0], bytes: buf.length };
  log(`✔ shot1 完成 ${dur}s → ${local}(${buf.length}B)`);
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));

  // ── 门禁指标(引擎 venv python:PIL+numpy)──
  const gatesPy = path.join(OUT, "_gates.py");
  fs.writeFileSync(
    gatesPy,
    [
      "import json",
      "from PIL import Image",
      "import numpy as np",
      `p=${JSON.stringify(local)}`,
      "im=Image.open(p)",
      "im.load()",
      "has_alpha = im.mode=='RGBA' or (im.mode in ('LA','PA')) or 'transparency' in im.info",
      "out={'png_mode':im.mode,'size':im.size,'has_alpha_channel':bool(has_alpha)}",
      "if im.mode=='RGBA':",
      "    a=np.asarray(im)[:,:,3].astype(np.int32)",
      "    n=a.size",
      "    tr=float((a<10).sum())/n",
      "    op=float((a>245).sum())/n",
      "    rgba=list(im.getdata())",
      "    uc_rgba=len(set(rgba))",
      "    # 辅助:只算不透明像素的 RGB 唯一色(排除透明区底色干扰)",
      "    arr=np.asarray(im)",
      "    uc_opaque=len({tuple(px) for px,al in zip(arr.reshape(-1,4)[::7],a.reshape(-1)[::7]) if al>245})  # 1/7 采样辅助值",
      "    out.update({'transparent_ratio_lt10':round(tr,4),'opaque_ratio_gt245':round(op,4),'unique_colors_rgba':uc_rgba,'unique_colors_opaque_rgb_sampled7':uc_opaque,'alpha_min':int(a.min()),'alpha_max':int(a.max())})",
      `json.dump(out,open(${JSON.stringify(path.join(OUT, "metrics.json"))},'w'),ensure_ascii=False,indent=1)`,
      "print(json.dumps(out,ensure_ascii=False))",
    ].join("\n"),
  );
  const g = spawnSync(`${EH}/venv/bin/python`, [gatesPy], { encoding: "utf8", timeout: 180000 });
  if (g.status !== 0) throw new Error("门禁脚本异常: " + (g.stderr || "").slice(0, 400));
  const metrics = JSON.parse(fs.readFileSync(path.join(OUT, "metrics.json"), "utf8"));
  const gates = {
    "①PNG带alpha通道(RGBA)": metrics.png_mode === "RGBA",
    "②透明像素占比>5%": metrics.transparent_ratio_lt10 > 0.05,
    "②不透明像素占比>50%": metrics.opaque_ratio_gt245 > 0.5,
    "③唯一色(RGBA元组)≥1000": metrics.unique_colors_rgba >= 1000,
  };
  report.metrics = metrics;
  report.gates = gates;
  report.allGatesPass = Object.values(gates).every(Boolean);
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(
    path.join(OUT, "EXIT.json"),
    JSON.stringify({ exit: report.allGatesPass ? 0 : 2, finishedAt: new Date().toISOString() }),
  );
  console.log(JSON.stringify({ metrics, gates, seconds: dur, output: local }, null, 1));
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
