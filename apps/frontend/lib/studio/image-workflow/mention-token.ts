/**
 * @引用令牌(09-02-at-mention-refs):
 * 文内形如 @[标题](ref:节点id) 的纯文本令牌;发送侧在请求构造处解析为
 * 按连线序编号的引用文案(「图1/文本2」),断连降级纯文本。
 * 存显分离:节点存原文,解析只在出边界发生。
 */

export interface MentionRefNode {
  id: string;
  type: string;
  title: string;
}

export interface MentionCandidate extends MentionRefNode {
  /** 图片类引用的真缩略地址(调用方过 withThumbVariant) */
  thumbUrl?: string;
  summary?: string;
}

export function buildMentionToken(node: MentionRefNode): string {
  // 标题 ] 替换全角(简单语法不转义,勿引入正则复杂度)
  return `@[${node.title.replace(/\]/g, "］")}](ref:${node.id})`;
}

const TOKEN_PATTERN = /@\[([^\]]*)\]\(ref:([^)]+)\)/g;

/** 解析结果:替换后的提示词 + 未命中(断连)的令牌数 */
export function resolveMentionTokens(
  prompt: string,
  lookup: (nodeId: string) => MentionRefNode | undefined,
): { text: string; missing: number } {
  let missing = 0;
  let imageIndex = 0;
  let textIndex = 0;
  const text = prompt.replace(TOKEN_PATTERN, (_match, _title: string, nodeId: string) => {
    const node = lookup(nodeId);
    if (!node) {
      missing += 1;
      return _match; // 断连:保留原文降级
    }
    if (node.type === "reference" || node.type === "generated") {
      imageIndex += 1;
      return `图${imageIndex}`;
    }
    textIndex += 1;
    return `文本${textIndex}`;
  });
  return { text, missing };
}

/** 光标前是否处于 @ 触发态(输入 @ 或 @词 过滤中) */
export function mentionTriggerState(
  value: string,
  caret: number,
): { active: boolean; query: string } {
  const before = value.slice(0, caret);
  const match = /(?:^|[^@\w])@([\w\u4e00-\u9fa5]*)$/.exec(before);
  if (!match) return { active: false, query: "" };
  return { active: true, query: match[1] };
}

/** 候选过滤(标题/摘要模糊包含) */
export function filterMentionCandidates(
  candidates: readonly MentionCandidate[],
  query: string,
): MentionCandidate[] {
  if (!query) return [...candidates];
  const lower = query.toLowerCase();
  return candidates.filter(
    (candidate) =>
      candidate.title.toLowerCase().includes(lower) ||
      (candidate.summary ?? "").toLowerCase().includes(lower),
  );
}
