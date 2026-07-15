export type AIFeature =
  | "script_analysis"
  | "character_generation"
  | "scene_generation"
  | "prop_generation"
  | "video_generation"
  | "image_understanding"
  | "chat"
  | "freedom_image"
  | "freedom_video"
  | "tts";

export type FeatureBindings = Record<AIFeature, string[] | null>;

export const AI_FEATURES: Array<{
  key: AIFeature;
  name: string;
  description: string;
}> = [
  { key: "script_analysis", name: "剧本分析", description: "将故事文本分解为结构化剧本" },
  { key: "character_generation", name: "角色生成", description: "生成角色参考图和变体服装" },
  { key: "scene_generation", name: "场景生成", description: "生成场景环境参考图" },
  { key: "prop_generation", name: "道具生成", description: "生成道具、法宝、物件参考图" },
  { key: "video_generation", name: "视频生成", description: "将图片转换为视频" },
  { key: "image_understanding", name: "图片理解", description: "读取图片并生成文字描述，可使用支持图片输入的文本模型" },
  { key: "chat", name: "通用对话", description: "AI 对话和文本生成" },
  { key: "freedom_image", name: "自由板块-图片", description: "自由板块独立的图片生成配置" },
  { key: "freedom_video", name: "自由板块-视频", description: "自由板块独立的视频生成配置" },
  { key: "tts", name: "TTS 口播", description: "旁白、对白和音频生成模型配置" },
];
