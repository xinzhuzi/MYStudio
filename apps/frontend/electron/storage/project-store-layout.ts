import fs from "node:fs";
import path from "node:path";

/**
 * 项目 store 布局 v1：应用状态文件收进项目根 `store/` 目录。
 *
 * 背景（Trellis 08-18-project-store-layout）：项目根目录曾平铺 10+ 个 store
 * json，与用户内容（novel/ exports/ backups/）混居；工作流 store 又因超限
 * 拆成 `studio-workflow/` 目录——同是应用状态两种形态。
 *
 * 迁移规则（幂等，marker 守卫）：
 * - `_p/{pid}/<store>` 虚拟键解析时自动 ensure：把白名单内的旧位置文件/目录
 *   rename 进 `store/`，写 marker `_store-layout-v1.json` 后不再重跑。
 * - `store/` 目录存在 = 已迁移（CLI/直接路径消费者的判定规则，与 marker 等价：
 *   迁移必建目录）。未迁移项目的 CLI 写入仍落旧位置，应用下次打开时一并迁走。
 * - `.bak-*` 手术备份与 marker 之外的任何文件不动。
 */

/** 参与收口的 store 键段（`_p/{pid}/` 之后的第一段）。其余 _p 内容（如
 *  source-memory、_migrated）与项目文件不走 store/ 前缀。 */
export const MOVABLE_STORE_SEGMENTS: readonly string[] = [
  "script",
  "director",
  "editing",
  "timeline",
  "self-media",
  "tts",
  "sclass",
  "media",
  "characters",
  "scenes",
  "props",
  "studio-workflow",
  "studio-workflow-store",
];

const MOVABLE_STORE_SEGMENT_SET = new Set(MOVABLE_STORE_SEGMENTS);

export const STORE_LAYOUT_DIR = "store";
const LAYOUT_MARKER_FILE = "_store-layout-v1.json";

export function isMovableStoreSegment(segment: string): boolean {
  return MOVABLE_STORE_SEGMENT_SET.has(segment);
}

/** 幂等迁移：把旧布局的 store 文件/目录收进 `<root>/store/`。
 *  返回 true = store 布局已生效（marker 在场或本次迁移完成）；
 *  false = 项目根不存在/迁移失败，调用方应按旧布局解析。
 *  项目根不存在时静默跳过（读取不存在的项目不应产生目录副作用）。 */
export function ensureProjectStoreLayout(projectRoot: string): boolean {
  if (!fs.existsSync(projectRoot)) return false;
  const storeDir = path.join(projectRoot, STORE_LAYOUT_DIR);
  const marker = path.join(storeDir, LAYOUT_MARKER_FILE);
  if (fs.existsSync(marker)) return true;
  fs.mkdirSync(storeDir, { recursive: true });
  for (const segment of MOVABLE_STORE_SEGMENTS) {
    // 白名单段是虚拟键段；磁盘上平铺 store 是 <segment>.json 文件，
    // studio-workflow 是目录（studio-workflow-store 段对应旧单文件）。
    const fileName = segment === "studio-workflow" ? segment : `${segment}.json`;
    const source = path.join(projectRoot, fileName);
    if (!fs.existsSync(source)) continue;
    const target = path.join(storeDir, fileName);
    if (fs.existsSync(target)) {
      // 理论不可达（marker 未写过则 store/ 应为空）；万一冲突保新弃旧，旧件留证
      fs.renameSync(source, `${source}.bak-layout-conflict-${Date.now()}`);
      continue;
    }
    fs.renameSync(source, target);
  }
  fs.writeFileSync(marker, JSON.stringify({ migratedAt: new Date().toISOString(), version: 1 }), "utf-8");
  return true;
}

/** 直接路径消费者的布局判定：已迁移 → `<root>/store`；否则 `<root>`。 */
export function storeLayoutBase(projectRoot: string): string {
  return fs.existsSync(path.join(projectRoot, STORE_LAYOUT_DIR)) ? path.join(projectRoot, STORE_LAYOUT_DIR) : projectRoot;
}

/** 布局感知的 store 文件路径（读旧写旧/读新写新，不触发迁移）。 */
export function resolveStoreFilePath(projectRoot: string, storeFileName: string): string {
  const inStore = path.join(projectRoot, STORE_LAYOUT_DIR, storeFileName);
  if (fs.existsSync(inStore)) return inStore;
  return path.join(projectRoot, storeFileName);
}
