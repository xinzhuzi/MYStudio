// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  appendProjectLedger,
  deleteProjectImageFile,
  generationSourceLabel,
  ledgerFilenameOf,
  ledgerMonthFolderOf,
  mediaAiImageLedgerIdentity,
  mergeGenerationRecords,
  readGenerationParams,
  removeLedgerEntryByFile,
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
    const records = mergeGenerationRecords(
      local,
      [
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
      ],
      null,
    );
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
    expect(generationSourceLabel("image-studio-uncloth")).toBe("图片工作室画布·无衣物");
    expect(generationSourceLabel("mystery")).toBe("mystery");
    expect(generationSourceLabel(undefined)).toBe("—");
  });

  it("appendProjectLedger(09-04 挂账根修):追加进已有/新建;读取走 raw 通道;坏 JSON 不清账", async () => {
    const existing = JSON.stringify([
      { ts: 1, prompt: "旧账", model: "m", file: "2026-09/old.png" },
    ]);
    const reads: Array<{ projectId: string; relativePath: string; raw?: boolean }> = [];
    const writes: Array<{ key: string; value: string }> = [];
    const windowMock = window as unknown as {
      projectFiles?: {
        readText: (payload: { projectId: string; relativePath: string; raw?: boolean }) => Promise<string>;
        writeText: (key: string, value: string) => Promise<void>;
      };
    };
    let mode: "ok" | "missing" | "broken" = "ok";
    windowMock.projectFiles = {
      readText: vi.fn(async (payload) => {
        reads.push(payload);
        if (mode === "ok") return existing;
        if (mode === "missing") return "";
        return "{ 坏 JSON";
      }),
      writeText: vi.fn(async (key, value) => {
        writes.push({ key, value });
      }),
    };
    try {
      // 追加进已有台账:读取必须带 raw(2MB 预览通道读不到大台账)
      await appendProjectLedger({
        projectId: "p1",
        relativePath: "media/ai-image/2026-09/ledger.json",
        entry: { ts: 2, prompt: "新账", model: "krea2-uncloth", file: "2026-09/new.png" },
      });
      expect(reads[0]).toMatchObject({ projectId: "p1", raw: true });
      expect(writes).toHaveLength(1);
      expect(writes[0].key).toBe("_p/p1/media/ai-image/2026-09/ledger.json");
      expect(JSON.parse(writes[0].value)).toEqual([
        { ts: 1, prompt: "旧账", model: "m", file: "2026-09/old.png" },
        { ts: 2, prompt: "新账", model: "krea2-uncloth", file: "2026-09/new.png" },
      ]);
      // 文件不存在(首条):空数组起建
      mode = "missing";
      await appendProjectLedger({
        projectId: "p1",
        relativePath: "media/ai-image/2026-09/ledger.json",
        entry: { ts: 3, prompt: "首条", model: "m", file: "2026-09/first.png" },
      });
      expect(JSON.parse(writes[1].value)).toEqual([
        { ts: 3, prompt: "首条", model: "m", file: "2026-09/first.png" },
      ]);
      // 坏 JSON:不重建不清账(重建空数组覆盖写=清光历史,旧行为的根雷)
      const writesBefore = writes.length;
      mode = "broken";
      await appendProjectLedger({
        projectId: "p1",
        relativePath: "media/ai-image/2026-09/ledger.json",
        entry: { ts: 4, prompt: "坏文件时这条进不去", model: "m", file: "2026-09/x.png" },
      });
      expect(writes).toHaveLength(writesBefore);
    } finally {
      delete windowMock.projectFiles;
    }
  });

  it("ledgerMonthFolderOf/ledgerFilenameOf:受管 URL 尾段口径(编码形态)", () => {
    const url =
      "project-file://p1/media/ai-image/2026-09/" + encodeURIComponent("studio_真实摄影.png");
    expect(ledgerMonthFolderOf(url)).toBe("2026-09");
    expect(ledgerFilenameOf(url)).toBe(encodeURIComponent("studio_真实摄影.png"));
    expect(ledgerFilenameOf("project-file://p1/media/ai-image/a.png?x=1")).toBe("a.png");
  });

  it("ledger 地址归一化(09-03 修复):有项目=project-file:// 完整 URL,同图与 local 去重不破", () => {
    const records = mergeGenerationRecords(
      [
        entry({
          id: "a",
          prompt: "晨雾山门",
          resultUrl: "project-file://p1/media/ai-image/2026-09/a.png",
          createdAt: 200,
        }),
      ],
      [
        { ts: 250, prompt: "晨雾山门", model: "krea2-turbo", file: "2026-09/a.png" },
        { ts: 100, prompt: "磁盘孤本", model: "krea2-turbo", file: "2026-09/孤 本.png" },
      ],
      "p1",
    );
    // 同图去重:ledger a 行被 local 吸收,只剩 local + 磁盘孤本
    expect(records.map((record) => record.id)).toEqual(["a", "disk_100_2026-09/孤 本.png"]);
    // 归一化:完整受管地址(渲染层唯一拼装点同构,含中文段编码)
    expect(records[1].resultUrl).toBe(
      "project-file://p1/media/ai-image/2026-09/" + encodeURIComponent("孤 本.png"),
    );
  });

  it("编码形态 ledger file(09-04 线上实锤形态):URL 不二次编码,与 local 编码地址同图去重", () => {
    // 写入侧 appendProjectLedger 存的是受管 URL 尾段(编码形态,中文文件名必编码)
    const encodedName = encodeURIComponent("studio_真实摄影_薄汗_1788451280291.png");
    const records = mergeGenerationRecords(
      [
        entry({
          id: "local-a",
          prompt: "真实摄影",
          resultUrl: `project-file://p1/media/ai-image/2026-09/${encodedName}`,
          createdAt: 200,
        }),
        entry({
          id: "local-b",
          prompt: "另一张",
          resultUrl: "project-file://p1/media/ai-image/2026-09/plain.png",
          createdAt: 150,
        }),
      ],
      [
        // 与 local-a 同一张图:file 编码形态
        { ts: 250, prompt: "真实摄影", model: "krea2-turbo", file: `2026-09/${encodedName}` },
        // 磁盘孤本:编码形态,无 local 对应
        { ts: 100, prompt: "磁盘孤本", model: "krea2-turbo", file: `2026-09/${encodeURIComponent("孤本图.png")}` },
      ],
      "p1",
    );
    // 同图去重生效:编码 ledger 行被 local 吸收,孤本行保留
    expect(records.map((record) => record.id)).toEqual([
      "local-a",
      "local-b",
      `disk_100_2026-09/${encodeURIComponent("孤本图.png")}`,
    ]);
    // 关键断言:孤本行 URL 与写入侧 createProjectFileUrl 逐字节一致——
    // 双重编码会产出 %25E5 形态(缩略图/大图全链 404)
    expect(records[2].resultUrl).toBe(
      `project-file://p1/media/ai-image/2026-09/${encodeURIComponent("孤本图.png")}`,
    );
    expect(records[2].resultUrl).not.toContain("%25");
  });

  it("mediaAiImageLedgerIdentity:project-file 媒体图→「月/文件名」;其他 scheme/越界路径→null", () => {
    expect(mediaAiImageLedgerIdentity("project-file://p1/media/ai-image/2026-09/a.png")).toBe(
      "2026-09/a.png",
    );
    expect(mediaAiImageLedgerIdentity("project-file://p1/media/ai-image/2026-09/孤%20本.png")).toBe(
      "2026-09/孤 本.png",
    );
    expect(mediaAiImageLedgerIdentity("project-file://p1/media/ai-image/2026-09/ledger.json")).toBeNull();
    expect(mediaAiImageLedgerIdentity("project-file://p1/store/x.json")).toBeNull();
    expect(mediaAiImageLedgerIdentity("local-image://ai-image/a.png")).toBeNull();
    expect(mediaAiImageLedgerIdentity("data:image/png;base64,xx")).toBeNull();
  });

  it("removeLedgerEntryByFile:读改写删条目;条目不在/非法身份不写盘,返回是否确有移除", async () => {
    const ledgerJson = JSON.stringify([
      { ts: 1, prompt: "留", model: "m", file: "2026-09/keep.png" },
      { ts: 2, prompt: "删", model: "m", file: "2026-09/gone.png" },
    ]);
    const writes: Array<{ key: string; value: string }> = [];
    const windowMock = window as unknown as {
      projectFiles?: {
        readText: (payload: { projectId: string; relativePath: string }) => Promise<string>;
        writeText: (key: string, value: string) => Promise<void>;
      };
    };
    windowMock.projectFiles = {
      readText: vi.fn(async (payload) =>
        payload.relativePath === "media/ai-image/2026-09/ledger.json" ? ledgerJson : "",
      ),
      writeText: vi.fn(async (key, value) => {
        writes.push({ key, value });
      }),
    };
    try {
      await expect(
        removeLedgerEntryByFile({ projectId: "p1", file: "2026-09/gone.png" }),
      ).resolves.toBe(true);
      expect(writes).toHaveLength(1);
      expect(writes[0].key).toBe("_p/p1/media/ai-image/2026-09/ledger.json");
      expect(JSON.parse(writes[0].value)).toEqual([
        { ts: 1, prompt: "留", model: "m", file: "2026-09/keep.png" },
      ]);
      // 条目不在:不写盘
      await expect(
        removeLedgerEntryByFile({ projectId: "p1", file: "2026-09/none.png" }),
      ).resolves.toBe(false);
      expect(writes).toHaveLength(1);
      // 非法身份(月份段不是 YYYY-MM):不动
      await expect(
        removeLedgerEntryByFile({ projectId: "p1", file: "hax/../gone.png" }),
      ).resolves.toBe(false);
      expect(writes).toHaveLength(1);
    } finally {
      delete windowMock.projectFiles;
    }
  });

  it("removeLedgerEntryByFile 编码口径(09-04 线上实锤):条目存编码形态,解码身份也删得掉", async () => {
    // appendProjectLedger 写入的 file=受管 URL 尾段(中文必编码)——
    // 单口径(编码 vs 解码)比对曾致台账条目永远删不掉、面板行点删不消失
    const encodedName = encodeURIComponent("studio_真实摄影_薄汗_1788451280291.png");
    const ledgerJson = JSON.stringify([
      { ts: 1, prompt: "留", model: "m", file: "2026-09/keep.png" },
      { ts: 2, prompt: "删", model: "m", file: `2026-09/${encodedName}` },
    ]);
    const writes: Array<{ key: string; value: string }> = [];
    const windowMock = window as unknown as {
      projectFiles?: {
        readText: (payload: { projectId: string; relativePath: string }) => Promise<string>;
        writeText: (key: string, value: string) => Promise<void>;
      };
    };
    windowMock.projectFiles = {
      readText: vi.fn(async () => ledgerJson),
      writeText: vi.fn(async (key, value) => {
        writes.push({ key, value });
      }),
    };
    try {
      // input.file=解码身份(mediaAiImageLedgerIdentity 产物)
      await expect(
        removeLedgerEntryByFile({ projectId: "p1", file: "2026-09/studio_真实摄影_薄汗_1788451280291.png" }),
      ).resolves.toBe(true);
      expect(writes).toHaveLength(1);
      expect(JSON.parse(writes[0].value)).toEqual([
        { ts: 1, prompt: "留", model: "m", file: "2026-09/keep.png" },
      ]);
    } finally {
      delete windowMock.projectFiles;
    }
  });

  it("removeLedgerEntryByFile 坏 JSON(09-04):如实抛错(面板报「台账更新失败」),不写盘", async () => {
    const writes: Array<{ key: string; value: string }> = [];
    const windowMock = window as unknown as {
      projectFiles?: {
        readText: (payload: { projectId: string; relativePath: string }) => Promise<string>;
        writeText: (key: string, value: string) => Promise<void>;
      };
    };
    windowMock.projectFiles = {
      readText: vi.fn(async () => "{ 不是 JSON"),
      writeText: vi.fn(async (key, value) => {
        writes.push({ key, value });
      }),
    };
    try {
      await expect(
        removeLedgerEntryByFile({ projectId: "p1", file: "2026-09/a.png" }),
      ).rejects.toThrow();
      expect(writes).toHaveLength(0);
    } finally {
      delete windowMock.projectFiles;
    }
  });

  it("deleteProjectImageFile:仅本项目 project-file 地址走桥删除;跨项目/远程/无桥→false", async () => {
    const deletes: Array<{ projectId: string; relativePath: string }> = [];
    const windowMock = window as unknown as {
      projectFiles?: {
        deleteFile: (payload: { projectId: string; relativePath: string }) => Promise<{ success: boolean }>;
      };
    };
    windowMock.projectFiles = {
      deleteFile: vi.fn(async (payload) => {
        deletes.push(payload);
        return { success: true };
      }),
    };
    try {
      await expect(
        deleteProjectImageFile("p1", "project-file://p1/media/ai-image/2026-09/a.png"),
      ).resolves.toBe(true);
      expect(deletes).toEqual([{ projectId: "p1", relativePath: "media/ai-image/2026-09/a.png" }]);
      await expect(
        deleteProjectImageFile("p1", "project-file://p2/media/ai-image/2026-09/a.png"),
      ).resolves.toBe(false);
      await expect(deleteProjectImageFile("p1", "https://cdn.example.com/a.png")).resolves.toBe(false);
      expect(deletes).toHaveLength(1);
    } finally {
      delete windowMock.projectFiles;
    }
  });
});
