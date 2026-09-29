/**
 * P3 编译产物禁指代词机检(docs/comfyui-kb/跨镜连续性规范-0928.md §三清单 + §七 P3)。
 *
 * 纯函数:文本 → 违规项;零 React、零副作用、不读文件、不访问 store、不自动改写。
 * 本模块**不知道层别**:规范 §三的双层规则(计划文件/分镜表内部缩写合法、编译产物必须
 * 展开为完整正向描述)由调用方负责——同一段文本无论视作编译产物还是计划层备注输入,
 * 命中结果完全一致。供后续拍板接线时一行调用。
 *
 * 已知限制(纯子串匹配,本轮不加白名单机制):
 * - 中文偶合子串会误报,如「一同上岸」含「同上」、「继承上文脉」含「接上文」;
 *   误报的豁免口径(白名单/上下文判别)留待未来拍板,本轮只检测不改写。
 * - 重叠命中合并报最长词:「上一镜头」不重复报「上一镜」;「仍保持原样」只报「保持原样」。
 */

/** 规范 §三禁指代词清单(18 词,顺序抄自 docs/comfyui-kb/跨镜连续性规范-0928.md:89)。 */
export const PROMPT_ANAPHORA_TERMS = Object.freeze([
  "上一镜",
  "上一镜头",
  "前一镜",
  "刚才",
  "此前",
  "如前",
  "接上文",
  "见前文",
  "同上",
  "照旧",
  "依旧",
  "仍保持",
  "保持原样",
  "继续",
  "接着",
  "和前面一样",
  "与前镜一致",
  "沿袭上镜",
] as const);

export interface PromptAnaphoraViolation {
  /** 命中的禁指代词(重叠合并后取最长词)。 */
  term: string;
  /** 命中在输入文本中的起始索引(UTF-16 code unit,与 String#indexOf 同口径)。 */
  index: number;
  /** 命中前后各约 8 字的摘录,供人工核对上下文。 */
  excerpt: string;
}

const EXCERPT_CONTEXT = 8;

interface RawHit {
  term: string;
  start: number;
  end: number;
}

/** 找出文本中全部禁指代词命中;区间交叠的命中合并为最长词,结果按出现位置升序。 */
export function findPromptAnaphora(text: string): PromptAnaphoraViolation[] {
  const hits: RawHit[] = [];
  for (const term of PROMPT_ANAPHORA_TERMS) {
    let from = 0;
    for (;;) {
      const idx = text.indexOf(term, from);
      if (idx < 0) break;
      hits.push({ term, start: idx, end: idx + term.length });
      from = idx + term.length;
    }
  }

  // 重叠合并:按起点升序(同起点长词在前)线性扫簇;区间相连成簇的命中只报簇内最长词,
  // 同长保留先出现者。簇代表取最长词自身的区间,保证 index/excerpt 与 term 对位。
  hits.sort((a, b) => a.start - b.start || b.term.length - a.term.length);
  const merged: RawHit[] = [];
  let clusterBest: RawHit | null = null;
  let clusterEnd = -1;
  for (const hit of hits) {
    if (clusterBest && hit.start < clusterEnd) {
      if (hit.term.length > clusterBest.term.length) clusterBest = hit;
      clusterEnd = Math.max(clusterEnd, hit.end);
      continue;
    }
    if (clusterBest) merged.push(clusterBest);
    clusterBest = hit;
    clusterEnd = hit.end;
  }
  if (clusterBest) merged.push(clusterBest);

  return merged.map((hit) => ({
    term: hit.term,
    index: hit.start,
    excerpt: text.slice(
      Math.max(0, hit.start - EXCERPT_CONTEXT),
      Math.min(text.length, hit.end + EXCERPT_CONTEXT),
    ),
  }));
}
