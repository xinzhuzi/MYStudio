import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import type { ImageWorkflowOpenContext, StoryboardItem } from "@/types/studio";

/**
 * 分镜关联资产 → 参考图解析(P2 自动挂载)。
 *
 * 数据链:storyboard.associateAssetsNames(分镜表「引用资产名称」列)→
 * studio-assets 桥 batchMatch(场景/角色两发)→ previewUrl(file:// 受管路径,
 * 与资产库展示同源)。场景在前(旧链 @图1 场景惯例)、角色在后(激活 prefix
 * 身份一致性锁);限场景 1 + 角色 3。
 *
 * ⚠️ 持久化纪律(2026-08-23 OOM 实证):节点只存 file:// 轻量 URL,严禁把
 * base64 dataURL 写进图/store——每图 MB 级,几十工作流曾把渲染进程堆到 2.4GB
 * OOM。生图传输在 use-image-workflow-generation 按需经 readImageDataUrl IPC
 * 转 dataURL(与 project-file 参考同口径,不落盘)。
 * 桥缺失/无命中/无图 → 空数组(fail-empty,建流不挂参考)。
 */
export async function resolveStoryboardAssetReferences(
  storyboard: Pick<StoryboardItem, "associateAssetsNames">
    & Partial<Pick<StoryboardItem, "videoDesc" | "prompt" | "lines" | "id">> | undefined,
): Promise<ImageWorkflowOpenContext["assetReferences"]> {
  const names = storyboard?.associateAssetsNames ?? [];
  if (!names.length) return [];
  // 画面文本(身份防线 08-24 S08 实证): associateAssetsNames 记的是「镜所在
  // 场景的在场实体」,可能含画面外角色(如 S08 的独孤剑尘)——角色参考必须
  // 只挂画面描述/台词中提及者,否则参考图+身份锚点会把画面外主角画进镜里
  // 或顶替画面角色形象。场景/道具不滤(挂入帮画面画对环境与道具)。
  const frameText = [storyboard?.videoDesc, storyboard?.prompt, storyboard?.lines]
    .filter(Boolean).join("\n");
  // 无画面文本(最小调用/无描述)时不过滤——维持既有行为;有文本才执行画面过滤
  const hasFrameText = frameText.trim().length > 0;
  const bridge = getStudioAssetsBridge();
  if (!bridge?.batchMatch) return [];

  const matches = await Promise.all([
    bridge.batchMatch({ type: "scene", names }),
    bridge.batchMatch({ type: "role", names }),
  ].map((call) => call.catch(() => [] as Array<{ name: string; asset: unknown }>)));

  const references: NonNullable<ImageWorkflowOpenContext["assetReferences"]> = [];
  const seen = new Set<string>();
  const mentionedInFrame = (title: string, queryName: string): boolean => {
    if (frameText.includes(title) || frameText.includes(queryName)) return true;
    // 简称兜底: 资产名「监工赵四」↔画面「赵四」(去职业前缀/取尾名比对)
    const short = title.replace(/^(?:监工|管事|老|年轻|小)/, "");
    return short.length >= 2 && frameText.includes(short);
  };
  const collect = (
    entries: Array<{ name: string; asset: unknown }> | undefined,
    assetType: "scene" | "character",
    limit: number,
  ) => {
    if (!Array.isArray(entries)) return;
    let added = 0;
    for (const entry of entries) {
      if (added >= limit) break;
      const asset = entry.asset as {
        id?: string; name?: string; previewUrl?: string; thumbnailUrl?: string;
      } | null;
      const imageUrl = asset?.previewUrl ?? asset?.thumbnailUrl ?? "";
      const title = asset?.name || entry.name;
      if (!imageUrl || /^(?:data|blob):/i.test(imageUrl) || seen.has(title)) continue;
      if (assetType === "character" && hasFrameText && !mentionedInFrame(title, entry.name)) continue;
      seen.add(title);
      references.push({ imageUrl, title, assetType, assetId: asset?.id });
      added += 1;
    }
  };
  // 先场景后角色:collect 顺序即 continuityOrder 顺序
  collect(matches[0], "scene", 1);
  collect(matches[1], "character", 3);
  return references;
}
