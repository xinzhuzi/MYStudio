// 作者偏好 AI 起草（08-18 用户需求：作者偏好弹窗也支持 AI 自动生成）。
// 与概览填充同一条设计纪律：问答收意图（可全跳过）→ 生成 → 进编辑器由用户
// 审改后手动保存——AI 永不直接落盘，2000 上限防线仍在保存侧。
import { AUTHOR_PREFERENCE_MAX_CHARS, AUTHOR_PREFERENCE_TEMPLATE } from "./author-preference";

export interface AuthorPreferenceFillQuestions {
  /** 题材偏好（多选） */
  genres?: string[];
  /** 改编幅度（单选） */
  adaptDegree?: string;
  /** 节奏口味（单选） */
  pacing?: string;
  /** 雷点（自由文本） */
  dealbreakers?: string;
}

export interface AuthorPreferenceFillMessages {
  system: string;
  user: string;
}

export function buildAuthorPreferenceFillMessages(input: {
  questions?: AuthorPreferenceFillQuestions;
  currentText?: string;
}): AuthorPreferenceFillMessages {
  const q = input.questions ?? {};
  const intentLines = [
    q.genres?.length ? `- 题材偏好：${q.genres.join("、")}` : "",
    q.adaptDegree ? `- 改编幅度：${q.adaptDegree}` : "",
    q.pacing ? `- 节奏口味：${q.pacing}` : "",
    q.dealbreakers?.trim() ? `- 明确雷点：${q.dealbreakers.trim()}` : "",
  ].filter(Boolean);
  const existing = input.currentText?.trim() ?? "";
  const isTemplateUntouched =
    !existing || existing.replace(/（[^）]*）/g, "").trim() === AUTHOR_PREFERENCE_TEMPLATE.replace(/（[^）]*）/g, "").trim();
  const user = [
    intentLines.length ? `【作者口味意图】\n${intentLines.join("\n")}` : "",
    existing && !isTemplateUntouched
      ? `【现有偏好草稿（在其基础上优化补全，保留仍然成立的内容）】\n${existing.slice(0, 1200)}`
      : "",
    "请输出一份「作者偏好」markdown 草稿。",
  ]
    .filter(Boolean)
    .join("\n\n");
  return { system: AUTHOR_PREFERENCE_FILL_SYSTEM, user };
}

const AUTHOR_PREFERENCE_FILL_SYSTEM = [
  "你是资深网文改编制片顾问，为作者起草跨项目通用的「作者偏好」口味卡。",
  "只输出 markdown 正文，不要代码块围栏，不要解释文字。",
  "结构严格如下（三个二级标题不可增删改名）：",
  "# 作者偏好",
  "## 改编口味（节奏/爽感/情绪浓度的总体偏好，2-4 条短句）",
  "## 叙事偏好（视角/对白密度/旁白用法等习惯，2-4 条短句）",
  "## 口味雷点（绝不想要的桥段/表达/风格，2-4 条短句）",
  `总长控制在 ${AUTHOR_PREFERENCE_MAX_CHARS - 400} 字以内（硬上限 ${AUTHOR_PREFERENCE_MAX_CHARS}，超限会被拒收）。`,
  "每条要具体可执行（如「单集结尾必留钩子」），不写空话（如「注重质量」）。",
].join("\n");

export type AuthorPreferenceFillResult =
  | { ok: true; markdown: string }
  | { ok: false; error: string };

/** 模型输出 → 可入编辑器的草稿：剥围栏、补 H1、行边界内裁到上限。 */
export function sanitizeAuthorPreferenceDraft(raw: string): AuthorPreferenceFillResult {
  let text = raw.trim();
  // 剥 ``` 围栏（模型偶发习惯）
  const fence = text.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/);
  if (fence) text = fence[1].trim();
  if (!text) return { ok: false, error: "AI 返回为空" };
  if (!/^#\s*作者偏好/m.test(text)) {
    text = `# 作者偏好\n\n${text}`;
  }
  if (text.length > AUTHOR_PREFERENCE_MAX_CHARS) {
    const lines = text.slice(0, AUTHOR_PREFERENCE_MAX_CHARS).split("\n");
    lines.pop(); // 丢掉被截断的残行
    text = `${lines.join("\n").trimEnd()}\n`;
    if (text.length > AUTHOR_PREFERENCE_MAX_CHARS || !text.includes("## ")) {
      return { ok: false, error: `AI 草稿超长（>${AUTHOR_PREFERENCE_MAX_CHARS} 字符），请重试` };
    }
  }
  return { ok: true, markdown: text };
}

/** 编排一次起草：消息构造 → callText（注入以便测试）→ 清洗。 */
export async function runAuthorPreferenceFill(input: {
  questions?: AuthorPreferenceFillQuestions;
  currentText?: string;
  callText: (messages: AuthorPreferenceFillMessages) => Promise<string>;
}): Promise<AuthorPreferenceFillResult> {
  let raw: string;
  try {
    raw = await input.callText(buildAuthorPreferenceFillMessages(input));
  } catch (error) {
    return { ok: false, error: `AI 调用失败：${error instanceof Error ? error.message : String(error)}` };
  }
  return sanitizeAuthorPreferenceDraft(raw);
}
