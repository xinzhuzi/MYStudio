// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioAssetSummary } from "@/types/studio-assets";
import type { StudioAssetLibrary as Library } from "./StudioAssetLibrary";
const mocks = vi.hoisted(() => ({ list: vi.fn(), toastError: vi.fn(), empty: [], action: vi.fn() }));
vi.mock("@/lib/bridge/studio-assets", () => ({ getStudioAssetsBridge: () => ({ list: mocks.list }) }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
vi.mock("@/stores/library/props-library-store", () => ({ usePropsLibraryStore: (s: (v: unknown) => unknown) => s({ items: mocks.empty }) }));
vi.mock("@/stores/studio/studio-store", () => ({ useStudioStore: (s: (v: unknown) => unknown) => s({ materials: mocks.empty, entityExtractions: mocks.empty }) }));
vi.mock("@/stores/project/project-store", () => ({ useProjectStore: (s: (v: unknown) => unknown) => s({ activeProjectId: null }) }));
vi.mock("@/stores/tts/tts-store", () => ({ useTtsStore: (s: (v: unknown) => unknown) => s({ setActiveProjectId: mocks.action, createVoiceProfile: mocks.action, bindSpeaker: mocks.action }) }));
vi.mock("@/lib/ai/ai-manager", () => ({ aiManager: {} }));
vi.mock("./StudioAssetDetailDialog", () => ({ StudioAssetDetailDialog: () => null }));
vi.mock("./AddAssetDialog", () => ({ AddAssetDialog: () => null }));
vi.mock("./AssetGenerationBar", () => ({ AssetGenerationBar: () => null }));
// Mock only the viewport-dependent grid; exercise the real query controller.
vi.mock("./audio-grouped-grid", () => ({ AudioGroupedGrid: (p: {
 items: StudioAssetSummary[]; isLoading: boolean; isLoadingMore: boolean; error: string;
 selectedIds: Set<string>; onToggleSelect: (id: string) => void;
 canLoadMore: boolean; onLoadMore: () => void; onRefresh: () => void;
}) => <div>
 <output data-testid="status">{p.isLoading ? "loading" : p.isLoadingMore ? "appending" : "idle"}</output>
 <output data-testid="error">{p.error}</output><output data-testid="selected">{p.selectedIds.size}</output>
 {p.items.map(i => <button key={i.id} onClick={() => p.onToggleSelect(i.id)}>{i.name}</button>)}
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
