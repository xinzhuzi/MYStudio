/**
 * B2 产品目录 zustand store——渲染进程缓存产品列表,与主进程 SQLite 同步。
 * 不绑项目 scope(产品是顶层实体,跨项目共享)。
 */
import { create } from "zustand";
import type { Product } from "@/types/product";

export interface ProductStore {
  products: Product[];
  loading: boolean;
  setProducts: (products: Product[]) => void;
  upsertProduct: (product: Product) => void;
  removeProduct: (id: string) => void;
  setLoading: (loading: boolean) => void;
}

export const useProductStore = create<ProductStore>((set) => ({
  products: [],
  loading: false,

  setProducts: (products) => set({ products }),

  upsertProduct: (product) => set((state) => ({
    products: [
      ...state.products.filter((p) => p.id !== product.id),
      product,
    ],
  })),

  removeProduct: (id) => set((state) => ({
    products: state.products.filter((p) => p.id !== id),
  })),

  setLoading: (loading) => set({ loading }),
}));
