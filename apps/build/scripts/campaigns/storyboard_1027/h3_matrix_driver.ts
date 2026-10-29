/**
 * ch1 H3 三镜实测矩阵驱动(1029)——回答用户"没感情像念剧本,H3 会吗"。
 * 测试小队(产线文档§四):003 双人对白/002 单人对白/012 纯旁白。
 * 480P 草稿档(334s/镜实测);MyShot(100) 从 API 图摘除=回收链依赖 app sidecar,
 * 独立跑必摘,产物由本驱动直取引擎 output。
 *
 * 引擎目标预检(10-29 收账:App 外直投不得盲打本地引擎):ENGINE 不再顶层
 * 硬编码缺省,改 main() 开头经 h3_engine_target.resolveEngineTarget 决议——
 * sidecar 路由 source=settings(已指远端)→拒绝盲投本地退出;H3_ENGINE 显式
 * →env 胜出;sidecar 未起→缺省 17001(存量独立跑零变化)。
 */
import fs from "node:fs";
import path from "node:path";
import { buildShotH3ApiWorkflow } from "@/lib/assist/image-studio/h3-shot-video-workflow";
import { dialogueAudioPolicy } from "@/lib/assist/image-studio/h3-shot-prompt";
import type { StoryboardItem } from "@/types/studio";
import { resolveControlToken, resolveEngineTarget } from "./h3_engine_target";

const MA = "/Users/zhengbingjin/Project/IP/MA";
const OUT = "/Users/zhengbingjin/Project/Github/MYStudio/apps/output/ch1_h3_matrix_1029";

const SQUAD = [
  { sid: "001", mood: "凶狠咆哮" },
  { sid: "002", mood: "阴冷嗤笑" },
  { sid: "003", mood: "厉声凶狠" },
  { sid: "004", mood: "低沉压抑" },
  { sid: "005", mood: "嘶哑恳切" },
  { sid: "006", mood: "冷漠讥讽" },
  { sid: "007", mood: "阴冷刻薄" },
  { sid: "008", mood: "低沉喑哑" },
  { sid: "009", mood: "公事公办" },
  { sid: "010", mood: "沉稳教导" },
  { sid: "011", mood: "沉稳教导" },
  { sid: "012", mood: "低沉凝重" },
  { sid: "013", mood: "漠然" },
  { sid: "014", mood: "平淡点名" },
  { sid: "015", mood: "漠然" },
  { sid: "016", mood: "低沉凝重" },
  { sid: "017", mood: "压抑" },
  { sid: "018", mood: "轻狂傲慢" },
  { sid: "019", mood: "低沉悬疑" },
] as const;

function readShots(): Map<string, StoryboardItem> {
  const map = new Map<string, StoryboardItem>();
  for (const f of fs.readdirSync(path.join(MA, "store/studio-workflow/chapters/chapter-001"))) {
    if (!f.startsWith("storyboards-") || !f.endsWith(".json")) continue;
    const doc = JSON.parse(fs.readFileSync(path.join(MA, "store/studio-workflow/chapters/chapter-001", f), "utf8"));
    for (const it of doc.state.storyboards as StoryboardItem[]) map.set(it.id.slice(-3), it);
  }
  return map;
}

// 预检 fetch:全局 fetch + 3s 超时(sidecar 端口未监听多即时 ECONNREFUSED;网络黑洞兜超时)
async function precheckFetch(url: string, init: { headers: Record<string, string> }) {
  return fetch(url, { headers: init.headers, signal: AbortSignal.timeout(3000) });
}

async function resolveEngine(): Promise<string> {
  const target = await resolveEngineTarget(process.env, precheckFetch, () => resolveControlToken(process.env));
  if (target.kind === "abort") {
    console.error(`[engine-target] ${target.message}`);
    process.exit(1);
  }
  console.log(`[engine-target] 使用引擎 ${target.engine}(${target.note})`);
  return target.engine;
}

async function main() {
  const shots = readShots();
  const ENGINE = await resolveEngine();
  const only = process.env.H3_ONLY?.split(",");
for (const { sid, mood } of SQUAD) {
    if (only && !only.includes(sid)) continue;
    const shot = shots.get(sid);
    if (!shot) throw new Error(`镜 ${sid} 不在 store`);
    const policy = dialogueAudioPolicy(shot.lines ?? "");
    const img = path.join(MA, "workflow-images/chapter-001/storyboard-1027", `sb-chapter-001-${sid}.png`);
    const imageName = `h3test-${sid}.png`;
    const built = buildShotH3ApiWorkflow({
      shot, chapterId: "chapter-001", chapterLabel: "第一章", policy,
      voiceMood: mood, imageName,
      firstFrameB64: fs.readFileSync(img).toString("base64"),
      resolutionTier: "480p",
      ...(process.env.H3_RECIPE ? { recipeId: process.env.H3_RECIPE } as never : {}),
    });
    // 摘 MyShot(100):独立跑无 sidecar,回收链节点会 POST 失败炸整图;它是终端消费者,摘除安全
    delete (built.apiGraph as Record<string, unknown>)["100"];
    // 摘 BlockCacheT8(48):隔离引擎 MPS refresh 边界静默崩(坑清单§七#2),41.model 直连 34(fasth3 无 41/48 则跳过)
    const graph = built.apiGraph as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
    if (graph["48"]) { delete graph["48"]; if (graph["41"]) graph["41"].inputs.model = ["34", 0]; }
    fs.writeFileSync(path.join(OUT, `wf_${sid}.json`), JSON.stringify(built.apiGraph));
    fs.writeFileSync(path.join(OUT, `prompt_${sid}.txt`), String((built.apiGraph["14"] as { inputs: { value: unknown } }).inputs.value));
    console.log(`[${sid}] policy=${policy} seconds=${(built.apiGraph["20"] as { inputs: { value: number } }).inputs.value} 报告=${JSON.stringify(built.report)}`);
    // 上传首帧
    const fd = new FormData();
    fd.append("image", new Blob([Buffer.from(built.images[0]!.b64, "base64")], { type: "image/png" }), imageName);
    fd.append("overwrite", "true");
    const up = await fetch(`${ENGINE}/upload/image`, { method: "POST", body: fd });
    if (!up.ok) throw new Error(`上传 ${sid} 首帧 HTTP ${up.status}`);
    // 提交
    const sub = await fetch(`${ENGINE}/prompt`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: built.apiGraph, client_id: "h3-matrix-1029" }),
    });
    const subBody = await sub.json() as { prompt_id?: string; error?: unknown };
    if (!sub.ok || !subBody.prompt_id) throw new Error(`提交 ${sid} 失败: ${JSON.stringify(subBody).slice(0, 200)}`);
    fs.writeFileSync(path.join(OUT, `pid_${sid}.txt`), subBody.prompt_id);
    console.log(`[${sid}] 提交 pid=${subBody.prompt_id}`);
  }
  console.log("三镜全部提交,轮询取片交给 poll 脚本");
}

// VITEST 守卫:vitest 自带 VITEST env(测试 import 本文件不得真投+process.exit 杀
// 测试进程);tsx/node 正跑无该 env,main 照常执行。
if (!process.env.VITEST) {
  main().catch((e) => { console.error("FATAL:", e instanceof Error ? e.message : e); process.exit(1); });
}
