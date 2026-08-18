/**
 * 存储层 JSON 落盘格式归一：对象/数组重排为 indent 2 多行 + 换行结尾，
 * 供用户直接用文本编辑器阅读。所有读路径均 JSON.parse，磁盘格式无关。
 */

/** 已解析对象 → 统一 pretty 文本（indent 2 + 换行结尾）。 */
export function prettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** 任意落盘值 → JSON 对象/数组归一为 pretty，其余（Markdown、标量、损坏 JSON）原样返回。 */
export function normalizeStoredJson(value: string): string {
  const first = value.trimStart()[0];
  if (first !== "{" && first !== "[") return value;
  try {
    return prettyJson(JSON.parse(value));
  } catch {
    return value;
  }
}
