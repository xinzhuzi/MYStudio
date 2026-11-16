/**
 * 道劫分镜主体句画风词剥离(1115 第一章实弹 A 裁:工笔门禁×L5×分镜样板文)。
 *
 * 背景:L5 给分镜域注入 base_type='分镜剧情图' 后,引擎侧 6:4011
 * MyQi21PromptAssembly 走「道劫美术类型」路触发 1017 运行时门禁的主体句全查
 * (_gongbi_gate.py:145-147),而分镜帧模板样板文含「工笔线描照亮脸和手」类
 * 画风词(类型化之前的遗留文本)→ 19/19 三梯全灭。A 裁=编译期在送往引擎的
 * 主体句上剥画风词;风格语义由底座承担(美术风格底座 209 字+类型句 635 字,
 * 实跑装配文 849 字已含)。
 *
 * 词表纪律:唯一真源=引擎门禁 `_STYLE_WORDS`
 * (apps/backend/comfyui/my_nodes/nodes/_gongbi_gate.py:38),禁手搓扩充;
 * 同步钉测试(daojie-style-word-strip.test.ts)逐字对拍 python 源,漂移即红。
 *
 * 边界:只剥「送往引擎的主体句」——分镜表真源(分片/分镜表 md)与
 * referenceSheet(@图N 绑定句)零触碰;空剥(无命中)原样返回不记日志。
 */
import { createOperationId, logEvent } from "@/lib/diagnostics/logger";

/** 门禁同源画风词表(真源=_gongbi_gate.py:38 _STYLE_WORDS;同步钉在案)。 */
export const DAOJIE_SUBJECT_STYLE_WORDS: readonly string[] = [
  "工笔",
  "白描",
  "连环画",
  "厚涂",
  "赛璐璐",
  "photorealistic",
  // 1116 C1 三发修:引擎 1017 门另有独立「写实」检查(_gongbi_gate.py:139,
  // 不在 _STYLE_WORDS)——App 剥词表须与门禁全量同步,漏词=剥不净→任务级拒。
  "写实",
];

export interface DaojieSubjectStripResult {
  /** 剥离后的主体句(无命中=与入参同引用)。 */
  text: string;
  /** 剥离词命中计数(词→次数;空=未剥)。 */
  stripped: Record<string, number>;
}

/** 纯函数:按门禁词表剥主体句画风词(全部出现次数;无命中原样返回)。 */
export function stripDaojieSubjectStyleWords(subject: string): DaojieSubjectStripResult {
  const stripped: Record<string, number> = {};
  let text = subject;
  for (const word of DAOJIE_SUBJECT_STYLE_WORDS) {
    if (!word || !text.includes(word)) continue;
    const parts = text.split(word);
    stripped[word] = parts.length - 1;
    text = parts.join("");
  }
  return { text, stripped };
}

/**
 * 传输位包装:剥离+留痕(剥了哪些词/前后字数,供装配抽验对账)。
 * 仅在有命中时记一条 info;零命中零日志零改动(非分镜/已净文本零噪声)。
 */
export function stripDaojieSubjectStyleWordsForTransport(subject: string): string {
  const { text, stripped } = stripDaojieSubjectStyleWords(subject);
  if (!Object.keys(stripped).length) return subject;
  void logEvent({
    level: "info",
    category: "ai",
    operationId: createOperationId("daojie-subject-style-strip"),
    message: "Daojie storyboard subject style words stripped (gate-aligned)",
    context: {
      strippedWords: stripped,
      beforeChars: subject.length,
      afterChars: text.length,
    },
  });
  return text;
}
