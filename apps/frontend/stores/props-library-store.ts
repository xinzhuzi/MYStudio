// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * PropsLibraryStore - 道具库状态管理
 * 支持自定义目录分类，持久化到 localStorage
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// 道具项
export interface PropItem {
  id: string;
  name: string;           // 道具名称（可编辑）
  imageUrl: string;       // local-image://props/... 或远程URL
  prompt: string;         // 生成时的提示词（供参考）
  folderId: string | null; // 所属目录，null = 根目录
  createdAt: number;
}

// 自定义目录
export interface PropFolder {
  id: string;
  name: string;           // 目录名称
  parentId: string | null; // 预留嵌套扩展（当前UI仅用一级）
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
  renameProp: (id: string, name: string) => void;
  deleteProp: (id: string) => void;
  moveProp: (propId: string, folderId: string | null) => void;

  // 目录操作
  addFolder: (name: string, parentId?: string | null) => PropFolder;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void; // 删除时子道具移至根目录

  // UI 状态
  setSelectedFolderId: (folderId: string | null | 'all') => void;

  // 查询
  getPropsByFolder: (folderId: string | null | 'all') => PropItem[];
  getPropById: (id: string) => PropItem | undefined;
}

type PropsLibraryStore = PropsLibraryState & PropsLibraryActions;

export const usePropsLibraryStore = create<PropsLibraryStore>()(
  persist(
    (set, get) => ({
      items: [],
      folders: [],
      selectedFolderId: 'all',

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

      addFolder: (name, parentId = null) => {
        const newFolder: PropFolder = {
          id: `folder_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name,
          parentId,
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
    }),
    {
      name: 'mystudio-props-library',
      partialize: (state) => ({
        items: state.items,
        folders: state.folders,
      }),
    }
  )
);
