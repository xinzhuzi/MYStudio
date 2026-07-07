export type StudioAssetKind = "role" | "scene" | "tool" | "clip" | "audio";

export type StudioAssetSource = "toonflow-runtime" | "manying-local";

export interface AssetImage {
  name: string;
  filePath: string;
  /** 运行时生成的绝对 URL */
  url?: string;
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
