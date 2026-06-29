import {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import aiEventAnalysisIconUrl from "@/assets/brand/ai-event-analysis-icon.svg";
import { useStudioStore } from "@/stores/studio-store";
import type { NovelChapter } from "@/types/studio";
import { Edit3, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { NovelChapterTable } from "./NovelChapterTable";
import { NovelEditDialog, type NovelEditDraft } from "./NovelEditDialog";
import { NovelImportDialog } from "./NovelImportDialog";

export function NovelEmptyState({
  hasNovelChapters,
  onImport,
}: {
  hasNovelChapters: boolean;
  onImport: () => void;
}) {
  if (hasNovelChapters) {
    return <span>没有匹配的章节。</span>;
  }

  return (
    <button
      type="button"
      onClick={onImport}
      className="mx-auto flex flex-col items-center gap-3 rounded-lg px-6 py-4 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
    >
      <span>还没有导入小说。</span>
      <span className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground">
        <Plus className="h-4 w-4" />
        导入原文
      </span>
    </button>
  );
}

export function NovelTab(props: {
  novelDraft: string;
  setNovelDraft: (value: string) => void;
  handleNovelFile: (file?: File) => void | Promise<void>;
  appendNovelText: (value: string, sourceName?: string) => void;
  replaceNovelText: (value: string, sourceName?: string) => void;
  deleteNovelChapters: ReturnType<
    typeof useStudioStore.getState
  >["deleteNovelChapters"];
  novelChapters: ReturnType<typeof useStudioStore.getState>["novelChapters"];
  updateNovelChapter: ReturnType<
    typeof useStudioStore.getState
  >["updateNovelChapter"];
  analyzeEvents: (chapters: NovelChapter[]) => void | Promise<void>;
  setHeaderActions: (actions: ReactNode) => void;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<"append" | "replace">("append");
  const [importSourceName, setImportSourceName] = useState("");
  const [searchText, setSearchText] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingChapter, setEditingChapter] = useState<NovelChapter | null>(
    null,
  );
  const [deletingChapter, setDeletingChapter] = useState<NovelChapter | null>(
    null,
  );
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editDraft, setEditDraft] = useState<NovelEditDraft>({
    volume: "",
    title: "",
    sourceText: "",
    eventSummary: "",
    eventState: "",
  });

  const query = searchText.trim().toLowerCase();
  const filteredChapters = query
    ? props.novelChapters.filter((chapter) =>
        [
          chapter.title,
          chapter.volume,
          chapter.sourceText,
          chapter.eventSummary,
          chapter.eventState,
        ].some((value) => value?.toLowerCase().includes(query)),
      )
    : props.novelChapters;
  const selectedChapters = useMemo(
    () => props.novelChapters.filter((chapter) => selectedIds.has(chapter.id)),
    [props.novelChapters, selectedIds],
  );
  const visibleSelectedCount = filteredChapters.filter((chapter) =>
    selectedIds.has(chapter.id),
  ).length;
  const allVisibleSelected =
    filteredChapters.length > 0 &&
    visibleSelectedCount === filteredChapters.length;

  const handleOpenImport = useCallback(() => {
    setImportMode("append");
    setImportOpen(true);
  }, []);

  const handleImportFile = async (file?: File) => {
    if (!file) return;
    setImportSourceName(file.name);
    await props.handleNovelFile(file);
  };

  const handleConfirmImport = () => {
    const sourceText = props.novelDraft.trim();
    if (!sourceText) return;
    if (importMode === "replace") {
      props.replaceNovelText(sourceText, importSourceName || undefined);
    } else {
      props.appendNovelText(sourceText, importSourceName || undefined);
    }
    props.setNovelDraft("");
    setImportSourceName("");
    setImportOpen(false);
    toast.success(
      importMode === "replace" ? "小说章节已覆盖导入" : "小说章节已追加导入",
    );
  };

  const toggleChapter = (id: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const toggleAllVisible = (checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const chapter of filteredChapters) {
        if (checked) {
          next.add(chapter.id);
        } else {
          next.delete(chapter.id);
        }
      }
      return next;
    });
  };

  const openSingleDelete = (chapter: NovelChapter) => {
    setDeletingChapter(chapter);
    setDeleteOpen(true);
  };

  const openBatchDelete = useCallback(() => {
    setDeletingChapter(null);
    setDeleteOpen(true);
  }, []);

  const handleAnalyzeSelectedChapters = useCallback(() => {
    props.analyzeEvents(selectedChapters);
  }, [props.analyzeEvents, selectedChapters]);

  const handleConfirmDelete = () => {
    const ids = deletingChapter
      ? [deletingChapter.id]
      : Array.from(selectedIds);
    props.deleteNovelChapters(ids);
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of ids) {
        next.delete(id);
      }
      return next;
    });
    const deletedCount = ids.length;
    setDeletingChapter(null);
    setDeleteOpen(false);
    toast.success(`已删除 ${deletedCount} 个章节`);
  };

  const openEdit = (chapter: NovelChapter) => {
    setEditingChapter(chapter);
    setEditDraft({
      volume: chapter.volume ?? "正文卷",
      title: chapter.title,
      sourceText: chapter.sourceText,
      eventSummary: chapter.eventSummary ?? "",
      eventState: chapter.eventState ?? "",
    });
  };

  const saveEdit = () => {
    if (!editingChapter) return;
    props.updateNovelChapter(editingChapter.id, {
      volume: editDraft.volume.trim() || "正文卷",
      title: editDraft.title.trim() || editingChapter.title,
      sourceText: editDraft.sourceText,
      eventSummary: editDraft.eventSummary,
      eventState: editDraft.eventState,
    });
    setEditingChapter(null);
    toast.success("章节已保存");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-panel/40 p-3">
        <Button onClick={handleOpenImport}>
          <Plus className="h-4 w-4" />
          导入原文
        </Button>
        <Button
          variant="destructive"
          disabled={selectedIds.size === 0}
          onClick={openBatchDelete}
        >
          <Trash2 className="h-4 w-4" />
          批量删除 ({selectedIds.size})
        </Button>
        <Button
          variant="secondary"
          disabled={selectedIds.size === 0}
          onClick={handleAnalyzeSelectedChapters}
        >
          <img
            src={aiEventAnalysisIconUrl}
            alt=""
            className="h-4 w-4 rounded-[3px]"
          />
          事件分析 ({selectedIds.size})
        </Button>
        <div className="relative min-w-[260px] max-w-[520px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            className="pl-9"
            placeholder="搜索章节名称或正文..."
          />
        </div>
      </div>

      <NovelChapterTable
        chapters={filteredChapters}
        selectedIds={selectedIds}
        allVisibleSelected={allVisibleSelected}
        emptyState={
          <NovelEmptyState
            hasNovelChapters={props.novelChapters.length > 0}
            onImport={handleOpenImport}
          />
        }
        onDelete={openSingleDelete}
        onEdit={openEdit}
        onToggleAllVisible={toggleAllVisible}
        onToggleChapter={toggleChapter}
      />

      <NovelImportDialog
        open={importOpen}
        importMode={importMode}
        importSourceName={importSourceName}
        novelDraft={props.novelDraft}
        onOpenChange={setImportOpen}
        onImportModeChange={setImportMode}
        onNovelDraftChange={props.setNovelDraft}
        onFileChange={(file) => void handleImportFile(file)}
        onConfirmImport={handleConfirmImport}
      />

      <NovelEditDialog
        open={Boolean(editingChapter)}
        draft={editDraft}
        onOpenChange={(open) => !open && setEditingChapter(null)}
        onDraftChange={setEditDraft}
        onSave={saveEdit}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除选中章节</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingChapter
                ? `将删除「${deletingChapter.title}」，并移除项目存储位置下对应的章节文档。`
                : `将删除 ${selectedIds.size} 个章节，并移除项目存储位置下对应的章节文档。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeletingChapter(null)}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
