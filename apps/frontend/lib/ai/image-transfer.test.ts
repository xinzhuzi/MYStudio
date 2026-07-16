import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';

import {
  IMAGE_TRANSFER_MAX_BYTES,
  assertImageTransferPayloadSize,
  imageTransferPayloadBytes,
  prepareReferenceImageForTransfer,
  prepareReferenceImagesForTransfer,
  type ReferenceImageRasterLoader,
} from './image-transfer';

function dataUrlForBytes(byteCount: number): string {
  return `data:image/jpeg;base64,${Buffer.alloc(byteCount, 7).toString('base64')}`;
}

describe('image transfer gate', () => {
  it('uses actual decoded bytes and enforces a strict one-million-byte boundary', () => {
    expect(assertImageTransferPayloadSize(dataUrlForBytes(999_999))).toBe(999_999);
    expect(() => assertImageTransferPayloadSize(dataUrlForBytes(1_000_000)))
      .toThrow(`严格小于 ${IMAGE_TRANSFER_MAX_BYTES} bytes`);
  });

  it('rejects malformed image data before trying to load a raster', async () => {
    const loader: ReferenceImageRasterLoader = vi.fn(async () => {
      throw new Error('loader should not be called');
    });

    await expect(prepareReferenceImageForTransfer('data:image/png;base64,%%%', loader))
      .rejects.toThrow('data URI 格式无效');
    expect(loader).not.toHaveBeenCalled();
  });

  it('degrades quality until the rendered thumbnail is transfer safe', async () => {
    const renderJpeg = vi.fn((maxEdge: number, quality: number) => ({
      dataUrl: dataUrlForBytes(quality > 0.7 ? 1_000_000 : 900_000),
      width: maxEdge,
      height: Math.round(maxEdge * 0.75),
    }));
    const loader: ReferenceImageRasterLoader = vi.fn(async () => ({
      width: 1600,
      height: 1200,
      renderJpeg,
    }));

    const result = await prepareReferenceImageForTransfer(
      dataUrlForBytes(16),
      loader,
    );

    expect(imageTransferPayloadBytes(result)).toBe(900_000);
    expect(renderJpeg.mock.calls.map((call) => call[1])).toEqual([0.86, 0.78, 0.7]);
    expect(renderJpeg.mock.calls.every((call) => call[0] === 768)).toBe(true);
  });

  it('processes local references sequentially and preserves remote HTTP images', async () => {
    const events: string[] = [];
    const loader: ReferenceImageRasterLoader = async (source) => {
      events.push(`start:${source}`);
      await Promise.resolve();
      events.push(`end:${source}`);
      return {
        width: 1000,
        height: 500,
        renderJpeg: () => ({
          dataUrl: dataUrlForBytes(32),
          width: 768,
          height: 384,
        }),
      };
    };

    const result = await prepareReferenceImagesForTransfer([
      'project-file://demo/one.png',
      'file:///tmp/two.png',
      'https://cdn.example.com/three.png',
    ], loader);

    expect(events).toEqual([
      'start:project-file://demo/one.png',
      'end:project-file://demo/one.png',
      'start:file:///tmp/two.png',
      'end:file:///tmp/two.png',
    ]);
    expect(result?.[2]).toBe('https://cdn.example.com/three.png');
  });
});
