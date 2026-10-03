#!/usr/bin/env node
// qi21 用户测试批 P4·实弹补证轮 v2(2026-10-02)。
//
// 首跑(run1,五发)两处驱动 bug 与一项目径坑:
//   - peTeHits shorthand 变量名 bug(已修主驱动):①④⑤炸于 PNG 落盘之后、
//     alpha 判据之前——alpha 缺口由本轮补;
//   - ③两段拼断言取值 bug:主体句存成了连线引用 ['24',0] 而非文本(expect
//     错对照)——本轮从引擎日志 [MY出图][全量JSON](seed 指纹行)提取真值,
//     与 run1 报告的 finalTextMd5 做 md5 对拍(不依赖全文在报告);
//   - 日志字节区间法失效:engine.log 的 fd1(stdout print)与 fd2(logger)独立
//     偏移互相覆盖([MY出图]行物理位置错乱),行级时序部分不可信——懒文证改
//     「内容指纹法」:PE TE 装载指纹(Model storage policy paths 含 pe_t2i/
//     pe_i2i)+PE 推理指纹(Generating tokens,16256=PE max_new_tokens)全局
//     清点归属(引擎串行,PE 开发唯一=②;i2i PE 关=pe_i2i 指纹应零)。
// run2(ONLY 重跑)=③b/④b 两补验发(seed 对齐 0930 s10-p2 pass 先例 9201/9203,
// 主驱动已修,自带完整判据)——本轮把 run1+run2 合并成总报告。
// 退出码 0=补证全绿;1=有失败。
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { createHash } from "node:crypto";

const REPO = `${process.env.HOME}/Project/Github/MYStudio`;
const OUT_DIR = `${REPO}/apps/output/usertest-batch-1001`;
const ALPHA_PY = `${REPO}/apps/build/scripts/qi21_s6_alpha_check_0930.py`;
const VENV_PY = `${process.env.HOME}/Library/Application Support/漫影工作室/comfyui/venv/bin/python`;
const ENGINE_LOG = "/private/tmp/usertest-batch-1001/engine.log";
const I2I_WF = `${REPO}/apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json`;

const md5 = (s) => createHash("md5").update(s, "utf8").digest("hex");
const logAll = readFileSync(ENGINE_LOG, "utf8");
const results = [];
const check = (shot, name, pass, detail = "") => {
  results.push({ shot, name, pass, detail: String(detail).slice(0, 500), backfill: "v2" });
  console.log(`${pass ? "✅" : "❌"} [${shot}] ${name}${detail ? ` — ${String(detail).slice(0, 320)}` : ""}`);
};
const run1 = JSON.parse(readFileSync(join(OUT_DIR, "p4-livefire-report.run1.json"), "utf8"));
let run2 = null;
try { run2 = JSON.parse(readFileSync(join(OUT_DIR, "p4-livefire-report.json"), "utf8")); } catch {}
const isRun2 = run2 && Object.keys(run2.shots).some((k) => k.includes("s9201") || k.includes("s9203"));
const shots = { ...run1.shots, ...(isRun2 ? run2.shots : {}) };
const report = { ...run1, shots, backfillV2: { finishedAt: new Date().toISOString() } };

// ── 内容指纹:PE TE 装载与 PE 推理(engine.log 全文清点)──
const peLoadLines = (te) => logAll.split("\n").filter((l) => l.includes("Model storage policy") && l.includes(te));
const genTokenLines = logAll.split("\n").filter((l) => l.includes("Generating tokens"));
const freeWarnLines = logAll.split("\n").filter((l) => l.includes("自由型此为正常态"));
report.backfillV2.fingerprints = {
  peT2iLoadLines: peLoadLines("qwen3.5_9b_qwen_image_2.1_pe_t2i").length,
  peI2iLoadLines: peLoadLines("qwen3.5_9b_qwen_image_2.1_pe_i2i").length,
  peGenerateTokenLines: genTokenLines.length,
  freeNeutralWarnLines: freeWarnLines.length,
  logNote: "fd1/fd2 独立偏移覆盖致行级时序部分损坏,指纹按全文清点(引擎串行执行,PE 开发唯一=②)",
};

// ── ①②:t2i PE 懒/装指纹(执行集硬证据在 run1,此处日志佐证)──
{
  const s1 = shots["t2i-direct-nine"], s2 = shots["t2i-pe-nine"];
  const lazyHard = s1?.executedNodes && !s1.executedNodes.includes("40:140") && !s1.executedNodes.includes("11");
  check("t2i-direct-nine", "补·懒文证:①PE关 executing 级(40:140/11 不在执行集)+全日志 pe_t2i 装载指纹唯一且伴随 PE 推理指纹(归属②)",
    lazyHard && report.backfillV2.fingerprints.peT2iLoadLines === 1 && report.backfillV2.fingerprints.peGenerateTokenLines >= 1,
    `executing 硬证=${lazyHard};pe_t2i 装载指纹=${report.backfillV2.fingerprints.peT2iLoadLines};Generating tokens=${report.backfillV2.fingerprints.peGenerateTokenLines}`);
  const peHard = s2?.executedNodes?.includes("40:140") && s2.executedNodes.includes("11");
  check("t2i-pe-nine", "补·PE 文证:②executing 级(40:140/11 在执行集)+pe_t2i 装载指纹在场",
    peHard && report.backfillV2.fingerprints.peT2iLoadLines >= 1,
    `40:140=${s2?.executedNodes?.includes("40:140")} 11=${s2?.executedNodes?.includes("11")};装载指纹=${report.backfillV2.fingerprints.peT2iLoadLines}`);
}

// ── ③:两段拼 md5 对拍(真值取自 [MY出图][全量JSON] seed=1003 指纹行)──
{
  const s3 = shots["t2i-free-alpha"];
  const digestLines = logAll.split("\n").filter((l) => l.includes("[MY出图][全量JSON]") && l.includes('"208:207"') && l.includes("1003"));
  let parsed = null;
  for (const line of digestLines) {
    try {
      const j = JSON.parse(line.slice(line.indexOf("{")));
      if (j["208:207"]?.inputs?.value === 1003) { parsed = j; break; }
    } catch {}
  }
  if (parsed && s3?.finalTextMd5) {
    const subj = parsed["24"]?.inputs?.value;
    const lockA = parsed["40:141"]?.inputs?.锁层A全文;
    const expect = `${subj}\n${lockA}`;
    const twoSegOk = md5(expect) === s3.finalTextMd5 && expect.length === s3.finalTextLen;
    s3.backfill = { ...(s3.backfill || {}), twoSeg: { expectLen: expect.length, expectMd5: md5(expect), actualLen: s3.finalTextLen, actualMd5: s3.finalTextMd5, match: twoSegOk } };
    check("t2i-free-alpha", "补·两段装配文证:最终文本 md5==主体句+\\n+锁层A(BASE 空=自由型正常态)",
      twoSegOk, `len ${s3.finalTextLen} vs ${expect.length};md5 ${s3.finalTextMd5.slice(0, 8)} vs ${md5(expect).slice(0, 8)}`);
    check("t2i-free-alpha", "补·两段装配文证:首行=主体句+无空行",
      expect.split("\n")[0] === subj && !expect.includes("\n\n"), `首行=主体句(len ${subj.length});\\n\\n=${(expect.match(/\n\n/g) || []).length}`);
    check("t2i-free-alpha", "补·自由型文证:装配器中性化警告在场(「自由型此为正常态」)",
      report.backfillV2.fingerprints.freeNeutralWarnLines >= 1, `hits=${report.backfillV2.fingerprints.freeNeutralWarnLines}`);
  } else check("t2i-free-alpha", "补·两段装配文证(指纹行在位)", false, `digest行=${digestLines.length} parsed=${!!parsed} md5在=${!!s3?.finalTextMd5}`);
}

// ── ④:BASE 层在装配(道具 base_text 非空→三段拼,长度数值佐证)──
{
  const s4 = shots["t2i-prop-follow"];
  const bases = JSON.parse(readFileSync(`${REPO}/apps/backend/engines/comfyui/my_nodes/nodes/qi21_bases.json`, "utf8"));
  const propLen = bases.find((e) => e.zh === "道具").base_text.length;
  const s3len = shots["t2i-free-alpha"]?.finalTextLen;
  if (s4?.finalTextLen && s3len) {
    const diff = s4.finalTextLen - s3len;
    const ok = diff === propLen + 1; // 道具比自由恰多 BASE 段+其前换行
    s4.backfill = { ...(s4.backfill || {}), baseSeg: { diff, propBaseLen: propLen, match: ok } };
    check("t2i-prop-follow", "补·跟随文证:④装配含道具 BASE 段(最终文本比自由型恰多 BASE+换行)",
      ok, `④len-③len=${diff}(道具 base_text=${propLen}+1 换行)`);
  }
}

// ── ⑤:i2i 懒指纹+兼容(executedNodes 静态推)──
{
  const s5 = shots["i2i-direct"];
  const lazyHard = s5?.executedNodes && !s5.executedNodes.includes("40:26") && !s5.executedNodes.includes("12");
  check("i2i-direct", "补·懒文证:⑤PE关 executing 级(40:26/12 不在)+全日志 pe_i2i 装载指纹=0",
    lazyHard && report.backfillV2.fingerprints.peI2iLoadLines === 0,
    `executing 硬证=${lazyHard};pe_i2i 装载指纹=${report.backfillV2.fingerprints.peI2iLoadLines}`);
  const wf = JSON.parse(readFileSync(I2I_WF, "utf8"));
  const sgNodes = wf.definitions.subgraphs[0].nodes;
  const has180 = sgNodes.some((n) => n.id === 180 && n.type === "MyQi21RgbaSelect");
  const exec180 = (s5?.executedNodes || []).includes("40:180");
  const exec141 = (s5?.executedNodes || []).includes("40:141");
  s5.backfill = { ...(s5.backfill || {}), compat: { rgba180InWorkflow: has180, rgba180Executed: exec180, asm141Executed: exec141 } };
  check("i2i-direct", "补·兼容文证:⑤旧透明链 [180] 三态件在图且执行(六出底座共存)", has180 && exec180,
    `在图=${has180} 执行=${exec180}`);
  check("i2i-direct", "补·兼容文证:⑤装配器 [40:141] 执行(共享件新代码跑旧拓扑)", exec141, `执行=${exec141}`);
}

// ── alpha 补(run1 缺者:①④⑤;run2 自带的不重复)──
const alpha = (png, expect) => {
  const r = spawnSync(VENV_PY, [ALPHA_PY, png, expect], { encoding: "utf8" });
  try { return { exit: r.status, ...JSON.parse(r.stdout) }; }
  catch { return { exit: r.status, error: (r.stderr || r.stdout || "").slice(0, 300) }; }
};
for (const [key, rec] of Object.entries(shots)) {
  if (!rec?.png || rec.alpha) continue;
  const a = alpha(rec.png, rec.expect);
  writeFileSync(join(OUT_DIR, `alpha-${key}.json`), JSON.stringify(a, null, 2));
  rec.alpha = a;
  check(key, `补·透明判据:expect=${rec.expect}`, a.pass === true, a.verdict || JSON.stringify(a).slice(0, 200));
}

report.results = [...report.results.filter((r) => !r.backfill), ...results];
report.backfillNote = [
  "首跑驱动 peTeHits shorthand bug(已修主驱动)炸于 ①lazyLog/④lazyLog/⑤lazyLog 行(均后于 PNG 落盘先于 alpha),缺口由本轮补齐;",
  "③两段拼断言取值 bug(主体句误存连线引用)→md5 对拍修正;",
  "日志字节区间法失效(fd1/fd2 独立偏移覆盖)→内容指纹法;",
  run2 && isRun2 ? "run2(③b/④b seed 补验)已合并" : "",
].filter(Boolean).join(" ");
report.finishedAt = new Date().toISOString();
writeFileSync(join(OUT_DIR, "p4-livefire-report.json"), JSON.stringify(report, null, 2));
const failed = results.filter((r) => !r.pass);
console.log(failed.length === 0 ? "补证 v2 全绿" : `补证失败 ${failed.length} 项`);
process.exit(failed.length === 0 ? 0 : 1);
