// 只读探针:查 inventory 里 video-chapter-001-scene-5 的 physicalRefs 来源
import { scanProjectInventory } from "../../frontend/electron/artifacts/artifact-inventory-service";

const DATA_ROOT = "/Users/zhengbingjin/Library/Application Support/漫影工作室";
const PROJECT_ID = "49dce4c1-64b1-42de-85c2-9f266698aec0";

const TARGET_ID = "production:video-candidate:video-chapter-001-scene-5";

async function main() {
  console.log("=== 调 scanProjectInventory ===");
  const inv = await scanProjectInventory(DATA_ROOT, PROJECT_ID);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all = (inv as any).artifacts ?? [];
  console.log("inventory 产物总数:", all.length);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
  const target = all.find((a: any) => a.id === TARGET_ID);
  if (!target) {
    console.log("!! inventory 没找到", TARGET_ID);
    // 列出所有 production 类产物
// eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prods = all.filter((a:any)=>a.stage==="production").map((a:any)=>a.id);
    console.log("production 类产物 id:\n", prods.join("\n"));
    return;
  }

  const refs = target.physicalRefs ?? [];
  console.log("\n=== 目标产物:", TARGET_ID, "===");
  console.log("physicalRefs 条数:", refs.length);
  console.log("bytes:", target.bytes);

  // 按 type 分组统计
  const byType: Record<string, number> = {};
  const byPathSample: Record<string, string[]> = {};
  for (const r of refs) {
    byType[r.type] = (byType[r.type] || 0) + 1;
    (byPathSample[r.type] = byPathSample[r.type] || []).push(r.path);
  }
  console.log("\n按 type 分组:");
  for (const [t, n] of Object.entries(byType)) {
    console.log(`  ${t}: ${n} 条`);
  }

  // 列出每条 ref 的 path(看是不是 40 个备份文件)
  console.log("\n所有 physicalRef path:");
  for (const r of refs) {
    console.log(`  [${r.type}] ${r.path}`);
  }
}

main().catch((e) => { console.error("PROBE ERROR:", e); process.exit(1); });
