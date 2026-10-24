export type StudioAssetKind = "role" | "scene" | "tool" | "clip" | "audio";

export type StudioAssetSource = "toonflow-runtime" | "manying-local";

/**
 * 角色资产图片型谱(10-24 图片展示规范批2,PRD §④+grill Round 1 裁定2 节序:
 * 身份链根→常规产物→重版式→工具型→兜底)。scene/tool 无型谱(单节「图片」)。
 */
export type AssetImageKind =
  | "全身定妆"
  | "人物海报"
  | "人物多视图"
  | "高清人脸"
  | "表情差分"
  | "设定卡"
  | "美宣"
  | "人脸基准"
  | "自由"
  | "早期未分类";

export interface AssetImage {
  name: string;
  filePath: string;
  /** 运行时生成的绝对 URL */
  url?: string;
  /** 图片类型(视图模型层):持久值住 images[] JSON 条目内(db schema 不加列,
   *  PRD Round 2 A 裁定),读路经 classifyAssetImage 三层解析(持久值→命名→早期未分类)。 */
  kind?: AssetImageKind;
}

export interface StudioAssetSummary {
  id: string;
  source: StudioAssetSource;
  type: StudioAssetKind;
  name: string;
  description?: string;
  setting?: string;
  remark?: string;
  prompt?: string;
  thumbnailUrl?: string;
  previewUrl?: string;
  filePath?: string;
  sourcePath?: string;
  state?: string;
  imageWorkflowId?: string;
  parentAssetId?: string;
  parentAssetName?: string;
  toonflowAssetId?: number;
  toonflowParentAssetId?: number;
  /** 提示词润色状态（由前端资产管理注入） */
  promptState?: "none" | "polishing" | "ready" | "failed";
  childrenCount?: number;
  tags?: string[];
  images?: AssetImage[];
}

export interface StudioAssetListRequest {
  type: StudioAssetKind;
  search?: string;
  offset?: number;
  limit?: number;
  refresh?: boolean;
  category?: string;
}

export interface StudioAssetListResponse {
  success: boolean;
  items: StudioAssetSummary[];
  total: number;
  roots?: {
    toonflowDataRoot?: string;
    toonflowOssRoot?: string;
  };
  error?: string;
}
