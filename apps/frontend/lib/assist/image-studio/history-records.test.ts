// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

import { describe, expect, it } from "vitest";
import {
  generationSourceLabel,
  mergeGenerationRecords,
  readGenerationParams,
} from "./history-records";
import type { HistoryEntry } from "@/stores/assist/freedom-store";

function entry(overrides: Partial<HistoryEntry> & { id: string }): HistoryEntry {
  return {
    type: "image",
    prompt: "",
    model: "",
    resultUrl: "",
    params: {},
    createdAt: 0,
    ...overrides,
  } as HistoryEntry;
}

describe("history-records(09-03 弹窗数据层)", () => {
  it("readGenerationParams 宽容解析:非法键忽略,数组过滤非字符串", () => {
    expect(readGenerationParams(undefined)).toEqual({});
    expect(
      readGenerationParams({
        source: "image-studio-canvas",
        references: ["ok.png", 42, ""],
        negativePrompt: "模糊",
        aspectRatio: "1:1",
        resolution: null,
        count: 2,
        batchUrls: "不是数组",
      }),
    ).toEqual({
      source: "image-studio-canvas",
      references: ["ok.png"],
      negativePrompt: "模糊",
      aspectRatio: "1:1",
      resolution: undefined,
      count: 2,
      batchUrls: undefined,
    });
  });

  it("mergeGenerationRecords:video 不进图片记录,ledger 顶层增丰键进 params,新旧按时间倒序", () => {
    const local: HistoryEntry[] = [
      entry({
        id: "a",
        prompt: "晨雾山门",
        model: "krea2-turbo",
        resultUrl: "project-file://p/media/ai-image/2026-09/a.png",
        createdAt: 200,
        mediaId: "m1",
        params: {
          source: "image-studio-canvas",
          references: ["project-file://p/media/ai-image/2026-09/ref.png"],
          negativePrompt: "模糊",
          aspectRatio: "1:1",
          count: 2,
          batchUrls: ["b1.png", "b2.png"],
        },
      }),
      entry({ id: "v", type: "video", prompt: "视频", createdAt: 300 }),
      entry({ id: "b", prompt: "旧记录", model: "gpt-image-2", resultUrl: "u.png", createdAt: 100 }),
    ];
    const records = mergeGenerationRecords(local, [
      {
        ts: 150,
        prompt: "磁盘旧账",
        model: "krea2-turbo",
        file: "2026-09/old.png",
        negativePrompt: "水印",
        aspectRatio: "16:9",
        references: ["r.png"],
        source: "image-studio-canvas",
      },
      // 与 local a 同一张图(URL 编码态):按图片身份去重,毫秒 ts 对不齐也不出重复行
      {
        ts: 250,
        prompt: "晨雾山门",
        model: "krea2-turbo",
        file: "2026-09/a.png",
      },
    ]);
    expect(records.map((record) => record.id)).toEqual(["a", "disk_150_2026-09/old.png", "b"]);
    const diskOld = records[1];
    expect(diskOld.origin).toBe("ledger");
    expect(diskOld.params).toMatchObject({
      references: ["r.png"],
      negativePrompt: "水印",
      aspectRatio: "16:9",
      source: "image-studio-canvas",
    });
    expect(records[0].params.batchUrls).toEqual(["b1.png", "b2.png"]);
  });

  it("generationSourceLabel:已知来源大白话,未知原样,缺失为破折号", () => {
    expect(generationSourceLabel("image-studio-canvas")).toBe("图片工作室画布");
    expect(generationSourceLabel("mystery")).toBe("mystery");
    expect(generationSourceLabel(undefined)).toBe("—");
  });
});
