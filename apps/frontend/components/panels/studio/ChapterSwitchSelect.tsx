import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ChevronsUpDown } from "lucide-react";
import { useStudioStore } from "@/stores/studio/studio-store";
import type { NovelChapter } from "@/types/studio";

/**
 * 全仓唯一可搜索章节切换选择器(10-19 自 ScriptTab 外迁共享;骨架先例 phone-input.tsx)。
 * 剧本页(ScriptTab)与剧本资产页(ScriptAssetManagementTab 页头)共用同一实例语义:
 * G1 切章走 store 装载器(activeChapterId 装载完成后才原子翻转),失败 fail-closed 留原章;
 * R1 装载窗口触发钮禁用+装载 live region。
 * 行为测试(过滤/cap/键盘/装载)经 script-tab.test 的 render(<ScriptTab>) 覆盖本组件,
 * 消费方测试只补「挂载接线」——勿在消费方复制选择器 DOM(双口径禁回流)。
 */
export function ChapterSwitchSelect({
  chapters,
  label = "章节",
}: {
  chapters: NovelChapter[];
  /** 触发钮旁 Label 与 aria-label 同源(ScriptTab 传「章节（1 章 = 1 集）」保持原文案) */
  label?: string;
}) {
  // G1 章选择真源=store.activeChapterId(switchChapter 装载完成后才原子翻转,UI 选中的
  // 章恒为已装载章);空/不在 chapters 时回退第一本(与 ScriptTab 章派生同口径)。
  // 订阅勿用 getState 快照——装载翻转后禁用态/文案须自动跟随。
  const activeChapterId = useStudioStore((state) => state.activeChapterId);
  // R1:切章装载中标志(store 瞬态位)——装载窗口内触发钮禁用+装载中状态自释
  const chapterSwitchLoading = useStudioStore(
    (state) => state.chapterSwitchLoading,
  );
  const chapter =
    chapters.find((item) => item.id === activeChapterId) ?? chapters[0];
  // 1015 可搜索章节选择器:select(全本 4125 项原生 popup 无搜索)→ Popover+Command 组合。
  // cmdk 必 shouldFilter={false}——其内置过滤只对「已渲染 Item」打分,与 cap 窗口化互斥;
  // 自写子串过滤(序号或标题)+exact-index-first 置顶(搜「2000」第2000章必在 cap 内且第一)。
  const [chapterSelectOpen, setChapterSelectOpen] = useState(false);
  const [chapterSearch, setChapterSearch] = useState("");
  // cap=100:对齐 NovelChapterTable.tsx VISIBLE_BATCH=100 先例(全本规模下一次性渲染全量行
  // 会拖垮渲染与 DOM 内存);cap 外渲染提示行,继续输入缩小范围。cap 后 cmdk 恒见 ≤100 项。
  const CHAPTER_SELECT_CAP = 100;
  const filteredChapters = useMemo(() => {
    const q = chapterSearch.trim().toLowerCase();
    if (!q) return chapters;
    const matched = chapters.filter(
      (item) =>
        String(item.index).includes(q) || item.title.toLowerCase().includes(q),
    );
    // exact-index-first:序号精确命中置顶(标题子串匹配的干扰项排后)
    const exact = matched.filter((item) => String(item.index) === q);
    const rest = matched.filter((item) => String(item.index) !== q);
    return [...exact, ...rest];
  }, [chapters, chapterSearch]);
  const visibleChapters = filteredChapters.slice(0, CHAPTER_SELECT_CAP);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label className="text-sm">{label}</Label>
      {/* 1015 可搜索章节选择器(1015 设计:Popover+Command 组合,骨架对齐 phone-input.tsx 先例);
          G1:onSelect 与旧 select onChange 同一调用点同一形态(void switchChapter,UI 只做触发器);
          触发钮文案真源=chapter(自 activeChapterId 派生,装载完才原子翻转即自动跟随,等价旧受控 value);
          R1 精神内增强:装载中 disabled(R1 禁用集按钮不变,store seq 守卫本就容忍装载中再切) */}
      <Popover
        open={chapterSelectOpen}
        onOpenChange={(open) => {
          setChapterSelectOpen(open);
          // 每次打开重置搜索,列表回到 cap 首批
          if (open) setChapterSearch("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            data-testid="chapter-select-trigger"
            aria-haspopup="listbox"
            aria-label={label}
            disabled={chapterSwitchLoading}
            className="h-8 min-w-[260px] max-w-[360px] justify-between gap-2 px-3 text-sm font-normal text-foreground/85"
          >
            <span className="truncate">
              {chapter ? `${chapter.index}. ${chapter.title}` : "选择章节"}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[320px] p-0"
          data-testid="chapter-select-popover"
        >
          <Command shouldFilter={false}>
            <CommandInput
              data-testid="chapter-select-input"
              placeholder="搜索章节（序号或标题）…"
              value={chapterSearch}
              onValueChange={setChapterSearch}
            />
            <CommandList data-testid="chapter-select-list">
              <CommandGroup>
                {visibleChapters.map((item) => (
                  <CommandItem
                    key={item.id}
                    data-testid={`chapter-option-${item.id}`}
                    value={`${item.index}. ${item.title}`}
                    onSelect={() => {
                      setChapterSelectOpen(false);
                      // G1:切章走 store 装载器(目标章工作区装载完成后才原子翻转
                      // activeChapterId),不再只写本地 state;失败 fail-closed 留在原章
                      void useStudioStore.getState().switchChapter(item.id);
                    }}
                  >
                    {item.index}. {item.title}
                  </CommandItem>
                ))}
              </CommandGroup>
              {/* cmdk Empty 自带「零已渲染项才显」语义(shouldFilter=false 下 count=渲染项数) */}
              <CommandEmpty data-testid="chapter-select-empty">
                无匹配章节
              </CommandEmpty>
              {filteredChapters.length > CHAPTER_SELECT_CAP ? (
                <div
                  data-testid="chapter-select-cap-hint"
                  className="border-t px-3 py-2 text-xs text-muted-foreground"
                >
                  已显示 {CHAPTER_SELECT_CAP} / 共 {filteredChapters.length}{" "}
                  个匹配，继续输入缩小范围
                </div>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {/* R1:切章装载中状态自释(polite live region)——同窗口章身份动作禁用 */}
      {chapterSwitchLoading ? (
        <span
          data-testid="chapter-switch-loading"
          role="status"
          className="text-xs text-muted-foreground"
        >
          章节装载中…
        </span>
      ) : null}
    </div>
  );
}
