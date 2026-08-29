import { describe, expect, it } from 'vitest';

import {
  groupVideoUploadFiles,
  validateVeoVideoUploads,
  type FreedomVideoUploadFile,
} from './video-upload-validation';

const upload = (role: FreedomVideoUploadFile['role'], suffix: string = role): FreedomVideoUploadFile => ({
  role,
  dataUrl: `data:image/png;base64,${suffix}`,
});

describe('video upload validation', () => {
  it('groups files by role while preserving reference order and first singleton values', () => {
    const firstSingle = upload('single', 'first-single');
    const grouped = groupVideoUploadFiles([
      firstSingle,
      upload('single', 'ignored-single'),
      upload('reference', 'ref-1'),
      upload('reference', 'ref-2'),
    ]);

    expect(grouped.single).toBe(firstSingle);
    expect(grouped.references.map((file) => file.dataUrl)).toEqual([
      'data:image/png;base64,ref-1',
      'data:image/png;base64,ref-2',
    ]);
  });

  it('passes upload roles through for non-Veo models', () => {
    const grouped = validateVeoVideoUploads('sora-2', undefined, [upload('last')]);
    expect(grouped.last?.role).toBe('last');
  });

  it('rejects uploads for Veo models without upload capability', () => {
    expect(() => validateVeoVideoUploads('veo_3_1', ['视频统一格式'], [upload('single')]))
      .toThrow('模型 veo_3_1 不支持上传文件输入');
  });

  it('enforces single-image Veo input', () => {
    expect(() => validateVeoVideoUploads('veo_3_1-frames', undefined)).toThrow(
      '模型 veo_3_1-frames 需要上传 1 张图片',
    );
    expect(validateVeoVideoUploads('veo_3_1-frames', undefined, [upload('first')]).first)
      .toBeDefined();
    expect(() => validateVeoVideoUploads('veo_3_1-frames', undefined, [
      upload('single'),
      upload('first'),
    ])).toThrow('模型 veo_3_1-frames 仅支持 1 张图片输入');
    expect(() => validateVeoVideoUploads('veo_3_1-frames', undefined, [
      upload('first', 'first-1'),
      upload('first', 'first-2'),
    ])).toThrow('模型 veo_3_1-frames 的 first 上传位置仅支持 1 个文件');
  });

  it('enforces first/last Veo input ordering', () => {
    expect(() => validateVeoVideoUploads('veo2-frames', undefined, [upload('last')])).toThrow(
      '模型 veo2-frames 需要上传首帧图片',
    );
    expect(validateVeoVideoUploads('veo2-frames', undefined, [upload('first'), upload('last')]))
      .toMatchObject({ first: { role: 'first' }, last: { role: 'last' } });
    expect(() => validateVeoVideoUploads('veo_3_1-fast-4k', undefined, [upload('reference')]))
      .toThrow('模型 veo_3_1-fast-4k 仅支持首帧/尾帧输入');
  });

  it('enforces multi-reference Veo limits', () => {
    expect(() => validateVeoVideoUploads('veo_3_1-components', undefined, [])).toThrow(
      '模型 veo_3_1-components 至少需要上传 1 张参考图',
    );
    expect(() => validateVeoVideoUploads('veo_3_1-components', undefined, [upload('single')]))
      .toThrow('模型 veo_3_1-components 仅支持多参考图输入');
    expect(() => validateVeoVideoUploads('veo_3_1-components', undefined, [
      upload('reference', '1'),
      upload('reference', '2'),
      upload('reference', '3'),
      upload('reference', '4'),
    ])).toThrow('模型 veo_3_1-components 最多支持 3 张参考图');
  });
});
