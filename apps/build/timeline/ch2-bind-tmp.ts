// ch2 CAS 绑定（store 分片级）：ttsJob + shotAudioBindings + audioRef → store 级四门终验
// 前置: /tmp/ch2_writeback_v4.mjs 已跑(store 有 ch2 分镜分片) + MYSTUDIO_NARRATOR_INPUT=ch2 契约
// 章清单(manifest)不在此步——visualSource 需帧,归渲染面另轮(w1-cas-chain 分轮口径)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { readStudioWorkflowStoreState, deriveStorageRoots, resolveTimelineSourcePath } from "./storage-paths";
import { createCliTtsFingerprint } from "./cli-tts-fingerprint";
import { extractScriptVoiceLines } from "@/lib/studio/script-draft-metrics";
import { runScriptPrecheck } from "@/lib/studio/script-precheck";
import type { PersistedTtsState } from "@/stores/tts/tts-store";
import type { StoryboardItem } from "@/types/studio-storyboard-types";

const MA = "/Users/zhengbingjin/Project/IP/MA";
const PID = "49dce4c1-64b1-42de-85c2-9f266698aec4";
const CID = "chapter-002";
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

function normalize(value: unknown, p: string, anc: Set<object>): unknown {
  if (value === null || ["string", "boolean"].includes(typeof value)) return value;
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new TypeError(p); return value; }
  if (value === undefined || typeof value !== "object" || anc.has(value)) throw new TypeError(p);
  anc.add(value);
  let out: unknown;
  if (Array.isArray(value)) out = value.map((v, i) => normalize(v, `${p}[${i}]`, anc));
  else {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) throw new TypeError(p);
    if (Object.getOwnPropertySymbols(value).length) throw new TypeError(p);
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) sorted[k] = normalize((value as Record<string, unknown>)[k], `${p}.${k}`, anc);
    out = sorted;
  }
  anc.delete(value);
  return out;
}
const canonicalJson = (v: unknown) => JSON.stringify(normalize(v, "$", new Set()));

// ── 0. 读态 ──
const store = readStudioWorkflowStoreState(MA);
if (!store) throw new Error("store 读取失败");
const tts = JSON.parse(fs.readFileSync(`${MA}/store/tts.json`, "utf8")).state as PersistedTtsState;
const sbs = (store.state.storyboards as StoryboardItem[]).filter((s) => s.episodeId === CID).sort((a, b) => a.index - b.index);
if (sbs.length !== 19) throw new Error(`ch2 分镜 ${sbs.length} 条 ≠ 19（写回未跑?）`);
const v2 = JSON.parse(fs.readFileSync("/tmp/ch2_v4/durations_v2.json", "utf8")) as Array<{ n: number; id: string; dur: number; newSha: string; voiceDur: number }>;

// ch1 绑定模板（字段形态单源）
const ch1Shard = fs.readdirSync(`${MA}/store/studio-workflow/chapters/chapter-001`).filter((f) => /^storyboards-001-.*\.json$/.test(f))[0]!;
const ch1Binding = JSON.parse(fs.readFileSync(`${MA}/store/studio-workflow/chapters/chapter-001/${ch1Shard}`, "utf8")).state.storyboards.find((s: StoryboardItem) => (s.shotAudioBindings ?? []).length > 0).shotAudioBindings[0];

// ── 1. 逐镜指纹（真值函数） ──
const roots = deriveStorageRoots(MA);
const resolveMedia = (mediaPath: string) => {
  if (mediaPath.startsWith("asset-file://")) return path.join(MA, "store", "assets", "files", decodeURIComponent(mediaPath.replace("asset-file://", "")));
  return resolveTimelineSourcePath({ sourcePath: mediaPath, dataRoot: roots.dataRoot, mediaRoot: roots.mediaRoot });
};
const fps = new Map<string, string>();
for (const sb of sbs) {
  const r = await createCliTtsFingerprint({ state: store.state, tts, storyboard: sb, projectId: PID, chapterId: CID, resolveMedia });
  fps.set(sb.id, r.fingerprint);
}

// ── 2. 写入分片（就地编辑,文件名保持） ──
const manifest = JSON.parse(fs.readFileSync(`${MA}/store/studio-workflow/manifest.json`, "utf8"));
const shardRel = manifest.shards.find((s: string) => /^chapters\/chapter-002\/storyboards-/.test(s));
if (!shardRel) throw new Error("ch2 storyboards 分片未注册");
const shardPath = `${MA}/store/studio-workflow/${shardRel}`;
const shard = JSON.parse(fs.readFileSync(shardPath, "utf8"));
const now = Date.now();
for (const sb of shard.state.storyboards) {
  const v = v2.find((x) => x.id === sb.id)!;
  const fp = fps.get(sb.id)!;
  const rel = `remotion/audio/${CID}/shots/${sb.id}/voice/${v.newSha}.wav`;
  const binding = {
    ...ch1Binding,
    bindingId: `voice:${sb.id}:${fp}`,
    projectId: PID, chapterId: CID, shotId: sb.id,
    shotRevision: Math.max(1, sb.outputVersion ?? 1),
    role: "voice",
    source: { ...(ch1Binding.source as object), kind: "project-file", projectId: PID, relativePath: rel, contentSha256: v.newSha },
    sourceFingerprint: v.newSha,
    sourceDurationUs: Math.round(v.voiceDur * 1_000_000),
    sourceStartUs: 0, shotStartUs: 0,
    durationUs: Math.round(v.voiceDur * 1_000_000),
    ttsInputFingerprint: fp,
  };
  delete (binding as Record<string, unknown>).bindingFingerprint;
  (binding as Record<string, unknown>).bindingFingerprint = sha256(canonicalJson(binding));
  sb.shotAudioBindings = [binding];
  sb.audioRef = { kind: "audio", path: `project-file://${PID}/${rel}`, contentSha256: v.newSha };
  sb.ttsJob = { schemaVersion: 1, projectId: PID, chapterId: CID, shotId: sb.id, shotRevision: Math.max(1, sb.outputVersion ?? 1), inputFingerprint: fp, status: "completed", attempt: 1, createdAt: now, updatedAt: now };
}
fs.writeFileSync(shardPath, JSON.stringify(shard, null, 2) + "\n");
console.log("绑定写入:", shardRel);

// ── 3. store 级终验（复读 + 四门 + 指纹自检） ──
const store2 = readStudioWorkflowStoreState(MA);
const sbs2 = (store2!.state.storyboards as StoryboardItem[]).filter((s) => s.episodeId === CID).sort((a, b) => a.index - b.index);
const rows = sbs2.map((sb) => ({ index: sb.index, duration: sb.duration, lines: String(sb.lines ?? "") }));
const drafts = (store2!.state.agentWorkData as Array<{ key: string; episodeId: string; data: string; updatedAt: number }>).filter((e) => e.key === "scriptDraft" && e.episodeId === CID).sort((a, b) => b.updatedAt - a.updatedAt);
const script = drafts[0]!.data;
const r = runScriptPrecheck({ rows, scriptVoiceLines: extractScriptVoiceLines(script), durationCapSeconds: 195, sourceText: script });
const sum = rows.reduce((a, x) => a + x.duration, 0);
let fpOk = 0;
for (const sb of sbs2) {
  const b = (sb.shotAudioBindings ?? [])[0];
  if (!b) continue;
  const { bindingFingerprint: _d, ...input } = b;
  if (sha256(canonicalJson(input)) === b.bindingFingerprint && sb.ttsJob?.inputFingerprint === b.ttsInputFingerprint && sb.audioRef?.contentSha256 === b.source.contentSha256) fpOk++;
}
console.log(`store 终验: Σ=${sum.toFixed(2)} 四门 passed=${r.passed} 覆盖=${r.checks.dialogueCoverage?.coveredRatio} 指纹链=${fpOk}/19`);
if (!r.passed || sum > 195 || fpOk !== 19) { console.log("RED:", JSON.stringify((r as unknown as { red: string[] }).red ?? []).slice(0, 500)); process.exit(1); }
console.log("CH2 BIND DONE ✅");
