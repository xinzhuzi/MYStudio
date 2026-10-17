import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StateStorage } from "zustand/middleware";
import { fileStorage } from "/Users/zhengbingjin/Project/Github/MYStudio/apps/frontend/lib/storage/indexed-db-storage";
import {
  createProjectScopedStorage as facadeCreateProjectScopedStorage,
  createSplitStorage as facadeCreateSplitStorage,
} from "/Users/zhengbingjin/Project/Github/MYStudio/apps/frontend/lib/storage/project-storage";
import { createProjectScopedStorage, createSplitStorage } from "/Users/zhengbingjin/Project/Github/MYStudio/apps/frontend/lib/storage/project-storage";

type MockProjectState = {
  activeProjectId: string | null;
  projects: Array<{ id: string }>;
};

type TestItem = {
  id: string;
  projectId?: string;
};

type TestState = {
  items: TestItem[];
  currentFolderId?: string;
};

const storageMocks = vi.hoisted(() => {
  const values = new Map<string, string>();
  const projectState: MockProjectState = {
    activeProjectId: "p1",
    projects: [{ id: "p1" }, { id: "p2" }],
  };
  const resourceSharing = {
    shareCharacters: true,
    shareScenes: true,
    shareMedia: true,
  };
  return {
    values,
    projectState,
    resourceSharing,
    hydrated: true,
    hydrationCallbacks: [] as Array<() => void>,
  };
});

vi.mock("/Users/zhengbingjin/Project/Github/MYStudio/apps/frontend/lib/storage/indexed-db-storage", () => ({
  fileStorage: {
    getItem: vi.fn(async (key: string) => storageMocks.values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storageMocks.values.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      storageMocks.values.delete(key);
    }),
  },
}));

vi.mock("@/stores/project/project-store", () => ({
  useProjectStore: {
    getState: () => storageMocks.projectState,
    persist: {
      hasHydrated: () => storageMocks.hydrated,
      onFinishHydration: (callback: () => void) => {
        storageMocks.hydrationCallbacks.push(callback);
        return () => {
          storageMocks.hydrationCallbacks = storageMocks.hydrationCallbacks.filter((item) => item !== callback);
        };
      },
    },
  },
}));

vi.mock("@/stores/app/app-settings-store", () => ({
  useAppSettingsStore: {
    getState: () => ({ resourceSharing: storageMocks.resourceSharing }),
  },
}));

beforeEach(() => {
  storageMocks.values.clear();
  storageMocks.projectState.activeProjectId = "p1";
  storageMocks.projectState.projects = [{ id: "p1" }, { id: "p2" }];
  storageMocks.resourceSharing.shareCharacters = true;
  storageMocks.resourceSharing.shareScenes = true;
  storageMocks.resourceSharing.shareMedia = true;
  storageMocks.hydrated = true;
  storageMocks.hydrationCallbacks = [];
  vi.clearAllMocks();
});


const split=(state:TestState,pid:string)=>({projectData:{...state,items:state.items.filter(i=>i.projectId===pid)},sharedData:{...state,items:state.items.filter(i=>!i.projectId)}});
const merge=(a:TestState|null,b:TestState|null)=>({items:[...(b?.items??[]),...(a?.items??[])]});
const make=()=>createSplitStorage<TestState>("characters",split,merge,"shareCharacters");
const seed=(key:string,items:TestItem[])=>storageMocks.values.set(key,JSON.stringify({state:{items},version:1}));
describe("audit: split storage data loss reproduction",()=>{
 it("saving while sharing is disabled preserves existing shared resources",async()=>{
  storageMocks.resourceSharing.shareCharacters=false;
  seed("_p/p1/characters",[{id:"own",projectId:"p1"}]);seed("_shared/characters",[{id:"shared"}]);
  const storage=make(); const loaded=await storage.getItem("library");
  await storage.setItem("library",loaded!);
  expect(JSON.parse(storageMocks.values.get("_shared/characters")!).state.items).toEqual([{id:"shared"}]);
 });
 it("removing the last loaded other-project item remains deleted after reload",async()=>{
  seed("_p/p1/characters",[]);seed("_p/p2/characters",[{id:"last",projectId:"p2"}]);
  const storage=make();const loaded=JSON.parse((await storage.getItem("library"))!);
  expect(loaded.state.items).toHaveLength(1);
  loaded.state.items=[];await storage.setItem("library",JSON.stringify(loaded));
  const reloaded=JSON.parse((await storage.getItem("library"))!);
  expect(reloaded.state.items.map((i:TestItem)=>i.id)).toEqual([]);
 });
});
