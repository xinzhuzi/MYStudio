import { callFeatureMultimodalAPI } from "@/lib/ai/feature-router";
import { prepareReferenceImageForTransfer } from "@/lib/ai/image-transfer";
import { toPreviewSrc } from "@/lib/media/preview-src";

/**
 * 反推提示词(09-01-extraction-split-reverse):图 → 可直接用于生图的提示词。
 * 通道=callFeatureMultimodalAPI(视觉多模态,style-extractor 同款先例);
 * 传输前缩略(参考图铁律);系统提示词从零写(AGPL 零抄写)。
 */

export const REVERSE_PROMPT_SYSTEM = `你是一名 AI 生图提示词工程师。根据用户给出的参考图片,反推出一段可直接用于生图模型的完整提示词。

要求:
1. 只输出提示词正文,不要任何解释或前后缀。
2. 覆盖主体、构图、风格、光线、色彩、材质、镜头与氛围。
3. 用一段连续的文字描述,长度 50-150 字。
4. 语言与图片内容匹配(中文题材用中文,通用题材用英文)。`;

/** 反推:图片路径(project-file/local-image/https/data)→ 提示词正文;toDataUrl 可注入(测试) */
export async function reversePromptFromImage(
  imagePath: string,
  opts?: { signal?: AbortSignal; toDataUrl?: (url: string) => Promise<string> },
): Promise<string> {
  // 缩略铁律:发送前统一 768/1MB 约束(data: 直传也先过管线)
  const transferable = await prepareReferenceImageForTransfer(toPreviewSrc(imagePath));
  const dataUrl = transferable.startsWith("data:")
    ? transferable
    : await (opts?.toDataUrl ?? localPathToDataUrl)(transferable);

  const text = await callFeatureMultimodalAPI(
    "image_understanding",
    [
      { role: "system", content: REVERSE_PROMPT_SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: "请反推这张图片的生图提示词。" },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    { temperature: 0.3, signal: opts?.signal },
  );
  const trimmed = text.trim();
  if (!trimmed) throw new Error("模型未返回提示词,请重试");
  return trimmed;
}

/** http(s)/协议图片转 data:(与 style-extractor 的 readImageAsBase64 同路) */
async function localPathToDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(blob);
  });
}
