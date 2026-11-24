/**
 * 族聚显拉取与展示序(1124 超线文件拆分:自 StudioAssetDetailView 原样搬出):
 * 进页/切资产按资产键自取族图(连点换行序号守卫),展示序=族序+live 新图置顶,
 * 删图/家族过滤后选中位夹回。逻辑零改动。
 */
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { AssetImage, StudioAssetSummary } from "@/types/studio-assets";
import { getStudioAssetsBridge } from "@/lib/bridge/studio-assets";
import {
  fetchFamilyImageEntries,
  mergeFamilyDisplayImages,
  type FamilyDisplayImageEntry,
  type FamilyImageEntry,
} from "@/lib/studio/asset-family-images";

export function useAssetDisplayImages({
  asset,
  images,
  externalFamilyImages,
  removedFamilyPaths,
  setCurrentIndex,
}: {
  asset: StudioAssetSummary | null;
  images: AssetImage[];
  /** 外部直供族图(测试/特殊场景);undefined=由本 hook 按资产键自取。 */
  externalFamilyImages?: FamilyImageEntry[];
  /** 本会话已删族兄弟路径(从展示序滤掉)。 */
  removedFamilyPaths: string[];
  setCurrentIndex: Dispatch<SetStateAction<number>>;
}) {
  // R4 族聚显(1120 独立页役:拉取随 view):进页/切资产按资产键(=两入口
  // batchMatch 同源键:资产类型+资产名)自取族图;undefined=桥缺席/查询失败,
  // 回落本行单图。连点换行时晚到的旧族图丢弃(请求序号守卫,链路排查#7 同款)。
  const [selfFamilyImages, setSelfFamilyImages] = useState<FamilyImageEntry[] | undefined>(undefined);
  const familyReqSeqRef = useRef(0);
  useEffect(() => {
    const seq = ++familyReqSeqRef.current;
    setSelfFamilyImages(undefined);
    if (!asset || (asset.type !== "role" && asset.type !== "scene" && asset.type !== "tool")) {
      return;
    }
    let cancelled = false;
    void fetchFamilyImageEntries(getStudioAssetsBridge(), asset.type, asset.name).then((entries) => {
      if (!cancelled && familyReqSeqRef.current === seq) setSelfFamilyImages(entries);
    });
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset?.id]);
  const familyImages = externalFamilyImages !== undefined ? externalFamilyImages : selfFamilyImages;

  // R4 族聚显展示序:族序(updatedAt 倒序)+ live 新图置顶;本行条目可编辑、
  // 族兄弟只读。familyImages 未提供时恒等 images(资产库面板等调用方零变化)。
  const displayImages = useMemo<FamilyDisplayImageEntry[]>(
    () => mergeFamilyDisplayImages(familyImages, images, asset?.id)
      .filter((entry) => !removedFamilyPaths.includes(entry.filePath)),
    [familyImages, images, asset?.id, removedFamilyPaths],
  );
  // 10-25 派生流水线修:展示序活取探针(队列闭包陈旧图集问题,见 actions ctx 注释)
  const displayImagesRef = useRef<AssetImage[]>(displayImages);
  displayImagesRef.current = displayImages;

  // 10-24 布局重造:展示序缩短时夹回选中位(删图/家族过滤后选中不悬空)
  useEffect(() => {
    setCurrentIndex((cur) =>
      displayImages.length === 0 || cur <= displayImages.length - 1
        ? cur
        : Math.max(displayImages.length - 1, 0),
    );
  }, [displayImages.length, setCurrentIndex]);

  return { familyImages, displayImages, displayImagesRef };
}
