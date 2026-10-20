// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.



/**
 * Generate a UUID v4
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Parse API keys from a string (comma or newline separated)
 */
// 1013:分隔符收编全角(，、；;)——中文输入法下录入的多 key 串切不开时,
// 整串(含全角字符)进 Bearer 头会在 Headers.set 抛「非 ISO-8859-1」(装机
// 实弹 mikoto 构造期炸/凡人缝合串 403 无权的双重根因)。
// 1021 补刀:分隔类再收编 空格/Tab/全角空格U+3000/零宽U+200B-200D/BOM——
// 「sk-a sk-b」(半角空格)与「sk-a<全角空格>sk-b」式粘贴切不开,整串进 Bearer
// 同样炸 Headers
// (1020 装机实弹 fanren/mikoto/ikun 三渠道 4 行失败的根因);段内零宽不可
// 见字符一并剥离(隐形粘贴污染),可见中文字符保留(注记属用户可见内容,留给
// 401/掩码日志现形,不静默改写)。
const KEY_SEPARATORS = /[,，、\n\r\t;； \u3000]/;
// eslint-disable-next-line no-misleading-character-class -- 零宽字符类本意即逐个精确匹配剥离(\u200c/\u200d 为 ZWJ/ZWNJ 本尊,非误导序列)
const INVISIBLE_CHARS = /[\u200b\u200c\u200d\ufeff]/g;

export function parseApiKeys(apiKey: string): string[] {
  if (!apiKey) return [];
  return apiKey
    // 零宽不可见字符先整串剥离(隐形粘贴污染,任何位置都不该在;不当分隔符——
    // 分隔语义只属于真实分隔类,零宽只做清除)
    .replace(INVISIBLE_CHARS, "")
    .split(KEY_SEPARATORS)
    .map(k => k.trim())
    .filter(k => k.length > 0);
}

/**
 * Get the count of API keys
 */
export function getApiKeyCount(apiKey: string): number {
  return parseApiKeys(apiKey).length;
}

/**
 * Mask an API key for display
 */
export function maskApiKey(key: string): string {
  if (!key || key.length === 0) return '未设置';
  if (key.length <= 10) return `${key.substring(0, 4)}***`;
  return `${key.substring(0, 8)}...${key.substring(key.length - 4)}`;
}

