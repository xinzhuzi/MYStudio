#!/usr/bin/env node
/**
 * Q2-1 多参考(人物+服装)官方换装例 实弹(Trellis 10-02 · multiref)
 *
 * 驱动模板 = qi21_consistency_lora_ab_1001.mjs(队列/轮询/取图/指标照抄改造)。
 * 双参考:portrait_model_denim.png = <image1>(人物,同时编辑画布,输出画布随它)
 *        clothing_light_blue_denim_shirt.png = <image2>(服装)
 * 换装指令=官方例英文句式(工作流 qwen21-multiref-edit.json 同款,去 image3 道具子句——本发双参考)。
 * 采样 = 4步快档 T8QwenImage21FunAccPDD4Step(model_file=Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors),seed 恒 424242。
 *
 * 引擎纪律:恒复用 http://127.0.0.1:17599,本脚本绝不启停引擎(启停归收摊员);引擎不在=如实失败。
 * TE 直排配方(0930 实弹坑):TextEncodeQwenImage21 必接 vae;autogrow 图槽键名=全名 images.image_1/images.image_2;
 * TE latent 输出在槽 2 直进采样器 latent_image。
 * 门禁:①唯一色≥1000(黑图检出) ②输出尺寸=人物参考尺寸(resolution=0 随图)。
 * 产物:apps/output/multiref-1002/{png,report.json,metrics.json,EXIT.json}
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const EH = "/Users/zhengbingjin/Library/Application Support/漫影工作室/comfyui";
const REPO = "/Users/zhengbingjin/Project/Github/MYStudio";
const OUT = path.join(REPO, "apps/output/multiref-1002");
const PORT = 17599; // 实弹纪律:恒复用,不启停
const BASE = `http://127.0.0.1:${PORT}`;
const PERSON_REF = "portrait_model_denim.png"; // <image1> 人物=编辑画布(门禁②尺寸锚)
const CLOTH_REF = "clothing_light_blue_denim_shirt.png"; // <image2> 服装
const SEED = 424242;
const T8_FILE = "Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors";
// 官方换装例英文指令(工作流 qwen21-multiref-edit.json 节点8同款,去 <image3> 道具子句:本发双参考)
const PROMPT =
  "Keep the character and pose in <image1> unchanged, put the light blue denim shirt from <image2> " +
  "on the character, preserve the original facial features, hair, body shape and pose, " +
  "the denim shirt fits naturally on body, realistic denim fabric texture, natural clothing folds, " +
  "keep the original background and original lighting, high fashion editorial photography, sharp details";

fs.mkdirSync(OUT, { recursive: true });
const report = { case: "multiref", engine: { port: PORT, reused: true }, startedAt: new Date().toISOString(), gates: {}, runs: [] };

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function probe(ms = 5000) {
  try {
    const r = await fetch(`${BASE}/system_stats`, { signal: AbortSignal.timeout(ms) });
    if (r.ok) return true;
  } catch {}
  return false;
}

function buildPrompt(uploadedPerson, uploadedCloth) {
  // TE 直排配方:vae 必接;图槽=全名 images.image_1/images.image_2;latent 在槽 2
  return {
    unet: { class_type: "UNETLoader", inputs: { unet_name: "qwen_image_2.1_bf16.safetensors", weight_dtype: "default" } },
    clip: { class_type: "CLIPLoader", inputs: { clip_name: "qwen3vl_8b_bf16_heretic.safetensors", type: "qwen_image", device: "default" } },
    vae: { class_type: "VAELoader", inputs: { vae_name: "qwen_image_2.1_vae_bf16.safetensors" } },
    person: { class_type: "LoadImage", inputs: { image: uploadedPerson } },
    cloth: { class_type: "LoadImage", inputs: { image: uploadedCloth } },
    te: {
      class_type: "TextEncodeQwenImage21",
      inputs: {
        clip: ["clip", 0],
        vae: ["vae", 0],
        prompt: PROMPT,
        negative_prompt: "",
        resolution: 0, // 随图:各参考按原尺寸 32 对齐(门禁②前提)
        "images.image_1": ["person", 0],
        "images.image_2": ["cloth", 0],
      },
    },
    cache: { class_type: "QwenImage21Cache", inputs: { model: ["unet", 0], device: "auto", dtype: "default" } },
    t8: {
      class_type: "T8QwenImage21FunAccPDD4Step",
      inputs: { model: ["cache", 0], positive: ["te", 0], latent_image: ["te", 2], model_file: T8_FILE, seed: SEED },
    },
    dec: { class_type: "VAEDecode", inputs: { samples: ["t8", 0], vae: ["vae", 0] } },
    save: { class_type: "SaveImage", inputs: { images: ["dec", 0], filename_prefix: "multiref-1002/multiref-dual-4step" } },
  };
}

async function queue(nodes) {
  const r = await fetch(`${BASE}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: nodes, client_id: "multiref-fire-1002" }),
    signal: AbortSignal.timeout(30000),
  });
  const j = await r.json();
  if (!j.prompt_id) throw new Error("排队失败: " + JSON.stringify(j).slice(0, 400));
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
          if (e.status.status_str === "error") return { error: JSON.stringify(e.status.messages).slice(0, 600) };
          if (e.status.completed) return { entry: e };
        }
      }
    }
    await new Promise((r2) => setTimeout(r2, 3000));
  }
  return { timeout: true };
}

async function runOne() {
  const nodes = buildPrompt(PERSON_REF, CLOTH_REF);
  const t0 = Date.now();
  log("▶ multiref-dual-4step 排队(双参考·4步快档·seed=424242)");
  let pid = await queue(nodes);
  let res = await waitHistory(pid, 1200000);
  // 失联/超时只对 17599 重排一次(绝不自拉引擎);引擎真死=如实失败
  if (res.timeout || res.error || res.engineDead) {
    const alive = await probe();
    log(`  首轮异常(${res.timeout ? "超时" : res.engineDead ? "引擎失联" : res.error}),引擎探活=${alive},重排一次`);
    if (!alive) throw new Error("引擎 17599 失联(启停归收摊员,本脚本不自拉): " + (res.error || "engineDead/timeout"));
    pid = await queue(buildPrompt(PERSON_REF, CLOTH_REF));
    res = await waitHistory(pid, 1200000);
    if (res.timeout || res.error || res.engineDead)
      throw new Error("multiref 两轮均失败: " + (res.error || (res.engineDead ? "引擎失联" : "超时")));
  }
  const imgs = [];
  for (const nodeOut of Object.values(res.entry.outputs || {})) {
    for (const im of nodeOut.images || []) imgs.push(im);
  }
  const dur = Math.round((Date.now() - t0) / 1000);
  if (!imgs[0]) throw new Error("完成但无输出图: outputs=" + JSON.stringify(res.entry.outputs || {}).slice(0, 300));
  const v = await fetch(
    `${BASE}/view?filename=${encodeURIComponent(imgs[0].filename)}&subfolder=${encodeURIComponent(imgs[0].subfolder || "")}&type=${imgs[0].type || "output"}`,
    { signal: AbortSignal.timeout(60000) },
  );
  const buf = Buffer.from(await v.arrayBuffer());
  const local = path.join(OUT, "multiref-dual-4step.png");
  fs.writeFileSync(local, buf);
  report.runs.push({ id: "multiref-dual-4step", prompt_id: pid, seconds: dur, output: local, remote: imgs[0] });
  log(`✔ multiref-dual-4step 完成 ${dur}s → ${local}`);
}

async function main() {
  // ── 前置门:引擎活 / 节点在册 / T8 模型在 combo / 双参考图引擎侧可读 ──
  if (!(await probe())) throw new Error("引擎 17599 不在(实弹纪律:不启停,启停归收摊员)");
  const oi = await (await fetch(`${BASE}/object_info`, { signal: AbortSignal.timeout(60000) })).json();
  for (const k of ["TextEncodeQwenImage21", "T8QwenImage21FunAccPDD4Step", "QwenImage21Cache", "UNETLoader", "CLIPLoader", "VAELoader"])
    if (!oi[k]) throw new Error(`节点缺注册: ${k}`);
  const t8combo = oi.T8QwenImage21FunAccPDD4Step.input.required.model_file[0];
  if (!t8combo.includes(T8_FILE)) throw new Error(`T8 模型不在 combo: ${T8_FILE}`);
  for (const img of [PERSON_REF, CLOTH_REF]) {
    const r = await fetch(`${BASE}/view?filename=${encodeURIComponent(img)}&type=input`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`引擎读不到参考图 ${img}: HTTP ${r.status}`);
  }
  log(`前置门过:引擎${PORT} / 节点齐 / T8在册 / 双参考图可读`);

  await runOne();
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));

  // ── 指标后处理(引擎 venv python:PIL+numpy)──
  const metricsPy = path.join(OUT, "_metrics.py");
  fs.writeFileSync(
    metricsPy,
    [
      "import json",
      "from PIL import Image",
      `person=Image.open(${JSON.stringify(path.join(EH, "input", PERSON_REF))}).convert('RGB')`,
      `cloth=Image.open(${JSON.stringify(path.join(EH, "input", CLOTH_REF))}).convert('RGB')`,
      `out=Image.open(${JSON.stringify(path.join(OUT, "multiref-dual-4step.png"))}).convert('RGB')`,
      "m={",
      " 'person_ref_size': person.size,",
      " 'cloth_ref_size': cloth.size,",
      " 'output_size': out.size,",
      " 'unique_colors': len(set(out.getdata())),",
      " 'size_match_person_ref': out.size == person.size,",
      "}",
      "m['gate_unique_colors_ge_1000'] = m['unique_colors'] >= 1000",
      "m['gate_size_eq_person_ref'] = m['size_match_person_ref']",
      `json.dump(m,open(${JSON.stringify(path.join(OUT, "metrics.json"))},'w'),ensure_ascii=False,indent=1)`,
      "print(json.dumps(m,ensure_ascii=False))",
    ].join("\n"),
  );
  const mres = spawnSync(`${EH}/venv/bin/python`, [metricsPy], { encoding: "utf8", timeout: 120000 });
  if (mres.status !== 0) throw new Error("指标脚本异常: " + (mres.stderr || "").slice(0, 400));
  const metrics = JSON.parse(fs.readFileSync(path.join(OUT, "metrics.json"), "utf8"));
  report.gates = {
    unique_colors_ge_1000: { pass: metrics.gate_unique_colors_ge_1000, value: metrics.unique_colors },
    size_eq_person_ref: { pass: metrics.gate_size_eq_person_ref, output: metrics.output_size, person_ref: metrics.person_ref_size },
  };
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));

  const allPass = Object.values(report.gates).every((g) => g.pass);
  fs.writeFileSync(
    path.join(OUT, "EXIT.json"),
    JSON.stringify({ exit: allPass ? 0 : 1, gates: report.gates, finishedAt: new Date().toISOString() }, null, 1),
  );
  console.log(JSON.stringify({ gates: report.gates, run: report.runs[0] }, null, 1));
  if (!allPass) process.exitCode = 1;
}

try {
  await main();
  process.exit(process.exitCode || 0);
} catch (e) {
  report.fatal = e.message;
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, "EXIT.json"), JSON.stringify({ exit: 1, error: e.message, finishedAt: new Date().toISOString() }));
  console.error("FATAL:", e.message);
  process.exit(1);
}
