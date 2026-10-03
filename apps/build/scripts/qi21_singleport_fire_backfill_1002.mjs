#!/usr/bin/env node
// qi21 单口实弹三发 backfill 补验(10-02-qi21-subgraph-singleport)。
//
// 缘起(如实记账):fire 驱动器 fireShot 主体把 >400 字的 finalText 置 undefined
// (报告不留长全文),而 f1 锚句/f2 结构/f3 结构+剥离+重构断言消费 rec.finalText
// →三发文本结构断言在主驱动器里如红(坑6 断言构造缺陷族);md5 证不受影响已绿。
// 本脚本从 /history/{pid} 重取 [401] 预览全文,零额外采样补齐全部文本断言
// (先例:qi21_usertest_livefire_backfill_1001.mjs 同款事后取证)。
//
// 断言集(三证法文证口径,与主驱动器同名断言一一对应):
//   f1:预览全文===主体句\nBASE\n锁层A(逐字)+含人物 BASE 锚句;
//   f2:预览全文===头句+装配全文+W1+尾句(逐字公式直比,强于前缀后缀);
//   f3:头句前缀/尾句后缀/W1 收尾+剥离段 strip 幂等(词族零命中)+ascii 域
//      +compose 重构(pe开+透明+PE出文=剥离段)md5==预览 md5。
// 产物:apps/output/singleport-1002/fire/backfill-report.json。退出码 0=全绿。
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const ENGINE = process.env.ENGINE_URL || "http://127.0.0.1:17599";
const REPO = `${process.env.HOME}/Project/Github/MYStudio`;
const OUT_DIR = `${REPO}/apps/output/singleport-1002/fire`;
const FIRE_REPORT = join(OUT_DIR, "fire-report.json");
const BASES_JSON = `${process.env.HOME}/Library/Application Support/漫影工作室/comfyui/ComfyUI/custom_nodes/my-nodes/nodes/qi21_bases.json`;
const VENV_PY = `${process.env.HOME}/Library/Application Support/漫影工作室/comfyui/venv/bin/python`;
const COMPOSE_PROBE = `${REPO}/apps/build/scripts/qi21_singleport_compose_probe_1002.py`;
const md5 = (s) => createHash("md5").update(s, "utf8").digest("hex");
const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail: String(detail).slice(0, 600) });
  console.log(`${pass ? "✅" : "❌"} ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ""}`);
};

function composeProbe(payload) {
  return new Promise((resolve) => {
    const p = spawn(VENV_PY, [COMPOSE_PROBE], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => {
      try { resolve({ exit: code, ...JSON.parse(out) }); }
      catch { resolve({ exit: code, error: (err || out).slice(0, 400) }); }
    });
    p.stdin.write(JSON.stringify(payload)); p.stdin.end();
  });
}

// 主驱动器排队图快照不在报告里,但 BASE/主体句/锁层A/头尾W1 均真源可重建:
// 头/尾/W1=件 default 官方值(排队图逐字锚已由 engine_up+loadgraph 双验);
// 主体句=[400] 工作流 wv;锁层A=[4011] default(工作流 wv)。BASE=引擎家热读。
const wf = JSON.parse(readFileSync(`${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json`, "utf8"));
const sg = wf.definitions.subgraphs.find((s) => s.id === "96937bbe-99d1-4f16-a06c-d86b57815d91");
const selNode = sg.nodes.find((n) => n.id === 4014);
const asmNode = sg.nodes.find((n) => n.id === 4011);
const HEAD = selNode.widgets_values[4], TAIL = selNode.widgets_values[5], W1 = selNode.widgets_values[6];
const SUBJECT = wf.nodes.find((n) => n.id === 400).widgets_values[0];
const LOCK_A = asmNode.widgets_values[1]; // [4011] wv=2 值形:[主体句例文,锁层A](实测 len1174==主报 lockALen)
const bases = JSON.parse(readFileSync(BASES_JSON, "utf8"));
const baseOf = (zh) => bases.find((e) => e && e.zh === zh)?.base_text ?? "";

const fire = JSON.parse(readFileSync(FIRE_REPORT, "utf8"));
const out = { mode: "singleport-1002-fire-backfill", finishedAt: new Date().toISOString(), results, evidence: {} };

for (const [key, typeName] of [["f1-char-peoff-opaque", "人物"], ["f2-free-peoff-alpha", "自由"], ["f3-free-peon-alpha", "自由"]]) {
  const shot = fire.shots[key];
  const pid = shot?.pid;
  if (!pid) { check(`[${key}] history pid 在位`, false, "(主驱动器未 POST 或失败)"); continue; }
  const hist = await (await fetch(`${ENGINE}/history/${pid}`)).json();
  const outputs = hist[pid]?.outputs || {};
  const text = outputs["401"]?.ui?.text?.[0] ?? outputs["401"]?.text?.[0] ?? null;
  if (typeof text !== "string") { check(`[${key}] [401] 预览全文重取`, false, JSON.stringify(Object.keys(outputs))); continue; }
  check(`[${key}] [401] 预览全文重取(len=${text.length},md5=${md5(text)})`, true, "");
  // 与主驱动器 md5 对拍(两路独立取文一致)
  check(`[${key}] 重取 md5 == 主驱动器 finalTextMd5`, md5(text) === shot.finalTextMd5,
    `重取=${md5(text)};主报=${shot.finalTextMd5}`);
  out.evidence[key] = { len: text.length, md5: md5(text) };

  const baseText = baseOf(typeName);
  const assembly = baseText.trim() ? `${SUBJECT}\n${baseText}\n${LOCK_A}` : `${SUBJECT}\n${LOCK_A}`;
  if (key.startsWith("f1")) {
    check("[f1] 预览全文===主体句\\nBASE\\n锁层A 逐字(pe关+透明关=装配全文原样)",
      text === assembly, `len=${text.length}/${assembly.length};同md5=${md5(text) === md5(assembly)}`);
    check("[f1] 预览含人物型 BASE 锚句(头身比约七头半)", text.includes("头身比约七头半"), "");
    check("[f1] 预览三段拼接形:主体句段+BASE段+锁层A段各自逐字在位",
      text.startsWith(SUBJECT) && text.includes(`\n${baseText}\n`) && text.endsWith(LOCK_A), "");
  } else if (key.startsWith("f2")) {
    const expectText = `${HEAD} ${assembly} ${W1} ${TAIL}`;
    check("[f2] 预览全文===头句+装配全文+W1+尾句 逐字公式(pe关+透明开,BASE 空两段)",
      text === expectText, `len=${text.length}/${expectText.length};同md5=${md5(text) === md5(expectText)}`);
    check("[f2] 装配全文段逐字在位(头句后一格起至 W1 前一格)", text.includes(` ${assembly} `), "");
  } else {
    check("[f3] 头句逐字前缀+尾句逐字后缀", text.startsWith(HEAD) && text.endsWith(TAIL),
      `head=${text.slice(0, 24)}…;tail=…${text.slice(-24)}`);
    const mid = text.length > HEAD.length + TAIL.length + 2 ? text.slice(HEAD.length + 1, text.length - TAIL.length - 1) : "";
    const midOk = typeof W1 === "string" && mid.endsWith(W1);
    const stripped = midOk ? mid.slice(0, mid.length - W1.length - 1) : "";
    check("[f3] 中段=剥离(PE出文)+空格+W1(W1 逐字收尾)", midOk && stripped.length > 100,
      `midLen=${mid.length};strippedLen=${stripped.length}`);
    if (midOk && stripped) {
      const stripProbe = await composeProbe({ mode: "strip", text: stripped });
      check("[f3] 剥离段词族零命中(实调 strip 幂等=PE出文已剥离)",
        stripProbe.exit === 0 && stripProbe.changed === false,
        `changed=${stripProbe.changed};${stripProbe.orig_len}/${stripProbe.stripped_len}${stripProbe.error ? ";ERR=" + stripProbe.error : ""}`);
      const asciiRatio = (stripped.match(/[\x20-\x7e]/g) || []).length / stripped.length;
      check("[f3] 剥离段 ascii>0.6(PE出文英文域,非装配中文直写)", asciiRatio > 0.6, `ratio=${asciiRatio.toFixed(2)}`);
      const probe = await composeProbe({
        mode: "compose", 装配全文: null, PE出文: stripped, pe开关: true, 透明模式: true,
        RGBA官方头句: HEAD, RGBA官方尾句: TAIL, W1收束句: W1,
      });
      check("[f3] compose 重构(pe开+透明+PE出文=剥离段)md5==预览(证2×证3 闭环)",
        probe.exit === 0 && probe.md5 === md5(text),
        `probe=${probe.md5};预览=${md5(text)}${probe.error ? ";ERR=" + probe.error : ""}`);
      out.evidence[key].strippedLen = stripped.length; out.evidence[key].asciiRatio = Number(asciiRatio.toFixed(3));
    }
  }
}
writeFileSync(join(OUT_DIR, "backfill-report.json"), JSON.stringify(out, null, 2));
const failed = results.filter((r) => !r.pass);
console.log(failed.length === 0 ? "backfill 全绿" : `backfill 失败 ${failed.length} 项`);
process.exit(failed.length === 0 ? 0 : 1);
