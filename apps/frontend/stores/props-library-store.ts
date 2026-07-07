// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * PropsLibraryStore - 道具库状态管理
 * 支持自定义目录分类，持久化到 localStorage
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createSplitStorage } from '@/lib/project-storage';

// 道具项
export interface PropItem {
  id: string;
  name: string;           // 道具名称（可编辑）
  projectId?: string;
  /** 原始描述（来自实体提取） */
  description: string;
  /** 润色后的视觉提示词 */
  visualPrompt?: string;
  /** 提示词润色状态 */
  promptState?: "none" | "polishing" | "ready" | "failed";
  /** 提示词错误信息 */
  promptError?: string;
  imageUrl: string;       // local-image://props/... 或远程URL
  imageWorkflowId?: string;
  imageWorkflowNodeId?: string;
  /** 参考图（base64，不持久化） */
  referenceImages?: string[];
  /** 是否衍生资产 */
  isDerivative?: boolean;
  /** 父资产 ID */
  parentId?: string;
  /** 分类 */
  category?: string;
  folderId: string | null; // 所属目录，null = 根目录
  createdAt: number;
  updatedAt?: number;
}

// 自定义目录
export interface PropFolder {
  id: string;
  name: string;           // 目录名称
  parentId: string | null; // 预留嵌套扩展（当前UI仅用一级）
  projectId?: string;
  isAutoCreated?: boolean;
  createdAt: number;
}

interface PropsLibraryState {
  items: PropItem[];
  folders: PropFolder[];
  // 当前选中目录（null = 全部）
  selectedFolderId: string | null | 'all';
}

interface PropsLibraryActions {
  // 道具操作
  addProp: (prop: Omit<PropItem, 'id' | 'createdAt'>) => PropItem;
  updateProp: (id: string, updates: Partial<PropItem>) => void;
  renameProp: (id: string, name: string) => void;
  deleteProp: (id: string) => void;
  moveProp: (propId: string, folderId: string | null) => void;

  // 目录操作
  addFolder: (name: string, parentId?: string | null, projectId?: string) => PropFolder;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void; // 删除时子道具移至根目录
  getOrCreateProjectFolder: (projectId: string, projectName: string) => string;

  // UI 状态
  setSelectedFolderId: (folderId: string | null | 'all') => void;

  // 查询
  getPropsByFolder: (folderId: string | null | 'all') => PropItem[];
  getPropById: (id: string) => PropItem | undefined;
  assignProjectToUnscoped: (projectId: string) => void;
  reset: () => void;
}

type PropsLibraryStore = PropsLibraryState & PropsLibraryActions;

type PropLibraryPersistedState = {
  items: PropItem[];
  folders: PropFolder[];
  selectedFolderId: string | null | 'all';
};

const initialState: PropsLibraryState = {
  items: [],
  folders: [],
  selectedFolderId: 'all',
};

export function splitPropLibraryDataForStorage(
  state: PropLibraryPersistedState,
  pid: string,
) {
  return {
    projectData: {
      items: state.items.filter((item) => item.projectId === pid),
      folders: state.folders.filter((folder) => folder.projectId === pid),
      selectedFolderId: state.selectedFolderId,
    },
    sharedData: {
      items: state.items.filter((item) => !item.projectId),
      folders: state.folders.filter((folder) => !folder.projectId),
      selectedFolderId: 'all' as const,
    },
  };
}

export function mergePropLibraryDataForStorage(
  projectData: PropLibraryPersistedState | null,
  sharedData: PropLibraryPersistedState | null,
): PropLibraryPersistedState {
  return {
    items: [
      ...(sharedData?.items ?? []),
      ...(projectData?.items ?? []),
    ],
    folders: [
      ...(sharedData?.folders ?? []),
      ...(projectData?.folders ?? []),
    ],
    selectedFolderId: projectData?.selectedFolderId ?? 'all',
  };
}

export const usePropsLibraryStore = create<PropsLibraryStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      // ── 道具操作 ──────────────────────────────────────────────────────────

      addProp: (prop) => {
        const newProp: PropItem = {
          ...prop,
          id: `prop_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          createdAt: Date.now(),
        };
        set((s) => ({ items: [newProp, ...s.items] }));
        return newProp;
      },

      updateProp: (id, updates) => {
        set((s) => ({
          items: s.items.map((item) =>
            item.id === id
              ? { ...item, ...updates, id: item.id, updatedAt: Date.now() }
              : item
          ),
        }));
      },

      renameProp: (id, name) => {
        set((s) => ({
          items: s.items.map((item) =>
            item.id === id ? { ...item, name } : item
          ),
        }));
      },

      deleteProp: (id) => {
        set((s) => ({ items: s.items.filter((item) => item.id !== id) }));
      },

      moveProp: (propId, folderId) => {
        set((s) => ({
          items: s.items.map((item) =>
            item.id === propId ? { ...item, folderId } : item
          ),
        }));
      },

      // ── 目录操作 ──────────────────────────────────────────────────────────

      addFolder: (name, parentId = null, projectId) => {
        const newFolder: PropFolder = {
          id: `folder_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name,
          parentId,
          projectId,
          isAutoCreated: !!projectId,
          createdAt: Date.now(),
        };
        set((s) => ({ folders: [...s.folders, newFolder] }));
        return newFolder;
      },

      renameFolder: (id, name) => {
        set((s) => ({
          folders: s.folders.map((f) =>
            f.id === id ? { ...f, name } : f
          ),
        }));
      },

      deleteFolder: (id) => {
        set((s) => ({
          folders: s.folders.filter((f) => f.id !== id),
          // 该目录下的道具移至根目录
          items: s.items.map((item) =>
            item.folderId === id ? { ...item, folderId: null } : item
          ),
          // 如果当前选中了该目录，切回"全部"
          selectedFolderId:
            s.selectedFolderId === id ? 'all' : s.selectedFolderId,
        }));
      },

      getOrCreateProjectFolder: (projectId, projectName) => {
        const existing = get().folders.find((folder) => folder.projectId === projectId);
        if (existing) return existing.id;
        return get().addFolder(projectName, null, projectId).id;
      },

      // ── UI 状态 ───────────────────────────────────────────────────────────

      setSelectedFolderId: (folderId) => {
        set({ selectedFolderId: folderId });
      },

      // ── 查询 ─────────────────────────────────────────────────────────────

      getPropsByFolder: (folderId) => {
        const { items } = get();
        if (folderId === 'all') return items;
        return items.filter((item) => item.folderId === folderId);
      },

      getPropById: (id) => {
        return get().items.find((item) => item.id === id);
      },

      assignProjectToUnscoped: (projectId) => {
        set((s) => ({
          items: s.items.map((item) => item.projectId ? item : { ...item, projectId }),
          folders: s.folders.map((folder) => folder.projectId ? folder : { ...folder, projectId }),
        }));
      },

      reset: () => set(initialState),
    }),
    {
      name: 'mystudio-props-library',
      storage: createJSONStorage(() => createSplitStorage<PropLibraryPersistedState>(
        'props', splitPropLibraryDataForStorage, mergePropLibraryDataForStorage
      )),
      partialize: (state) => ({
        items: state.items.map(item => ({
          ...item,
          referenceImages: undefined, // base64 不持久化
        })),
        folders: state.folders,
        selectedFolderId: state.selectedFolderId,
      }),
      merge: (persisted: any, current: any) => ({
        ...current,
        items: persisted?.items ?? current.items,
        folders: persisted?.folders ?? current.folders,
        selectedFolderId: persisted?.selectedFolderId ?? current.selectedFolderId,
      }),
    }
  )
);
