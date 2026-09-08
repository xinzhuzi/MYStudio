// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

"use client";

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  useImageStudioStore,
} from "@/stores/assist/image-studio-store";
import type {
  ComfyWorkflowDeleteScan,
  ComfyWorkflowImportConflictMode,
  ComfyWorkflowImportFile,
  ComfyWorkflowImportFileResult,
  ComfyWorkflowLibraryClient,
} from "@/lib/assist/image-studio/comfy-workflow-library";

/**
 * ComfyUI 工作流浏览器编排 hook(09-08 二期):驱动 typed client 与
 * image-studio-store 浏览器态 slice。数据通道可注入 mock(后端未就绪期
 * UI 独立开发);「导入成节点卡」不经此 hook——由浏览器组件的
 * onSelectWorkflow 回调留给集成者(descriptor→注册表→建卡)。
 */
export function useComfyWorkflowBrowser(client: ComfyWorkflowLibraryClient) {
  const tree = useImageStudioStore((state) => state.comfyBrowserTree);
  const loading = useImageStudioStore((state) => state.comfyBrowserLoading);
  const error = useImageStudioStore((state) => state.comfyBrowserError);
  const availableClassTypesRef = useRef<string[] | null>(null);

  const refresh = useCallback(async () => {
    const store = useImageStudioStore.getState();
    store.setComfyBrowserLoading(true);
    try {
      const next = await client.refresh();
      useImageStudioStore.getState().setComfyBrowserLibrary(next, null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "工作流库读取失败";
      useImageStudioStore.getState().setComfyBrowserLibrary(null, message);
    } finally {
      useImageStudioStore.getState().setComfyBrowserLoading(false);
    }
  }, [client]);

  // 打开即拉取(浏览器挂载时;不轮询,照行级探测纪律)
  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** object_info 摘要(导入预览的缺插件口径);进程内缓存一次 */
  const getAvailableClassTypes = useCallback(async (): Promise<string[]> => {
    if (availableClassTypesRef.current) return availableClassTypesRef.current;
    try {
      const list = await client.listAvailableClassTypes();
      availableClassTypesRef.current = list;
      return list;
    } catch {
      return [];
    }
  }, [client]);

  const renameWorkflow = useCallback(
    async (id: string, name: string) => {
      const result = await client.renameWorkflow(id, name);
      if (!result.ok) {
        toast.error(result.error ?? "重命名失败");
        return;
      }
      await refresh();
    },
    [client, refresh],
  );

  const moveWorkflow = useCallback(
    async (id: string, folderId: string | null) => {
      const result = await client.moveWorkflow(id, folderId);
      if (!result.ok) {
        toast.error(result.error ?? "移动失败");
        return;
      }
      await refresh();
    },
    [client, refresh],
  );

  /** 删除第一步:引用扫描(grill Q11——先拿引用清单弹警告,不执行删除) */
  const scanDelete = useCallback(
    async (id: string): Promise<ComfyWorkflowDeleteScan | null> => {
      try {
        return await client.scanDeleteReferences(id);
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : "引用扫描失败");
        return null;
      }
    },
    [client],
  );

  /** 删除第二步:二次确认后执行(后端做快照备份) */
  const confirmDelete = useCallback(
    async (id: string) => {
      const result = await client.deleteWorkflow(id);
      if (!result.ok) {
        toast.error(result.error ?? "删除失败");
        return;
      }
      const store = useImageStudioStore.getState();
      if (store.comfyBrowserSelectedId === id) store.selectComfyWorkflow(null);
      await refresh();
    },
    [client, refresh],
  );

  /** 外部导入(grill Q8:预览/冲突处理在导入弹窗内完成,此处只执行) */
  const importFiles = useCallback(
    async (
      files: ComfyWorkflowImportFile[],
      mode: ComfyWorkflowImportConflictMode,
    ): Promise<ComfyWorkflowImportFileResult[]> => {
      try {
        const results = await client.importFiles(files, mode);
        await refresh();
        return results;
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : "导入失败");
        return [];
      }
    },
    [client, refresh],
  );

  const createFolder = useCallback(
    async (name: string, parentId: string | null) => {
      try {
        await client.createFolder(name, parentId);
        await refresh();
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : "新建文件夹失败");
      }
    },
    [client, refresh],
  );

  const renameFolder = useCallback(
    async (id: string, name: string) => {
      const result = await client.renameFolder(id, name);
      if (!result.ok) {
        toast.error(result.error ?? "文件夹重命名失败");
        return;
      }
      await refresh();
    },
    [client, refresh],
  );

  const deleteFolder = useCallback(
    async (id: string) => {
      const result = await client.deleteFolder(id);
      if (!result.ok) {
        toast.error(result.error ?? "文件夹删除失败");
        return;
      }
      const store = useImageStudioStore.getState();
      if (store.comfyBrowserFolderId === id) store.selectComfyBrowserFolder(null);
      await refresh();
    },
    [client, refresh],
  );

  return {
    tree,
    loading,
    error,
    refresh,
    getAvailableClassTypes,
    renameWorkflow,
    moveWorkflow,
    scanDelete,
    confirmDelete,
    importFiles,
    createFolder,
    renameFolder,
    deleteFolder,
  };
}
