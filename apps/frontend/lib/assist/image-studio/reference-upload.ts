// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { saveImageToLocal, type ImageCategory } from "@/lib/media/image-storage";

/** 上传参考图落位分类(与媒体库上传件同目录口径) */
const UPLOAD_CATEGORY = "upload" as ImageCategory;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsDataURL(file);
  });
}

/**
 * 把用户选中的参考图文件落为受管地址(local-image://upload/…)。
 * 返回地址用于参考图节点 imageUrl:受管 scheme 可持久化、可转 base64 传输、
 * 可直接进超分链。非 Electron 环境降级返回 data:(仅当次会话可用,store
 * 持久化净化层会剥离)。
 */
export async function saveReferenceFile(file: File): Promise<string> {
  const dataUrl = await readFileAsDataUrl(file);
  const extension = /\.([a-z0-9]{2,8})$/i.exec(file.name)?.[1]?.toLowerCase() ?? "png";
  const filename = `studio_ref_${Date.now()}.${extension}`;
  const saved = await saveImageToLocal(dataUrl, UPLOAD_CATEGORY, filename);
  return saved;
}
