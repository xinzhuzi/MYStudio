/**
 * A7/A8(1125 补检): 产品关联的自动填充决策(纯函数)。
 *
 * 规则(design.md §B2「选中后自动填充产品描述和链接」的不丢稿口径):
 * - 字段为空、或仍等于上一次自动填入的值时,才随选中产品替换;
 * - 用户改过的字段(不等于上次自动填入值)一律保留,先写后选不丢稿;
 * - 取消关联时,仅清掉仍等于自动填入值的字段;
 * - 处理范围由调用方传入的 current 决定(发布页管描述/话题/落地页,批量页管描述/话题)。
 *
 * 返回的 `applied` 是本次之后「自动填入值」的最新记录,调用方存进 useRef 供下次比对。
 */

export type ProductAutoFillField = "description" | "topics" | "utmBaseUrl";

export type AutoFillState = Partial<Record<ProductAutoFillField, string>>;

/** 选中产品时各字段要填入的候选值;取消关联时传 null */
export interface ProductAutoFillSource {
  description: string;
  /** 预渲染好的话题串(如 "#漫剧 #剧情解说") */
  topics: string;
  /** 产品第一个链接(发布页的落地页地址);批量页没有落地页输入框可不传 */
  utmBaseUrl?: string;
}

function isEmpty(value: string | undefined): boolean {
  return (value ?? "").trim() === "";
}

export function resolveProductAutoFill(params: {
  source: ProductAutoFillSource | null;
  current: AutoFillState;
  /** 上一次自动填入值(首次为空对象) */
  lastApplied: AutoFillState;
}): {
  /** 本次要写入的字段与值;未出现的字段保持原状 */
  values: AutoFillState;
  /** 本次之后生效的自动填入值记录(供下次比对) */
  applied: AutoFillState;
} {
  const { source, current, lastApplied } = params;
  const values: AutoFillState = {};
  const applied: AutoFillState = { ...lastApplied };

  for (const field of Object.keys(current) as ProductAutoFillField[]) {
    // 选中产品:候选值来自产品;取消关联:候选值为空串(清掉仍属于自己的字段)
    const candidate = source ? (source[field] ?? "") : "";
    const current_ = current[field] ?? "";
    const last = lastApplied[field];
    const stillOwnFill = last !== undefined && current_ === last;
    if (isEmpty(current_) || stillOwnFill) {
      values[field] = candidate;
      applied[field] = candidate;
    }
  }

  return { values, applied };
}
