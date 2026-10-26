// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioAssetSummary } from "@/types/studio-assets";
import type { StudioAssetLibrary as Library } from "./StudioAssetLibrary";
const mocks = vi.hoisted(() => ({ list: vi.fn(), listFamily: vi.fn(), dialogProps: vi.fn(), toastError: vi.fn(), empty: [], action: vi.fn() }));
vi.mock("@/lib/bridge/studio-assets", () => ({ getStudioAssetsBridge: () => ({ list: mocks.list, listFamily: mocks.listFamily }) }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
vi.mock("@/stores/library/props-library-store", () => ({ usePropsLibraryStore: (s: (v: unknown) => unknown) => s({ items: mocks.empty }) }));
vi.mock("@/stores/studio/studio-store", () => ({ useStudioStore: (s: (v: unknown) => unknown) => s({ materials: mocks.empty, entityExtractions: mocks.empty }) }));
vi.mock("@/stores/project/project-store", () => ({ useProjectStore: (s: (v: unknown) => unknown) => s({ activeProjectId: null }) }));
vi.mock("@/stores/tts/tts-store", () => ({ useTtsStore: (s: (v: unknown) => unknown) => s({ setActiveProjectId: mocks.action, createVoiceProfile: mocks.action, bindSpeaker: mocks.action }) }));
vi.mock("@/lib/ai/ai-manager", () => ({ aiManager: {} }));
vi.mock("./StudioAssetDetailDialog", () => ({ StudioAssetDetailDialog: (p: unknown) => { mocks.dialogProps(p); return null; } }));
vi.mock("./AddAssetDialog", () => ({ AddAssetDialog: () => null }));
vi.mock("./AssetGenerationBar", () => ({ AssetGenerationBar: () => null }));
// Mock only the viewport-dependent grid; exercise the real query controller.
vi.mock("./audio-grouped-grid", () => ({ AudioGroupedGrid: (p: {
 items: StudioAssetSummary[]; isLoading: boolean; isLoadingMore: boolean; error: string;
 selectedIds: Set<string>; onToggleSelect: (id: string) => void; onOpen: (asset: StudioAssetSummary) => void;
 canLoadMore: boolean; onLoadMore: () => void; onRefresh: () => void;
}) => <div>
 <output data-testid="status">{p.isLoading ? "loading" : p.isLoadingMore ? "appending" : "idle"}</output>
 <output data-testid="error">{p.error}</output><output data-testid="selected">{p.selectedIds.size}</output>
 {p.items.map(i => <span key={i.id}><button onClick={() => p.onToggleSelect(i.id)}>{i.name}</button><output data-testid={`thumb-${i.id}`}>{i.thumbnailUrl ?? ""}</output><button data-testid={`open-${i.id}`} onClick={() => p.onOpen(i)}>open</button></span>)}
 {p.canLoadMore && <button onClick={p.onLoadMore}>next-page</button>}
 <button onClick={p.onRefresh}>refresh-query</button>
 </div> }));
function deferred() {
 let resolve!: (v: { items: StudioAssetSummary[]; total: number }) => void;
 let reject!: (e: Error) => void;
 const promise = new Promise<{ items: StudioAssetSummary[]; total: number }>((a,b) => { resolve=a; reject=b; });
 return { promise, resolve, reject };
}
const row = (id: string): StudioAssetSummary => ({ id, name: id, type: "role", source: "manying-local" });
const result = (...ids: string[]) => ({ items: ids.map(row), total: ids.length });
let StudioAssetLibrary: typeof Library;
beforeEach(async () => { vi.resetModules(); vi.resetAllMocks(); ({ StudioAssetLibrary } = await import("./StudioAssetLibrary")); });
afterEach(cleanup);
async function search(value: string) {
 fireEvent.change(screen.getByPlaceholderText("搜索名称"), { target: { value } });
 await act(async () => { await new Promise(r => setTimeout(r,210)); });
}
async function settle(d: ReturnType<typeof deferred>, ...ids: string[]) { await act(async () => { d.resolve(result(...ids)); }); }
describe("asset query lifecycle", () => {
 it("invalidates a late success when returning to cached data", async () => {
  const old=deferred(); mocks.list.mockResolvedValueOnce(result("cached")).mockReturnValueOnce(old.promise);
  render(<StudioAssetLibrary type="role" />); await screen.findByText("cached");
  await search("slow"); expect(screen.getByTestId("status").textContent).toBe("loading");
  await search(""); expect(screen.getByTestId("status").textContent).toBe("idle");
  await settle(old,"obsolete"); expect(screen.queryByText("obsolete")).toBeNull(); expect(screen.getByText("cached")).toBeTruthy();
  expect(mocks.list).toHaveBeenCalledTimes(2);
 });
 it("ignores stale rejections without ending the latest loading state", async () => {
  const old=deferred(),latest=deferred(); mocks.list.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  render(<StudioAssetLibrary type="role" />); await search("latest");
  await act(async () => { old.reject(new Error("obsolete failure")); });
  expect(screen.getByTestId("error").textContent).toBe(""); expect(mocks.toastError).not.toHaveBeenCalled();
  expect(screen.getByTestId("status").textContent).toBe("loading"); await settle(latest,"current"); expect(screen.getByText("current")).toBeTruthy();
 });
 it("clears a current failure when returning to cached data", async () => {
  mocks.list.mockResolvedValueOnce(result("cached")).mockRejectedValueOnce(new Error("active failure"));
  render(<StudioAssetLibrary type="role" />); await screen.findByText("cached"); await search("broken");
  expect(screen.getByTestId("error").textContent).toBe("active failure"); await search("");
  expect(screen.getByTestId("error").textContent).toBe(""); expect(screen.getByText("cached")).toBeTruthy();
 });
 it("deduplicates append results and rejects old pages after search", async () => {
  const page=deferred(); mocks.list.mockResolvedValueOnce({ ...result("first"), total:4 }).mockResolvedValueOnce({ ...result("first","second"), total:4 }).mockReturnValueOnce(page.promise).mockResolvedValueOnce(result("filtered"));
  render(<StudioAssetLibrary type="role" />); await screen.findByText("first"); fireEvent.click(screen.getByText("next-page")); await screen.findByText("second");
  expect(screen.getAllByText("first")).toHaveLength(1); expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({offset:1,limit:60}));
  fireEvent.click(screen.getByText("next-page")); await search("filtered"); await settle(page,"wrong-page");
  expect(screen.queryByText("wrong-page")).toBeNull(); expect(screen.queryByText("first")).toBeNull(); expect(screen.getByText("filtered")).toBeTruthy();
 });
 it("refreshes cached data and clears selection on search and category changes", async () => {
  mocks.list.mockResolvedValueOnce(result("first")).mockResolvedValueOnce(result("refreshed")).mockResolvedValueOnce(result("filtered")).mockResolvedValueOnce(result("new-category"));
  render(<StudioAssetLibrary type="tool" />); await screen.findByText("first"); fireEvent.click(screen.getByText("refresh-query")); await screen.findByText("refreshed");
  expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({refresh:true,category:"货币"}));
  fireEvent.click(screen.getByText("refreshed")); expect(screen.getByTestId("selected").textContent).toBe("1"); await search("filtered"); expect(screen.getByTestId("selected").textContent).toBe("0");
  fireEvent.click(screen.getByText("filtered")); fireEvent.click(screen.getByText("灵草")); await screen.findByText("new-category");
  expect(screen.getByTestId("selected").textContent).toBe("0"); expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({category:"灵草"}));
 });
 it("ignores errors after unmount", async () => {
  const old=deferred(); mocks.list.mockReturnValueOnce(old.promise);
  const view=render(<StudioAssetLibrary type="role" />); view.unmount();
  await act(async () => { old.reject(new Error("unmounted")); }); expect(mocks.toastError).not.toHaveBeenCalled();
 });
});

describe("R4 扩面:卡片详情族聚显(资产库面板)", () => {
 const fam = (id: string): StudioAssetSummary =>
  ({ id, name: id, type: "role", source: "manying-local", previewUrl: `asset-file://role/${id}.png`, filePath: `role/${id}.png` });
 const lastDialog = () => mocks.dialogProps.mock.calls[mocks.dialogProps.mock.calls.length - 1]?.[0] as
  { asset?: StudioAssetSummary; familyImages?: Array<{ url?: string }> } | undefined;

 it("opens a role card with family aggregation fetched by card name", async () => {
  mocks.list.mockResolvedValueOnce(result("晏燎"));
  mocks.listFamily.mockResolvedValueOnce([fam("晏燎"), fam("晏燎_练气期_三视图_v1"), fam("晏燎_共主期_海报_v1")]);
  render(<StudioAssetLibrary type="role" />); await screen.findByText("晏燎");
  fireEvent.click(screen.getByTestId("open-晏燎"));
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  expect(mocks.listFamily).toHaveBeenCalledWith({ type: "role", name: "晏燎" });
  expect(lastDialog()?.asset?.name).toBe("晏燎");
  expect(lastDialog()?.familyImages?.map((e) => e.url)).toEqual([
   "asset-file://role/晏燎.png", "asset-file://role/晏燎_练气期_三视图_v1.png", "asset-file://role/晏燎_共主期_海报_v1.png",
  ]);
 });

 it("does not fetch family for non-aggregating kinds", async () => {
  mocks.list.mockResolvedValueOnce({ items: [{ id: "audio-1", name: "旁白", type: "audio", source: "manying-local" }], total: 1 });
  render(<StudioAssetLibrary type="audio" />); await screen.findByText("旁白");
  fireEvent.click(screen.getByTestId("open-audio-1"));
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  expect(mocks.listFamily).not.toHaveBeenCalled();
  expect(lastDialog()?.familyImages).toBeUndefined();
 });

 it("discards a late family response after switching cards", async () => {
  mocks.list.mockResolvedValueOnce(result("晏燎", "独孤剑尘"));
  const slow = deferred() as unknown as { promise: Promise<StudioAssetSummary[]>; resolve: (v: StudioAssetSummary[]) => void };
  mocks.listFamily.mockReturnValueOnce(slow.promise).mockResolvedValueOnce([fam("独孤剑尘")]);
  render(<StudioAssetLibrary type="role" />); await screen.findByText("晏燎");
  fireEvent.click(screen.getByTestId("open-晏燎"));
  fireEvent.click(screen.getByTestId("open-独孤剑尘"));
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  await act(async () => { slow.resolve([fam("晏燎_旧图")]); });
  expect(lastDialog()?.asset?.name).toBe("独孤剑尘");
  expect(lastDialog()?.familyImages?.map((e) => e.url)).toEqual(["asset-file://role/独孤剑尘.png"]);
 });
});

describe("10-26 角色卡封面择优(有高清人脸用高清人脸)", () => {
  it("role 带高清人脸图→卡封面覆写为该图;无→原样", async () => {
    const withFace: StudioAssetSummary = {
      ...row("晏燎"), thumbnailUrl: "asset-file://role/全身.png",
      images: [
        { name: "晏燎_无衣物定妆_v1", filePath: "role/晏燎/晏燎_无衣物定妆_v1.png", url: "asset-file://role/全身.png", kind: "无衣物定妆" },
        { name: "晏燎_高清人脸_v1", filePath: "role/晏燎/晏燎_高清人脸_v1.png", url: "asset-file://role/人脸.png", kind: "高清人脸" },
      ],
    };
    const noFace: StudioAssetSummary = { ...row("小杂役"), thumbnailUrl: "asset-file://role/杂役.png" };
    mocks.list.mockResolvedValueOnce({ items: [withFace, noFace], total: 2 });
    render(<StudioAssetLibrary type="role" />);
    await screen.findAllByText("晏燎");
    expect(screen.getByTestId("thumb-晏燎").textContent).toBe("asset-file://role/人脸.png");
    expect(screen.getByTestId("thumb-小杂役").textContent).toBe("asset-file://role/杂役.png");
  });
});
