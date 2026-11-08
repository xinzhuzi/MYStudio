/**
 * W0 机检 spike(一次性,implement.md P0.2):验证 script-draft-metrics.ts 能否脱离 App 独立
 * 跑任意剧本章。只读探查,不并入任何评判程序,不接线。
 *
 * 用法(仓规:vite-node 必须从 apps/ 起):
 *   cd apps && ./node_modules/.bin/vite-node build/scripts/w0_spike.mjs <剧本.md>
 *   # 不带参数则默认跑 chapter-003_漫剧.md
 * 输出:stdout 打印 metrics/flags JSON。
 */
import { readFileSync } from "node:fs";
import { analyzeScriptDraft, formatScriptDraftMetrics } from "../../frontend/lib/studio/script-draft-metrics.ts";

const argPath = process.argv[2] ?? "/Users/zhengbingjin/Project/IP/MA/novel/drama/chapter-003_漫剧.md";
const text = readFileSync(argPath, "utf8");

// durationMin 从剧本头部「| 时长:N分钟」自述提取(与 App 侧调用同源口径的极简替代);
// 提不到则落到 analyzeScriptDraft 内部默认 3 分钟,与该函数缺省行为一致。
const durMatch = /时长[：:]\s*(\d+(?:\.\d+)?)\s*分钟/.exec(text);
const durationMin = durMatch ? Number(durMatch[1]) : undefined;

const metrics = analyzeScriptDraft(text, durationMin === undefined ? {} : { durationMin });

console.log("=== raw metrics JSON ===");
console.log(JSON.stringify({ file: argPath, durationMin: durationMin ?? 3, ...metrics }, null, 2));
console.log("=== formatted (App 审核注入同款输出) ===");
console.log(formatScriptDraftMetrics(metrics));
