/**
 * 基础信息区/图片区折叠态记忆(1124 超线文件拆分:自 StudioAssetDetailView 原样搬出;
 * localStorage 键与读写逻辑零改动)。
 */
import { useEffect, useState } from "react";
import { GALLERY_COLLAPSED_STORAGE_KEY, META_COLLAPSED_STORAGE_KEY, readGalleryCollapsed, readMetaCollapsed } from "./studio-asset-detail-helpers";

export function useDetailCollapsedFlags() {
  // 10-24 布局重造批1:基础信息区折叠态(默认展开;localStorage 记忆)
  const [metaCollapsed, setMetaCollapsed] = useState(readMetaCollapsed);
  // 1120 详情独立页(§5.3 三令2):生图区整区折叠态(默认展开;localStorage 记忆)
  const [galleryCollapsed, setGalleryCollapsed] = useState(readGalleryCollapsed);

  useEffect(() => {
    try {
      window.localStorage?.setItem(META_COLLAPSED_STORAGE_KEY, metaCollapsed ? "1" : "0");
    } catch {
      // localStorage 不可用(隐私模式等):折叠态仅会话内生效,不阻断
    }
  }, [metaCollapsed]);

  useEffect(() => {
    try {
      window.localStorage?.setItem(GALLERY_COLLAPSED_STORAGE_KEY, galleryCollapsed ? "1" : "0");
    } catch {
      // localStorage 不可用(隐私模式等):折叠态仅会话内生效,不阻断
    }
  }, [galleryCollapsed]);

  return { metaCollapsed, setMetaCollapsed, galleryCollapsed, setGalleryCollapsed };
}
