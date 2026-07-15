import { ATMOSPHERE_PRESETS, TIME_PRESETS, type Scene } from "@/stores/scene-store";
import { getStyleById } from "@/lib/constants/visual-styles";

const PROP_MAPPINGS: Record<string, string> = {
  "饭桌": "dining table",
  "餐桌": "dining table",
  "碗筷": "bowls and chopsticks",
  "菜肴": "dishes of food",
  "吃饭": "dining table with food",
  "沙发": "sofa",
  "茶几": "coffee table",
  "电视": "television",
  "电视柜": "TV cabinet",
  "书桌": "desk",
  "书柜": "bookshelf",
  "床": "bed",
  "衣柜": "wardrobe",
  "窗户": "window",
  "窗": "window",
  "门": "door",
  "毕业证": "graduation certificate",
  "证书": "certificate",
  "照片": "photo frame",
  "全家福": "family photo",
  "手机": "smartphone",
  "电脑": "computer",
  "文件": "documents",
  "信": "letter",
  "栀子花": "gardenia flowers",
  "花": "flowers",
  "盆栽": "potted plant",
  "绿植": "green plants",
  "酒": "wine/alcohol",
  "酒杯": "wine glasses",
  "咖啡": "coffee",
  "茶": "tea",
  "阳台": "balcony",
  "窗外": "view outside window",
  "灯": "lamp",
  "台灯": "table lamp",
  "吹风機": "electric fan",
  "空调": "air conditioner",
};

export function extractPropsFromActions(actions: string): string[] {
  const props: string[] = [];
  for (const [keyword, english] of Object.entries(PROP_MAPPINGS)) {
    if (actions.includes(keyword) && !props.includes(english)) {
      props.push(english);
    }
  }
  return props.slice(0, 8);
}

export function buildScenePrompt(
  scene: Partial<Scene> & { styleId?: string },
  actionDescriptions?: string[],
): string {
  const stylePreset = scene.styleId ? getStyleById(scene.styleId) : null;
  const styleTokens = stylePreset?.prompt || "professional quality";
  const timePrompt = TIME_PRESETS.find((preset) => preset.id === scene.time)?.prompt || "daytime";
  const atmospherePrompt = ATMOSPHERE_PRESETS.find((preset) => preset.id === scene.atmosphere)?.prompt || "";
  const extractedProps = actionDescriptions?.length
    ? extractPropsFromActions(actionDescriptions.join(" "))
    : [];
  if (extractedProps.length > 0) {
    console.log("[buildScenePrompt] 提取的道具:", extractedProps);
  }
  const propsPrompt = extractedProps.length > 0 ? `, with ${extractedProps.join(", ")}` : "";

  return `${scene.location}${propsPrompt}, ${timePrompt}, ${atmospherePrompt}, ${styleTokens}, detailed background, environment concept art, establishing shot, cinematic composition, no characters`;
}

export type ContactSheetLayout = "2x2" | "3x3";

export function buildContactSheetCopyText({
  isEnglish,
  prompt,
  styleId,
  aspectRatio,
  layout,
}: {
  isEnglish: boolean;
  prompt: string;
  styleId: string;
  aspectRatio: "16:9" | "9:16";
  layout: ContactSheetLayout;
}) {
  const stylePreset = getStyleById(styleId);
  const styleName = stylePreset?.name || styleId;
  const styleTokens = stylePreset?.prompt || "";
  const layoutDescription = `${layout} (${layout === "2x2" ? "4格" : "9格"})`;
  const layoutDescriptionEn = `${layout === "2x2" ? "2 rows x 2 cols" : "3 rows x 3 cols"} (${layout})`;
  return isEnglish
    ? [
        "=== Contact Sheet Settings ===\n",
        `Style: ${styleName}`,
        `Style Tokens: ${styleTokens}`,
        `Aspect Ratio: ${aspectRatio}`,
        `Grid Layout: ${layoutDescriptionEn}`,
        "",
        "=== Prompt ===\n",
        prompt,
      ].join("\n")
    : [
        "=== 联合图设置 ===\n",
        `视觉风格: ${styleName}`,
        `风格关键词: ${styleTokens}`,
        `宽高比: ${aspectRatio}`,
        `网格布局: ${layoutDescription}`,
        "",
        "=== 提示词 ===\n",
        prompt,
      ].join("\n");
}

export function buildDirectUploadLayoutData(
  layout: ContactSheetLayout,
  aspectRatio: "16:9" | "9:16",
) {
  const dimensions = getLayoutDimensions(layout, aspectRatio);
  const viewpoints = Array.from({ length: dimensions.rows * dimensions.cols }, (_, index) => ({
    id: `viewpoint-${index + 1}`,
    name: `视角${index + 1}`,
    nameEn: `Viewpoint ${index + 1}`,
    shotIds: [] as string[],
    keyProps: [] as string[],
    keyPropsEn: [] as string[],
    description: "",
    descriptionEn: "",
    gridIndex: index,
  }));
  return {
    viewpoints,
    pendingViewpoints: viewpoints.map((viewpoint) => ({ ...viewpoint, pageIndex: 0, shotIndexes: [] as number[] })),
    promptPage: {
      pageIndex: 0,
      prompt: "",
      promptZh: "",
      viewpointIds: viewpoints.map((viewpoint) => viewpoint.id),
      gridLayout: { rows: dimensions.rows, cols: dimensions.cols },
    },
  };
}

export type OrthographicViews = {
  front: string | null;
  back: string | null;
  left: string | null;
  right: string | null;
};

type GridSplitResult = {
  row: number;
  col: number;
  dataUrl: string;
};

type GridViewpoint = {
  id: string;
  gridIndex: number;
};

export type AutoContactSheetViewpoint = GridViewpoint & {
  name: string;
  nameEn: string;
  shotIds: string[];
  shotIndexes?: number[];
  keyProps: string[];
  keyPropsEn?: string[];
  pageIndex?: number;
};

export function getLayoutDimensions(
  layout: ContactSheetLayout,
  _aspectRatio?: "16:9" | "9:16",
) {
  return layout === "2x2" ? { rows: 2, cols: 2 } : { rows: 3, cols: 3 };
}

export function mapGridResultsToViewpoints(
  splitResults: GridSplitResult[],
  viewpoints: GridViewpoint[],
  expectedCols: number,
) {
  const images: Record<string, { imageUrl: string; gridIndex: number }> = {};
  for (const viewpoint of viewpoints) {
    const row = Math.floor(viewpoint.gridIndex / expectedCols);
    const col = viewpoint.gridIndex % expectedCols;
    const splitResult = splitResults.find((item) => item.row === row && item.col === col);
    if (splitResult) {
      images[viewpoint.id] = {
        imageUrl: splitResult.dataUrl,
        gridIndex: viewpoint.gridIndex,
      };
    }
  }
  return images;
}

export function buildAutoContactSheetPrompt({
  prompt,
  styleId,
  aspectRatio,
  layout,
  pageLayout,
}: {
  prompt: string;
  styleId: string;
  aspectRatio: "16:9" | "9:16";
  layout: ContactSheetLayout;
  pageLayout?: { rows: number; cols: number };
}) {
  const stylePreset = getStyleById(styleId);
  const negativePrompt = stylePreset?.category === "real"
    ? "blurry, low quality, watermark, text, labels, titles, captions, words, letters, numbers, annotations, subtitles, typography, font, writing, people, characters, anime, cartoon, distorted grid, uneven panels"
    : "blurry, low quality, watermark, text, labels, titles, captions, words, letters, numbers, annotations, subtitles, typography, font, writing, people, characters, distorted grid, uneven panels";
  if (!/[\u4e00-\u9fa5]/.test(prompt) || prompt.includes("<instruction>")) {
    return prompt.includes("Negative constraints:") ? prompt : `${prompt}\nNegative constraints: ${negativePrompt}`;
  }
  const dimensions = pageLayout || getLayoutDimensions(layout, aspectRatio);
  const panelAspect = aspectRatio === "16:9"
    ? "16:9 (horizontal landscape)"
    : "9:16 (vertical portrait)";
  return [
    "<instruction>",
    `Generate a clean ${dimensions.rows}x${dimensions.cols} storyboard grid with exactly ${dimensions.rows * dimensions.cols} equal-sized panels.`,
    `Overall Image Aspect Ratio: ${aspectRatio}.`,
    `Each individual panel must have a ${panelAspect} aspect ratio.`,
    stylePreset?.prompt ? `MANDATORY Visual Style for ALL panels: ${stylePreset.prompt}` : "",
    "Structure: No borders between panels, no text, no watermarks, no speech bubbles.",
    "Consistency: Maintain consistent perspective, lighting, color grading, and visual style across ALL panels.",
    "</instruction>",
    "",
    prompt,
    "",
    `Negative constraints: ${negativePrompt}`,
  ].filter(Boolean).join("\n");
}

export function mapAutoContactSheetResults(
  splitResults: GridSplitResult[],
  sourceViewpoints: AutoContactSheetViewpoint[],
  expectedCols: number,
  now = Date.now(),
) {
  let viewpoints = sourceViewpoints;
  if (viewpoints.length === 0 && splitResults.length > 0) {
    viewpoints = splitResults.map((_, index) => ({
      id: `auto-vp-${index}-${now}`,
      name: `视角-${index + 1}`,
      nameEn: `Viewpoint-${index + 1}`,
      shotIds: [],
      shotIndexes: [],
      keyProps: [],
      keyPropsEn: [],
      gridIndex: index,
      pageIndex: 0,
    }));
  }
  let images = mapGridResultsToViewpoints(splitResults, viewpoints, expectedCols);
  if (Object.keys(images).length === 0 && splitResults.length > 0) {
    viewpoints = splitResults.map((_, index) => ({
      id: `fallback-vp-${index}-${now}`,
      name: `视角-${index + 1}`,
      nameEn: `Viewpoint-${index + 1}`,
      shotIds: [],
      shotIndexes: [],
      keyProps: [],
      keyPropsEn: [],
      gridIndex: index,
      pageIndex: 0,
    }));
    images = Object.fromEntries(viewpoints.map((viewpoint, index) => [
      viewpoint.id,
      { imageUrl: splitResults[index].dataUrl, gridIndex: index },
    ]));
  }
  return { viewpoints, images };
}

export function mapOrthographicSplitResults(
  splitResults: GridSplitResult[],
): OrthographicViews {
  const views: OrthographicViews = {
    front: null,
    back: null,
    left: null,
    right: null,
  };
  for (const result of splitResults) {
    if (result.row === 0 && result.col === 0) views.front = result.dataUrl;
    if (result.row === 0 && result.col === 1) views.back = result.dataUrl;
    if (result.row === 1 && result.col === 0) views.left = result.dataUrl;
    if (result.row === 1 && result.col === 1) views.right = result.dataUrl;
  }
  return views;
}

export function extractSpatialAssets(scene: Scene) {
  const locationParts = (scene.location || "").split(/[,，、。；;\n]/).filter(Boolean);
  const visualParts = (scene.visualPrompt || "").split(/[,，、。；;\n]/).filter(Boolean);
  const commonAnchors = ["桌", "椅", "床", "沙发", "柜", "台", "架", "灯", "门", "窗"];
  let anchor = locationParts[0] || scene.name || "the central object";

  for (const part of [...locationParts, ...visualParts]) {
    for (const keyword of commonAnchors) {
      if (part.includes(keyword)) {
        anchor = part.trim();
        break;
      }
    }
  }

  const walls = {
    north: "窗户和自然光",
    south: "入口门",
    west: "装饰墙或书架",
    east: "家具或陈设",
  };
  const wallKeywords = {
    window: ["窗", "window", "阳光", "sunlight"],
    door: ["门", "door", "入口", "entrance"],
    shelf: ["架", "shelf", "柜", "cabinet", "书"],
    decoration: ["画", "装饰", "decoration", "art"],
  };

  for (const part of [...locationParts, ...visualParts]) {
    if (wallKeywords.window.some((keyword) => part.includes(keyword))) {
      walls.north = part.trim();
    } else if (wallKeywords.door.some((keyword) => part.includes(keyword))) {
      walls.south = part.trim();
    } else if (wallKeywords.shelf.some((keyword) => part.includes(keyword))) {
      walls.west = part.trim();
    } else if (wallKeywords.decoration.some((keyword) => part.includes(keyword))) {
      walls.east = part.trim();
    }
  }

  return { anchor, walls };
}

export function buildOrthographicPrompts(scene: Scene, styleId: string) {
  const { anchor, walls } = extractSpatialAssets(scene);
  const sceneName = scene.name || scene.location || "the scene";
  const stylePreset = getStyleById(styleId);
  const styleTokens = stylePreset?.prompt || "anime style";
  const prompt = `A professional orthographic concept sheet arranged in a precise 2x2 grid, depicting ${sceneName} from four cardinal angles with perfect spatial continuity. ${styleTokens}, detailed environment concept art.

**Top-Left (Front View):**
A direct front-facing shot of ${anchor}. We see the front details clearly. The background is the wall behind it, featuring ${walls.south}.

**Top-Right (Back View):**
A direct back-facing shot of ${anchor}. We see the rear structure. The background is the wall the object is facing, featuring ${walls.north}.

**Bottom-Left (Left Profile):**
A side profile shot of ${anchor} from the left. The background is the opposite wall, strictly featuring ${walls.east}.

**Bottom-Right (Right Profile):**
A side profile shot of ${anchor} from the right. The background is the opposite wall, strictly featuring ${walls.west}.

Unified by flat, neutral cinematic lighting to ensure texture visibility. No characters, empty environment.`;
  const promptZh = `专业正交概念图，精确的 2x2 网格排列，展示「${sceneName}」的四个基本视角，保持完美的空间连续性。${stylePreset?.name || "动画风格"}，详细的环境概念艺术。

**左上（正面视图）：**
${anchor} 的正面直视镜头。清晰展示正面细节。背景是其后方的墙壁，包含 ${walls.south}。

**右上（背面视图）：**
${anchor} 的背面直视镜头。展示后部结构。背景是物体面向的墙壁，包含 ${walls.north}。

**左下（左侧视图）：**
从左侧拍摄的 ${anchor} 侧面镜头。背景是对面的墙壁，严格包含 ${walls.east}。

**右下（右侧视图）：**
从右侧拍摄的 ${anchor} 侧面镜头。背景是对面的墙壁，严格包含 ${walls.west}。

使用平坦、中性的电影光照以确保纹理可见。无角色，空场景。`;
  return { prompt, promptZh };
}
