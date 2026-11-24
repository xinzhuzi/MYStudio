/**
 * B2 产品目录数据模型(design.md §B2)。
 * 产品是独立于项目的顶层实体,productIds 弱关联 0-N。
 * brandProfile 为 B5 模板系统预留(D11),初期可空。
 */

export type ProductCtaType =
  | "access"
  | "read"
  | "download"
  | "learn_more"
  | "community";

export interface ProductLink {
  label: string;
  url: string;
  platform: string;
}

export interface ProductBrandProfile {
  primaryColor: string;
  tone: string[];
  forbiddenWords: string[];
}

export interface ProductPromotion {
  defaultTags: string[];
  utm: {
    campaign: string;
  };
  ctaType: ProductCtaType;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string;
  detail: string;
  coverImage: string;
  links: ProductLink[];
  tags: string[];
  projectIds: string[];
  brandProfile: ProductBrandProfile;
  promotion: ProductPromotion;
  createdAt: number;
  updatedAt: number;
}

/** products.json 导出格式(design.md §Phase A 数据源)——与落地页共享数据契约。 */
export interface ProductExportRecord {
  slug: string;
  name: string;
  description: string;
  detail: string;
  coverImage: string;
  links: ProductLink[];
  tags: string[];
  promotion: ProductPromotion;
}
