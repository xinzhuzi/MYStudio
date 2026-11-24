/**
 * B5 内容模板数据模型(design.md §B5)。
 * PromotionTemplate 绑定到具体产品+平台,支持变量插值。
 * 变量列表:{{product.name}} {{product.description}} {{product.link}}
 *           {{date}} {{platform}}
 */
import type { SelfMediaPlatform } from "./self-media";

export interface PromotionTemplate {
  id: string;
  productId: string;
  name: string;
  platform: SelfMediaPlatform;
  titleTemplate: string;
  bodyTemplate: string;
  defaultTags: string[];
  mediaSlots: number;
  createdAt: number;
  updatedAt: number;
}

/** 模板引擎支持的变量上下文。 */
export interface TemplateContext {
  product: {
    name: string;
    description: string;
    link: string;
  };
  date: string;
  platform: string;
}

/** 模板渲染结果,含风控检查产物。 */
export interface TemplateRenderResult {
  title: string;
  body: string;
  tags: string[];
  /** 正文中命中的禁用词(来自 brandProfile.forbiddenWords) */
  forbiddenHits: string[];
  /** 平台字数裁剪后的正文(若超长则截断+省略号) */
  trimmedBody: string;
  /** 是否发生了字数截断 */
  wasTruncated: boolean;
}
