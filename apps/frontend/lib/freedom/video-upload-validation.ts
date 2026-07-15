import { resolveVeoUploadCapability } from './veo-capability';

export type FreedomVideoUploadRole = 'single' | 'first' | 'last' | 'reference';

export interface FreedomVideoUploadFile {
  role: FreedomVideoUploadRole;
  dataUrl: string;
  fileName?: string;
  mimeType?: string;
}

export interface GroupedVideoUploadFiles {
  single?: FreedomVideoUploadFile;
  first?: FreedomVideoUploadFile;
  last?: FreedomVideoUploadFile;
  references: FreedomVideoUploadFile[];
}

export function groupVideoUploadFiles(
  uploadFiles?: FreedomVideoUploadFile[],
): GroupedVideoUploadFiles {
  const grouped: GroupedVideoUploadFiles = { references: [] };

  for (const file of uploadFiles || []) {
    if (file.role === 'single' && !grouped.single) grouped.single = file;
    if (file.role === 'first' && !grouped.first) grouped.first = file;
    if (file.role === 'last' && !grouped.last) grouped.last = file;
    if (file.role === 'reference') grouped.references.push(file);
  }

  return grouped;
}

function countVideoUploadFiles(grouped: GroupedVideoUploadFiles): number {
  return (
    (grouped.single ? 1 : 0) +
    (grouped.first ? 1 : 0) +
    (grouped.last ? 1 : 0) +
    grouped.references.length
  );
}

export function validateVeoVideoUploads(
  model: string,
  endpointTypes: string[] | undefined,
  uploadFiles?: FreedomVideoUploadFile[],
): GroupedVideoUploadFiles {
  const capability = resolveVeoUploadCapability(model, endpointTypes);
  const grouped = groupVideoUploadFiles(uploadFiles);
  const total = countVideoUploadFiles(grouped);

  if (!capability.isVeo) return grouped;

  for (const role of ['single', 'first', 'last'] as const) {
    const roleCount = (uploadFiles || []).filter((file) => file.role === role).length;
    if (roleCount > 1) {
      throw new Error(`模型 ${model} 的 ${role} 上传位置仅支持 1 个文件`);
    }
  }

  if (capability.mode === 'none') {
    if (total > 0) throw new Error(`模型 ${model} 不支持上传文件输入`);
    return grouped;
  }

  if (capability.mode === 'single') {
    const file = grouped.single || grouped.first;
    if (capability.minFiles > 0 && !file) {
      throw new Error(`模型 ${model} 需要上传 1 张图片`);
    }
    if (grouped.references.length > 0 || !!grouped.last || (!!grouped.single && !!grouped.first)) {
      throw new Error(`模型 ${model} 仅支持 1 张图片输入`);
    }
    return grouped;
  }

  if (capability.mode === 'first_last') {
    if (grouped.references.length > 0 || !!grouped.single) {
      throw new Error(`模型 ${model} 仅支持首帧/尾帧输入`);
    }
    if (capability.minFiles > 0 && !grouped.first) {
      throw new Error(`模型 ${model} 需要上传首帧图片`);
    }
    if (!grouped.first && grouped.last) {
      throw new Error(`模型 ${model} 仅上传尾帧无效，请先上传首帧`);
    }
    if (total > capability.maxFiles) {
      throw new Error(`模型 ${model} 最多支持 2 张图片（首帧/尾帧）`);
    }
    return grouped;
  }

  if (capability.mode === 'multi') {
    if (!!grouped.single || !!grouped.first || !!grouped.last) {
      throw new Error(`模型 ${model} 仅支持多参考图输入`);
    }
    if (grouped.references.length < capability.minFiles) {
      throw new Error(`模型 ${model} 至少需要上传 1 张参考图`);
    }
    if (grouped.references.length > capability.maxFiles) {
      throw new Error(`模型 ${model} 最多支持 ${capability.maxFiles} 张参考图`);
    }
    return grouped;
  }

  return grouped;
}
