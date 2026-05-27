export type StudioVisualManualCategory = "daojie" | "2d" | "3d" | "real" | "other";

export interface StudioVisualManualModuleDefinition {
  label: string;
  value: string;
  relativePath: string;
}

export interface StudioVisualManualModule extends StudioVisualManualModuleDefinition {
  content: string;
}

export interface StudioVisualManualImage {
  name: string;
  relativePath: string;
  filePath: string;
  url: string;
}

export interface StudioVisualManualSummary {
  id: string;
  stylePath: string;
  name: string;
  description?: string;
  category: StudioVisualManualCategory;
  storagePath: string;
  sourcePath?: string;
  sourceExists: boolean;
  isCustomized: boolean;
  moduleCount: number;
  imageCount: number;
  images: StudioVisualManualImage[];
}

export interface StudioVisualManualDetail extends StudioVisualManualSummary {
  modules: StudioVisualManualModule[];
}

export interface StudioVisualManualWritePayload {
  name: string;
  modules: Array<{
    value: string;
    content: string;
  }>;
  images?: Array<{
    relativePath?: string;
    name?: string;
    dataUrl?: string;
  }>;
}

export interface StudioVisualManualCreatePayload {
  stylePath: string;
  name: string;
  description?: string;
}

export const STUDIO_VISUAL_MANUAL_MODULES: StudioVisualManualModuleDefinition[] = [
  { label: "README", value: "README", relativePath: "README.md" },
  { label: "前缀", value: "prefix", relativePath: "prefix.md" },
  { label: "角色", value: "art_character", relativePath: "art_prompt/art_character.md" },
  { label: "角色衍生", value: "art_character_derivative", relativePath: "art_prompt/art_character_derivative.md" },
  { label: "道具", value: "art_prop", relativePath: "art_prompt/art_prop.md" },
  { label: "道具衍生", value: "art_prop_derivative", relativePath: "art_prompt/art_prop_derivative.md" },
  { label: "场景", value: "art_scene", relativePath: "art_prompt/art_scene.md" },
  { label: "场景衍生", value: "art_scene_derivative", relativePath: "art_prompt/art_scene_derivative.md" },
  { label: "分镜", value: "director_storyboard", relativePath: "driector_skills/director_storyboard.md" },
  { label: "分镜视频", value: "art_storyboard_video", relativePath: "art_prompt/art_storyboard_video.md" },
  { label: "技法-导演规划", value: "director_planning_style", relativePath: "driector_skills/director_planning_style.md" },
  { label: "技法-分镜表设计", value: "director_storyboard_table_style", relativePath: "driector_skills/director_storyboard_table_style.md" },
];
