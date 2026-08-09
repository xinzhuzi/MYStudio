// 纯 node 探针(零项目依赖):核验 video-chapter-001-scene-5 在多少个 store/backup 文件里出现,
// 以及 mergeArtifactRecords 累积后会有多少条 backup physicalRef。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PROJ = "/Users/zhengbingjin/Library/Application Support/漫影工作室/projects/_p/49dce4c1-64b1-42de-85c2-9f266698aec0";
const TARGET_CANDIDATE = "video-chapter-001-scene-5";

function walk(dir, acc=[]) {
  let ents;
  try { ents = readdirSync(dir); } catch { return acc; }
  for (const e of ents) {
    const full = join(dir, e);
    let st; try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

const allFiles = walk(PROJ);
// store / backup 文件:含 studio-workflow-store 或 .bak-/.codex- 的 json
const storeFiles = allFiles.filter(f => /studio-workflow-store/.test(f) && /\.(json|bak-|codex-)/.test(f));
console.log("项目下 store/backup 文件总数:", storeFiles.length);

let liveHit = 0, backupHit = 0;
const hitFiles = [];
for (const f of storeFiles) {
  let txt; try { txt = readFileSync(f, "utf8"); } catch { continue; }
  if (!txt.includes(TARGET_CANDIDATE)) continue;
  const isBackup = /\.bak-|\.codex-|visual-continuity-backups/.test(f);
  hitFiles.push({ f: f.replace(PROJ, "."), isBackup, size: txt.length });
  if (isBackup) backupHit++; else liveHit++;
}

console.log(`\n含 "${TARGET_CANDIDATE}" 的文件:`);
console.log("  live store 命中:", liveHit);
console.log("  backup 文件命中:", backupHit);
console.log("  合计命中文件:", hitFiles.length);
console.log("\n命中文件清单(前 50):");
hitFiles.slice(0,50).forEach(h => console.log(`  [${h.isBackup?"backup":"LIVE"}] ${h.size}B  ${h.f}`));

console.log(`\n=> 如果 inventory 给每个解码出的 artifact 注入一条「来源文件」physicalRef,`);
console.log(`   则 ${TARGET_CANDIDATE} 产物会累积约 ${hitFiles.length} 条 physicalRef (其中 ${backupHit} 条 type=backup)。`);
