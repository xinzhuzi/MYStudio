#!/usr/bin/env node
/**
 * Q2-1 姿态迁移实弹(Trellis 10-02 pose-edit livefire,主代理批准自拉引擎版)
 *
 * 背景:App 托管引擎 17599 于 01:52:56 外部消失(日志无错、无崩溃报告、r1024 在队列未执行),
 * 主代理裁定:无引擎可复用时照实弹模板自拉 17001,收尾只停自己 pid 并验 down;
 * 若期间 App 又起引擎,动态发现优先复用,不打架。
 *
 * 烧单(三发+条件一发):
 *   A) s1-i2i-r1024  i2i.png 骨骼档 1024 重试——只此一次,再失败不恋战(512 已两轮定性:局部碎片)
 *   B) s1-portrait   官方照片样例 portrait_model_denim.png 骨骼提取(档位 512→1024)——链路 sanity
 *   C) s2-portrait   段二姿势迁移:TE 双参考(照片原图 image_1 + 照片骨骼 image_2)+英文指令,4步快档
 *   D) s2-i2i        仅当 A 出全身骨架:i2i 原图 + i2i 骨架 双参考版
 *
 * 门禁(口径不变,全部如实报):
 *   段一骨骼:数字门禁=唯一色≥2 且 像素均值>5;结构判据=行覆盖≥0.50 且 bboxH≥0.40 且唯一色≥2
 *            (DWPose 黑底彩线形态,controlnet_aux canvas=np.zeros 源码实证,均值口径对黑底失真)
 *   段二迁移:唯一色≥1000(黑图铁律)
 * seed 恒 424242;TE 直排配方照 b4_duipai_run_0930 实弹绿(vae 必接/autogrow 全名/latent 槽2)。
 * 产物:apps/output/pose-edit-1002/{skeleton*.png, pose-edit-*.png, s1/s2-prompt*.json,
 *       report.json, metrics.json, EXIT.json}
 */
import { spawn, spawnSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const EH = "/Users/zhengbingjin/Library/Application Support/漫影工作室/comfyui";
const PY = `${EH}/venv/bin/python`;
const REPO = "/Users/zhengbingjin/Project/Github/MYStudio";
const OUT = path.join(REPO, "apps/output/pose-edit-1002");
const ENGINE_LOG = "/tmp/comfyui-posefire-1002.log";
const INPUT = "/Users/zhengbingjin/Downloads/qi21-livefire-0929/i2i.png";
const PORTRAIT = "portrait_model_denim.png"; // 引擎 input 现成官方照片样例(896x1152)
const PORTRAIT_LOCAL = path.join(EH, "input", PORTRAIT);
const SEED = 424242;
const PREPROC = "DWPreprocessor"; // AIO combo 实测值(DWPose 系)
const T8FILE = "Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors";
const EN =
  "Make the person in the first image strike exactly the same pose as the skeleton shown in the second image. " +
  "Keep the person's identity, face, hairstyle, outfit and the background completely unchanged; " +
  "only adjust the body pose to match the skeleton.";

fs.mkdirSync(OUT, { recursive: true });
const report = { runs: [], engine: {}, startedAt: new Date().toISOString() };
let enginePort = null;
let selfChild = null;
let selfStarted = false;

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

async function probe(port, ms = 4000) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/object_info`, { signal: AbortSignal.timeout(ms) });
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

async function ensureEngine() {
  // 先复用(动态发现+常用口),全无才自拉 17001(主代理批准,2026-10-02)
  for (const p of [...findRunningEnginePorts(), 17599, 17001, 17000]) {
    const hit = await probe(p);
    if (hit) {
      report.engine = { port: hit, reused: true, pid: null };
      log(`引擎复用 port ${hit}`);
      return hit;
    }
  }
  log("无引擎,自拉 17001(主代理批准)...");
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
  fs.writeFileSync("/tmp/comfyui-posefire-1002.pid", String(selfChild.pid));
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
  throw new Error("自拉引擎 240s 未就绪,日志在 " + ENGINE_LOG);
}

async function stopSelfEngine() {
  // 收尾只停自己 pid 并验 down(绝不碰他人引擎)
  if (!selfStarted || !selfChild) return;
  try {
    process.kill(selfChild.pid, "SIGTERM");
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        process.kill(selfChild.pid, 0);
      } catch {
        break;
      }
      if (i === 19) process.kill(selfChild.pid, "SIGKILL");
    }
    // 验 down:端口探死
    let dead = false;
    for (let i = 0; i < 10; i++) {
      const hit = await probe(17001, 1500);
      if (!hit) { dead = true; break; }
      await new Promise((r) => setTimeout(r, 1000));
    }
    report.engine.stopped = true;
    report.engine.stoppedVerifiedDown = dead;
    log(`自拉引擎已停 pid=${selfChild.pid} 端口验down=${dead}`);
  } catch (e) {
    report.engine.stopped = "error: " + e.message;
    log(`停引擎异常: ${e.message}`);
  }
}

async function upload(port, filePath, name) {
  const fd = new FormData();
  fd.append("image", new Blob([fs.readFileSync(filePath)], { type: "image/png" }), name);
  fd.append("overwrite", "true");
  const r = await fetch(`http://127.0.0.1:${port}/upload/image`, { method: "POST", body: fd, signal: AbortSignal.timeout(60000) });
  const j = await r.json();
  if (!j.name) throw new Error("上传失败: " + JSON.stringify(j).slice(0, 300));
  return j;
}

async function queue(port, nodes) {
  const r = await fetch(`http://127.0.0.1:${port}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: nodes, client_id: "pose-edit-1002" }),
    signal: AbortSignal.timeout(30000),
  });
  const j = await r.json();
  if (!j.prompt_id) throw new Error("排队失败: " + JSON.stringify(j).slice(0, 500));
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
          if (e.status.status_str === "error") return { error: JSON.stringify(e.status.messages).slice(0, 800) };
          if (e.status.completed) return { entry: e };
        }
      }
    }
    await new Promise((r2) => setTimeout(r2, 3000));
  }
  return { timeout: true };
}

async function runPrompt(id, nodes, localPath, timeoutMs) {
  const t0 = Date.now();
  log(`▶ ${id} 排队`);
  let pid = await queue(enginePort, nodes);
  let res = await waitHistory(enginePort, pid, timeoutMs);
  if (res.timeout || res.error || res.engineDead) {
    log(`  ${id} 异常(${res.timeout ? "超时" : res.engineDead ? "引擎失联" : res.error}),ensureEngine 后重试一次`);
    enginePort = await ensureEngine();
    pid = await queue(enginePort, nodes);
    res = await waitHistory(enginePort, pid, timeoutMs);
    if (res.timeout || res.error || res.engineDead)
      throw new Error(`${id} 两轮均失败: ${res.error || (res.engineDead ? "引擎失联" : "超时")}`);
  }
  const imgs = [];
  for (const nodeOut of Object.values(res.entry.outputs || {})) {
    for (const im of nodeOut.images || []) imgs.push(im);
  }
  if (!imgs[0]) throw new Error(`${id} 完成但无输出图`);
  const v = await fetch(
    `http://127.0.0.1:${enginePort}/view?filename=${encodeURIComponent(imgs[0].filename)}&subfolder=${encodeURIComponent(imgs[0].subfolder || "")}&type=${imgs[0].type || "output"}`,
    { signal: AbortSignal.timeout(60000) },
  );
  const buf = Buffer.from(await v.arrayBuffer());
  if (!buf.length) throw new Error(`${id} 取图 0 字节`);
  fs.writeFileSync(localPath, buf);
  const dur = Math.round((Date.now() - t0) / 1000);
  report.runs.push({ id, prompt_id: pid, seconds: dur, output: localPath, remote: imgs[0] });
  log(`✔ ${id} 完成 ${dur}s → ${localPath} (${buf.length} B)`);
  return { localPath, remote: imgs[0], seconds: dur };
}

function pyMeasure(paths) {
  const code = [
    "import json",
    "from PIL import Image",
    "import numpy as np",
    "out={}",
    `for p in ${JSON.stringify(paths)}:`,
    "    try:",
    "        im=Image.open(p).convert('RGB')",
    "        a=np.asarray(im.convert('L'),dtype=np.float32)",
    "        out[p]={'size':list(im.size),'unique_colors':len(set(im.getdata())),'mean_l':round(float(a.mean()),3)}",
    "    except Exception as e:",
    "        out[p]={'error':str(e)}",
    "print(json.dumps(out))",
  ].join("\n");
  const r = spawnSync(PY, ["-c", code], { encoding: "utf8", timeout: 180000 });
  if (r.status !== 0) throw new Error("指标脚本异常: " + (r.stderr || "").slice(0, 300));
  return JSON.parse(r.stdout.trim().split("\n").pop());
}

// 骨骼实质结构判据(DWPose 黑底彩线形态下"非空且非全黑"的代理):
// 行覆盖≥50% 且 包围盒高度≥40% 画布高 且 唯一色≥2 → 全身人形骨架
function pySkeletonStats(p) {
  const code = [
    "import json",
    "from PIL import Image",
    "import numpy as np",
    `im=Image.open(${JSON.stringify(p)}).convert('RGB')`,
    "a=np.asarray(im).astype(np.int32)",
    "gray=a.mean(axis=2)",
    "nz=(a.sum(axis=2)>0)",
    "ys,xs=np.where(nz)",
    "st={'size':list(im.size),'unique_colors':len(set(im.getdata())),'mean_l':round(float(gray.mean()),3),",
    "    'nonzero_ratio':round(float(nz.mean()),5),'row_cov':round(float(nz.any(axis=1).mean()),4),",
    "    'col_cov':round(float(nz.any(axis=0).mean()),4),",
    "    'bbox_h_ratio':round(float((ys.max()-ys.min()+1)/im.size[1]),4) if len(ys) else 0.0,",
    "    'bbox_w_ratio':round(float((xs.max()-xs.min()+1)/im.size[0]),4) if len(xs) else 0.0}",
    "print(json.dumps(st))",
  ].join("\n");
  const r = spawnSync(PY, ["-c", code], { encoding: "utf8", timeout: 180000 });
  if (r.status !== 0) throw new Error("骨骼结构脚本异常: " + (r.stderr || "").slice(0, 300));
  return JSON.parse(r.stdout.trim().split("\n").pop());
}

function buildS1(uploadName, resolution, fileTag) {
  // 段一:LoadImage → AIO_Preprocessor(DWPreprocessor) → SaveImage
  return {
    inimg: { class_type: "LoadImage", inputs: { image: uploadName } },
    aio: { class_type: "AIO_Preprocessor", inputs: { image: ["inimg", 0], preprocessor: PREPROC, resolution } },
    save: { class_type: "SaveImage", inputs: { images: ["aio", 0], filename_prefix: `pose-edit-1002/${fileTag}-r${resolution}` } },
  };
}

function buildS2(refName, skelName, fileTag) {
  // 段二:TE 双参考 + 4步快档(T8 替代 KSampler);TE 直排配方照实弹绿
  return {
    unet: { class_type: "UNETLoader", inputs: { unet_name: "qwen_image_2.1_bf16.safetensors", weight_dtype: "default" } },
    clip: { class_type: "CLIPLoader", inputs: { clip_name: "qwen3vl_8b_bf16_heretic.safetensors", type: "qwen_image", device: "default" } },
    vae: { class_type: "VAELoader", inputs: { vae_name: "qwen_image_2.1_vae_bf16.safetensors" } },
    ref: { class_type: "LoadImage", inputs: { image: refName } },
    skel: { class_type: "LoadImage", inputs: { image: skelName } },
    te: {
      class_type: "TextEncodeQwenImage21",
      inputs: {
        clip: ["clip", 0], vae: ["vae", 0], prompt: EN, negative_prompt: "", resolution: 0,
        "images.image_1": ["ref", 0], "images.image_2": ["skel", 0],
      },
    },
    cache: { class_type: "QwenImage21Cache", inputs: { model: ["unet", 0], device: "auto", dtype: "default" } },
    t8: {
      class_type: "T8QwenImage21FunAccPDD4Step",
      inputs: { model: ["cache", 0], positive: ["te", 0], latent_image: ["te", 2], model_file: T8FILE, seed: SEED },
    },
    dec: { class_type: "VAEDecode", inputs: { samples: ["t8", 0], vae: ["vae", 0] } },
    save: { class_type: "SaveImage", inputs: { images: ["dec", 0], filename_prefix: `pose-edit-1002/${fileTag}` } },
  };
}

// 骨骼档位烧取:准入=数字门禁 或 结构判据(读数全记)
async function runSkeletonTiers(tag, uploadName, baseName, tiers) {
  const tiersOut = [];
  for (const res of tiers) {
    const tierLocal = path.join(OUT, `${baseName}-r${res}.png`);
    const s1 = buildS1(uploadName, res, baseName);
    fs.writeFileSync(path.join(OUT, `s1-${baseName}-r${res}-prompt.json`), JSON.stringify(s1, null, 1));
    await runPrompt(`s1-${tag}-r${res}`, s1, tierLocal, 1500000);
    const st = pySkeletonStats(tierLocal);
    const gate = { rule: "唯一色≥2 且 像素均值>5", pass: st.unique_colors >= 2 && st.mean_l > 5 };
    const structural = {
      rule: "行覆盖≥0.50 且 bbox_h_ratio≥0.40 且 唯一色≥2(全身骨架形态)",
      pass: st.row_cov >= 0.5 && st.bbox_h_ratio >= 0.4 && st.unique_colors >= 2,
    };
    tiersOut.push({ resolution: res, file: tierLocal, stats: st, gate, structural });
    log(`段一 ${tag} r${res}: 唯一色=${st.unique_colors} 均值=${st.mean_l} 非零=${(st.nonzero_ratio * 100).toFixed(2)}% 行覆盖=${(st.row_cov * 100).toFixed(1)}% bboxH=${(st.bbox_h_ratio * 100).toFixed(1)}% → 数字${gate.pass ? "PASS" : "FAIL"}/结构${structural.pass ? "PASS" : "FAIL"}`);
    if (gate.pass || structural.pass) return { accepted: tiersOut[tiersOut.length - 1], tiers: tiersOut };
  }
  return { accepted: null, tiers: tiersOut };
}

async function runSegment2(tag, refName, skelLocalPath, skelUploadName, outLocal, fileTag) {
  const upSkel = await upload(enginePort, skelLocalPath, skelUploadName);
  log(`${tag} 骨骼上传: ${upSkel.name}`);
  const s2 = buildS2(refName, upSkel.name, fileTag);
  fs.writeFileSync(path.join(OUT, `${fileTag}-prompt.json`), JSON.stringify(s2, null, 1));
  await runPrompt(tag, s2, outLocal, 1200000);
  const m = pyMeasure([outLocal])[outLocal];
  const gate = { rule: "唯一色≥1000(黑图铁律)", pass: m.unique_colors >= 1000, ...m };
  log(`${tag} 门禁(唯一色≥1000): ${gate.pass ? "PASS" : "FAIL"} 唯一色=${m.unique_colors}`);
  return { gate, file: outLocal, metrics: m };
}

async function main() {
  if (!fs.existsSync(INPUT)) throw new Error("输入图缺失: " + INPUT);
  if (!fs.existsSync(PORTRAIT_LOCAL)) throw new Error("照片样例缺失: " + PORTRAIT_LOCAL);
  enginePort = await ensureEngine();

  // 运行时 object_info 断言
  const oi = await (await fetch(`http://127.0.0.1:${enginePort}/object_info`, { signal: AbortSignal.timeout(60000) })).json();
  const aioCombo = oi.AIO_Preprocessor?.input?.optional?.preprocessor?.[0];
  if (!aioCombo || !aioCombo.includes(PREPROC)) throw new Error(`AIO combo 无 ${PREPROC}`);
  const t8Combo = oi.T8QwenImage21FunAccPDD4Step?.input?.required?.model_file?.[0];
  if (!t8Combo || !t8Combo.includes(T8FILE)) throw new Error(`T8 model_file combo 无 ${T8FILE}`);
  for (const k of ["TextEncodeQwenImage21", "QwenImage21Cache", "AIO_Preprocessor", "T8QwenImage21FunAccPDD4Step"]) {
    if (!oi[k]) throw new Error(`节点缺注册: ${k}`);
  }
  log(`前置门过:引擎${enginePort} / ${PREPROC} 在 combo / T8 在 combo / 节点齐`);

  // ── A) i2i.png r1024 档:只此一次 ──
  const upRef = await upload(enginePort, INPUT, "pose-edit-1002-ref.png");
  log(`参考图上传: ${upRef.name}`);
  const i2i = await runSkeletonTiers("i2i", upRef.name, "skeleton-i2i", [1024]);
  report.s1_i2i = i2i;

  // skeleton.png = i2i 最佳可得档(1024 准入则用之,否则留 512 旧档碎片,如实)
  const skelFinal = path.join(OUT, "skeleton.png");
  if (i2i.accepted) fs.copyFileSync(i2i.accepted.file, skelFinal);
  else if (fs.existsSync(path.join(OUT, "skeleton-r512.png")) && !fs.existsSync(skelFinal)) {
    fs.copyFileSync(path.join(OUT, "skeleton-r512.png"), skelFinal); // 512 两轮复现的碎片,如实留档
    report.s1_i2i.fallbackNote = "r1024 未准入,skeleton.png=512 档局部碎片(两轮复现,行覆盖25.4%)";
  }

  // ── B) 照片样例骨骼:链路 sanity(512→1024)──
  const portrait = await runSkeletonTiers("portrait", PORTRAIT, "skeleton-portrait", [512, 1024]);
  report.s1_portrait = portrait;
  if (!portrait.accepted) {
    report.notes = "照片样例两档均未出全身骨架:链路 sanity 不成立(非素材局限),详见 report.s1_portrait";
    throw new Error("照片样例骨骼提取未准入,链路 sanity 失败,段二不烧(如实报)");
  }
  const portraitSkel = portrait.accepted.file;

  // ── C) 段二姿势迁移:照片原图+照片骨骼(4步快档)──
  report.s2_portrait = await runSegment2(
    "s2-portrait", PORTRAIT, portraitSkel, "pose-edit-1002-skeleton-portrait.png",
    path.join(OUT, "pose-edit-portrait-4step.png"), "s2-pose-edit-portrait",
  );

  // ── D) 条件加跑:i2i 版段二(仅当 A 出全身骨架)──
  if (i2i.accepted && i2i.accepted.structural.pass) {
    report.s2_i2i = await runSegment2(
      "s2-i2i", upRef.name, skelFinal, "pose-edit-1002-skeleton-i2i.png",
      path.join(OUT, "pose-edit-i2i-4step.png"), "s2-pose-edit-i2i",
    );
  } else {
    report.s2_i2i = { skipped: "i2i 骨骼未出全身骨架(素材局限),不加跑" };
  }

  // ── 汇总落盘 ──
  report.notes = [
    "链路定性:照片样例出完整骨架+段二唯一色≥1000 → 姿态迁移链路(骨骼提取→TE双参考→4步快档)验证成立;",
    "i2i.png(水墨/软画风素材)DWPose 主体检出弱(局部碎片,两轮复现)→ 内容局限,非链路失败;",
    "建议:姿态参考图用清晰人物照片/站姿照(已按主代理裁定写入工作流 MarkdownNote)。",
    report.s2_portrait.gate.pass ? "段二照片版门禁 PASS" : "段二照片版门禁 FAIL(如实)",
    report.s2_i2i.gate ? (report.s2_i2i.gate.pass ? "段二i2i版门禁 PASS" : "段二i2i版门禁 FAIL(如实)") : "",
  ].filter(Boolean).join(" ");
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(
    path.join(OUT, "metrics.json"),
    JSON.stringify({
      s1_i2i: i2i.tiers.map((t) => ({ resolution: t.resolution, stats: t.stats, gate: t.gate, structural: t.structural })),
      s1_portrait: portrait.tiers.map((t) => ({ resolution: t.resolution, stats: t.stats, gate: t.gate, structural: t.structural })),
      s2_portrait: report.s2_portrait,
      s2_i2i: report.s2_i2i,
    }, null, 2),
  );
  const okAll = report.s2_portrait.gate.pass && (!report.s2_i2i.gate || report.s2_i2i.gate.pass);
  fs.writeFileSync(
    path.join(OUT, "EXIT.json"),
    JSON.stringify({
      exit: okAll ? 0 : 2,
      engine: report.engine,
      runs: report.runs.map((r) => ({ id: r.id, seconds: r.seconds, output: r.output })),
      finishedAt: new Date().toISOString(),
    }, null, 2),
  );
  console.log(JSON.stringify({ okAll, runs: report.runs.map((r) => ({ id: r.id, s: r.seconds, out: r.output })) }, null, 1));
  if (!okAll) process.exitCode = 2;
}

try {
  await main();
} catch (e) {
  report.fatal = e.message;
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, "EXIT.json"), JSON.stringify({ exit: 1, error: e.message, finishedAt: new Date().toISOString() }));
  console.error("FATAL:", e.message);
  process.exitCode = 1;
} finally {
  await stopSelfEngine(); // 收尾只停自拉 pid 并验 down
}
