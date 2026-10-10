// 导演偏好 AI 起草（08-18 用户需求：导演偏好弹窗也支持 AI 自动生成）。
// 与概览填充同一条设计纪律：问答收意图（可全跳过）→ 生成 → 进编辑器由用户
// 审改后手动保存——AI 永不直接落盘，2000 上限防线仍在保存侧。
// 10-10 用户裁定：卡面=markdown 记忆卡（H2 分类 + `- ` 原子条目,Hermes 追加式纪律,
// 专业术语,概念零重复,题材词禁入卡）——题材意图只用于理解口味,不得写进草稿。
import { DIRECTOR_PREFERENCE_MAX_CHARS, DIRECTOR_PREFERENCE_TEMPLATE } from "./director-preference";

export interface DirectorPreferenceFillQuestions {
  /** 题材偏好（多选） */
  genres?: string[];
  /** 改编幅度（单选） */
  adaptDegree?: string;
  /** 节奏口味（单选） */
  pacing?: string;
  /** 雷点（自由文本） */
  dealbreakers?: string;
}

export interface DirectorPreferenceFillMessages {
  system: string;
  user: string;
}

export function buildDirectorPreferenceFillMessages(input: {
  questions?: DirectorPreferenceFillQuestions;
  currentText?: string;
}): DirectorPreferenceFillMessages {
  const q = input.questions ?? {};
  const intentLines = [
    q.genres?.length ? `- 题材偏好：${q.genres.join("、")}` : "",
    q.adaptDegree ? `- 改编幅度：${q.adaptDegree}` : "",
    q.pacing ? `- 节奏口味：${q.pacing}` : "",
    q.dealbreakers?.trim() ? `- 明确雷点：${q.dealbreakers.trim()}` : "",
  ].filter(Boolean);
  const existing = input.currentText?.trim() ?? "";
  const isTemplateUntouched =
    !existing || existing.replace(/（[^）]*）/g, "").trim() === DIRECTOR_PREFERENCE_TEMPLATE.replace(/（[^）]*）/g, "").trim();
  const user = [
    intentLines.length ? `【导演口味意图】\n${intentLines.join("\n")}` : "",
    existing && !isTemplateUntouched
      ? `【现有偏好草稿（在其基础上按原子条目增删修订，保留仍然成立的内容，不重写成段落散文）】\n${existing.slice(0, 1200)}`
      : "",
    "请输出一份「导演偏好」markdown 草稿。",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { system: DIRECTOR_PREFERENCE_FILL_SYSTEM, user };
}

const DIRECTOR_PREFERENCE_FILL_SYSTEM = [
  "你是这家工作室的常驻 AI 导演（管创意方向、剧本审改、叙事调度与镜头裁决），在维护自己的跨项目「导演偏好」记忆卡（Hermes USER.md 式记忆：原子条目、追加生长、跨书复用）。",
  "只输出 markdown 正文，不要代码块围栏，不要解释文字。",
  "格式严格如下（markdown 记忆卡）：",
  "- 首行必须是 `# 导演偏好`；",
  "- 二级标题只允许 `## 改编原则`、`## 叙事手法`、`## 视听语言`、`## 创作红线` 四个，不可改名，无明确倾向的类可整节省略；",
  "- 每类条目用 `- ` 无序列表，一条一行，每类 2-4 条；视听语言写镜头调度与画面节奏的裁决偏好（如「长镜头优先，镜内调度承载变化」）。",
  "写作纪律：用影视/编剧行业标准术语（如 POV、信息差、说明性对白、show don't tell、长镜头、机械降神、OOC），这些词模型理解最准；一个概念只写一条，禁止同义反复；题材、书名或世界观专有名词不得入卡——题材事实归项目圣经；语言风格类条目写「跟随原作」而非具体语体。",
  `总长控制在 ${DIRECTOR_PREFERENCE_MAX_CHARS - 400} 字以内（硬上限 ${DIRECTOR_PREFERENCE_MAX_CHARS}，超限会被拒收）。`,
  "每条要具体可执行（如「单集结尾必留有效钩子」），不写空话（如「注重质量」）。",
].join("\n");

export type DirectorPreferenceFillResult =
  | { ok: true; markdown: string }
  | { ok: false; error: string };

/** 模型输出 → 可入编辑器的草稿：剥围栏、补 H1、行边界内裁到上限。 */
export function sanitizeDirectorPreferenceDraft(raw: string): DirectorPreferenceFillResult {
  let text = raw.trim();
  // 剥 ``` 围栏（模型偶发习惯）
  const fence = text.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/);
  if (fence) text = fence[1].trim();
  if (!text) return { ok: false, error: "AI 返回为空" };
  if (!/^#\s*导演偏好/m.test(text)) {
    text = `# 导演偏好\n\n${text}`;
  }
  if (text.length > DIRECTOR_PREFERENCE_MAX_CHARS) {
    const lines = text.slice(0, DIRECTOR_PREFERENCE_MAX_CHARS).split("\n");
    lines.pop(); // 丢掉被截断的残行
    text = `${lines.join("\n").trimEnd()}\n`;
    // 截断后仍须保有可识别的条目形态（§ 分隔的 Hermes 式条目或旧三段式 H2）
    if (text.length > DIRECTOR_PREFERENCE_MAX_CHARS || (!text.includes("§") && !text.includes("## "))) {
      return { ok: false, error: `AI 草稿超长（>${DIRECTOR_PREFERENCE_MAX_CHARS} 字符），请重试` };
    }
  }
  return { ok: true, markdown: text };
}

/** 编排一次起草：消息构造 → callText（注入以便测试）→ 清洗。 */
export async function runDirectorPreferenceFill(input: {
  questions?: DirectorPreferenceFillQuestions;
  currentText?: string;
  callText: (messages: DirectorPreferenceFillMessages) => Promise<string>;
}): Promise<DirectorPreferenceFillResult> {
  let raw: string;
  try {
    raw = await input.callText(buildDirectorPreferenceFillMessages(input));
  } catch (error) {
    return { ok: false, error: `AI 调用失败：${error instanceof Error ? error.message : String(error)}` };
  }
  return sanitizeDirectorPreferenceDraft(raw);
}
