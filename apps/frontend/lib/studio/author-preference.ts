/**
 * 作者偏好（author-preference）——应用级常驻口味层，Hermes USER.md 血统的 MYStudio 形态。
 *
 * 与原著圣经成对：圣经管「这本书的事实」（项目级），偏好管「我怎么改编」（跨项目）。
 * 纪律与 readResidentBible 同源：硬上限超限拒收不截断、动作级现读、空则零注入。
 * 存储走 file-storage 应用级键（随数据导出/迁移走，不进项目目录，复制项目不随行——它是作者的不是书的）。
 */
import { getFileStorageBridge } from "@/lib/bridge/file-storage";

export const AUTHOR_PREFERENCE_MAX_CHARS = 2000;

/** file-storage 应用级存储键（主进程解析到存储根，非 _p/ 项目虚拟键）。 */
export const AUTHOR_PREFERENCE_STORAGE_KEY = "author-preference.md";

/** 编辑器初始模板：三段口味维度，格式即引导。 */
export const AUTHOR_PREFERENCE_TEMPLATE = `# 作者偏好

## 改编口味
（节奏、爽感、情绪浓度的总体偏好，如「快节奏强爽感，单集必须有一个钩子」）

## 叙事偏好
（视角、对白密度、旁白用法等习惯，如「多用对白推进，旁白只做转场」）

## 口味雷点
（绝不想要的桥段/表达/风格，如「不要回忆杀开场、不要卖惨」）
`;

/** 注入用包装头：与圣经优先级头同级，标注全局生效语义。 */
const AUTHOR_PREFERENCE_PRIORITY_HEADER = "# 作者偏好（改编口味·全项目生效·与正文冲突时事实以正文为准）";

/** 渲染进程现读应用级偏好文件；桥不可用/文件缺失/异常 → ""（零注入零阻断）。 */
export async function readAuthorPreference(input?: {
  getItem?: (key: string) => Promise<string | null>;
}): Promise<string> {
  const getItem = input?.getItem ?? getFileStorageBridge()?.getItem;
  if (!getItem) return "";
  try {
    const raw = await getItem(AUTHOR_PREFERENCE_STORAGE_KEY);
    return typeof raw === "string" ? raw.trim() : "";
  } catch {
    return "";
  }
}

/** 注入用包装：剥模板自身 H1 换固定头；空文本返回空串（空偏好零影响）。 */
export function formatAuthorPreferenceContext(markdown: string): string {
  const text = markdown.trim();
  if (!text) return "";
  const body = text.replace(/^#\s*作者偏好[^\n]*\n/, "").trim();
  return `${AUTHOR_PREFERENCE_PRIORITY_HEADER}\n\n${body}`;
}
