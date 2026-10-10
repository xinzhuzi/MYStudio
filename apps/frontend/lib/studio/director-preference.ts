/**
 * 导演偏好（director-preference）——工作室常驻 AI 导演的人格记忆层（2026-10-10 用户
 * 裁定由「作者偏好」正名）：Hermes USER.md 血统的 MYStudio 形态，角色归属导演 agent。
 *
 * 职责对齐 AI 导演 agent 的经典分工（FilmAgent 2501.12909：导演管创意方向/剧本审改/
 * 叙事调度/镜头裁决）：本卡承载导演跨项目的决策口味，随导演 agent 注入剧本、导演
 * 规划、分镜等导演侧动作；原著圣经管「这本书的事实」（项目级），本卡管「我怎么导」
 * （跨项目，跟着导演走不跟着书走）。
 * 文件格式即 markdown 记忆卡（2026-10-10 用户裁定：Hermes 原子条目纪律 + md 载体）：
 * H1 锚下四个 H2 分类（## 改编原则 / ## 叙事手法 / ## 视听语言 / ## 创作红线），
 * 每类一组 `- ` 列表项,一条一行一个可执行决策——追加式生长,概念零重复,
 * 不写成段落散文；题材/书名/世界观专有名词不入卡（那是圣经与项目层的事）。
 * 纪律与 readResidentBible 同源：硬上限超限拒收不截断、动作级现读、空则零注入。
 * 存储走 file-storage 应用级键（随数据导出/迁移走，不进项目目录，复制项目不随行——
 * 它是导演的不是书的）；旧键 author-preference.md 作一次性迁移回退读，保存恒写新键。
 */
import { getFileStorageBridge } from "@/lib/bridge/file-storage";

export const DIRECTOR_PREFERENCE_MAX_CHARS = 2000;

/** file-storage 应用级存储键（主进程解析到存储根，非 _p/ 项目虚拟键）。 */
export const DIRECTOR_PREFERENCE_STORAGE_KEY = "director-preference.md";

/** 旧键（作者偏好时代）：仅读取回退用，保存一律写新键。 */
export const DIRECTOR_PREFERENCE_LEGACY_STORAGE_KEY = "author-preference.md";

/** 分类闭集：条目前缀只允许这四种（Hermes 式「分类: 内容」；术语用影视/编剧行业标准词，AI 语料密度最高）。 */
export const DIRECTOR_PREFERENCE_CATEGORIES = ["改编原则", "叙事手法", "视听语言", "创作红线"] as const;

/** 编辑器初始模板：markdown 记忆卡（H2 分类 + `- ` 原子条目），格式即引导。 */
export const DIRECTOR_PREFERENCE_TEMPLATE = `# 导演偏好

## 改编原则
- （保真度、铺垫与回收、钩子策略，如「支线可合并，人物动机与结局不可改写」）

## 叙事手法
- （视点、对白功能、旁白边界，如「主角限知 POV，反派视角仅用于制造信息差」）

## 视听语言
- （镜头调度、画面节奏，如「长镜头优先，镜内调度承载变化」）

## 创作红线
- （绝不接受的桥段/表达，如「禁止机械降神、禁止 AI 腔」）
`;

/** 注入用包装头：与圣经优先级头同级，标注全局生效语义。 */
const DIRECTOR_PREFERENCE_PRIORITY_HEADER = "# 导演偏好（导演决策原则·全项目生效·与正文冲突时事实以正文为准）";

/** 渲染进程现读应用级偏好文件；桥不可用/异常 → ""（零注入零阻断）。
 * 新键为空时回退读旧键（author-preference.md，作者偏好时代的一次性迁移）。 */
export async function readDirectorPreference(input?: {
  getItem?: (key: string) => Promise<string | null>;
}): Promise<string> {
  const getItem = input?.getItem ?? getFileStorageBridge()?.getItem;
  if (!getItem) return "";
  try {
    const raw = await getItem(DIRECTOR_PREFERENCE_STORAGE_KEY);
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    const legacy = await getItem(DIRECTOR_PREFERENCE_LEGACY_STORAGE_KEY);
    return typeof legacy === "string" ? legacy.trim() : "";
  } catch {
    return "";
  }
}

/** 注入用包装：剥模板自身 H1 换固定头；空文本返回空串（空偏好零影响）。 */
export function formatDirectorPreferenceContext(markdown: string): string {
  const text = markdown.trim();
  if (!text) return "";
  const body = text.replace(/^#\s*导演偏好[^\n]*\n/, "").trim();
  return `${DIRECTOR_PREFERENCE_PRIORITY_HEADER}\n\n${body}`;
}
