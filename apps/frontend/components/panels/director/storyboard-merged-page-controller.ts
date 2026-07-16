interface MergedPageNotifier {
  info: (message: string) => void;
  success: (message: string) => void;
  warning: (message: string) => void;
  error: (message: string) => void;
}

interface RunStoryboardMergedPagesOptions<Task> {
  pages: Task[][];
  signal: AbortSignal;
  isAborted: () => boolean;
  getTaskType: (task: Task) => "first" | "end";
  collectReferences: (tasks: Task[]) => string[];
  generatePage: (tasks: Task[], references: string[]) => Promise<unknown>;
  resetPageTasksToError: (tasks: Task[], message: string) => void;
  waitForRetry: (milliseconds: number, signal: AbortSignal) => Promise<unknown>;
  finish: (signal: AbortSignal) => void;
  setRunning: (running: boolean) => void;
  notify: MergedPageNotifier;
}

interface FailedPage<Task> {
  index: number;
  tasks: Task[];
  references: string[];
  error: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function pageInfo<Task>(tasks: Task[], getTaskType: (task: Task) => "first" | "end") {
  const firstCount = tasks.filter((task) => getTaskType(task) === "first").length;
  const endCount = tasks.filter((task) => getTaskType(task) === "end").length;
  return [firstCount > 0 ? `${firstCount}首帧` : "", endCount > 0 ? `${endCount}尾帧` : ""]
    .filter(Boolean)
    .join("+");
}

export async function runStoryboardMergedPages<Task>({
  pages,
  signal,
  isAborted,
  getTaskType,
  collectReferences,
  generatePage,
  resetPageTasksToError,
  waitForRetry,
  finish,
  setRunning,
  notify,
}: RunStoryboardMergedPagesOptions<Task>): Promise<void> {
  const failedPages: FailedPage<Task>[] = [];
  let succeededCount = 0;

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    if (isAborted()) {
      console.log("[MergedGen] 用户停止合并生成");
      notify.info("合并生成已停止");
      setRunning(false);
      return;
    }

    const tasks = pages[pageIndex];
    const references = collectReferences(tasks);
    const info = pageInfo(tasks, getTaskType);
    console.log(`[MergedGen] 第 ${pageIndex + 1}/${pages.length} 页，${tasks.length} 个任务（${info}），${references.length} 张参考图`);

    try {
      await generatePage(tasks, references);
      succeededCount += 1;
      if (!isAborted()) notify.success(`第 ${pageIndex + 1}/${pages.length} 页完成（${info}）`);
    } catch (error) {
      if (isAborted() || isAbortError(error)) {
        finish(signal);
        setRunning(false);
        return;
      }
      const message = errorMessage(error);
      console.error(`[MergedGen] 第 ${pageIndex + 1} 页失败:`, message);
      resetPageTasksToError(tasks, message);
      failedPages.push({ index: pageIndex, tasks, references, error: message });
      notify.warning(`第 ${pageIndex + 1}/${pages.length} 页失败，将自动重试：${message.substring(0, 60)}`);
    }
  }

  if (failedPages.length > 0 && !isAborted()) {
    console.log(`[MergedGen] ${failedPages.length} 页失败，5 秒后自动重试...`);
    notify.info(`${failedPages.length} 页生成失败，5 秒后自动重试...`);
    try {
      await waitForRetry(5000, signal);
    } catch (error) {
      if (isAborted() || isAbortError(error)) {
        finish(signal);
        setRunning(false);
        return;
      }
      throw error;
    }

    for (const failedPage of failedPages) {
      if (isAborted()) break;
      const info = pageInfo(failedPage.tasks, getTaskType);
      console.log(`[MergedGen] 自动重试第 ${failedPage.index + 1} 页（${info}）`);
      try {
        const references = collectReferences(failedPage.tasks);
        await generatePage(failedPage.tasks, references);
        succeededCount += 1;
        notify.success(`第 ${failedPage.index + 1} 页重试成功（${info}）`);
      } catch (error) {
        if (isAborted() || isAbortError(error)) {
          finish(signal);
          setRunning(false);
          return;
        }
        const message = errorMessage(error);
        console.error(`[MergedGen] 第 ${failedPage.index + 1} 页重试仍然失败:`, message);
        resetPageTasksToError(failedPage.tasks, `重试失败: ${message}`);
        notify.error(`第 ${failedPage.index + 1} 页重试失败: ${message.substring(0, 80)}`);
      }
    }
  }

  const totalPages = pages.length;
  if (!isAborted()) {
    if (succeededCount === totalPages) notify.success("九宫格合并生成全部完成！");
    else if (succeededCount > 0) {
      notify.warning(`合并生成部分完成：${succeededCount}/${totalPages} 页成功，${totalPages - succeededCount} 页失败`);
    } else notify.error(`合并生成全部失败（${totalPages} 页），请检查 API 服务后重试`);
  }
  finish(signal);
  setRunning(false);
}
