"use client";
// ComfyUI 画布工作室(09-09 comfyui-frontend-swap 0b,辅助面板第六 tab)。
//
// webview 嵌自管引擎完整前端(ComfyUI 原生界面:节点库/工作流/插件管理)。
// 引擎状态机复用设置页引擎卡链(useComfyEngineSettings):
// - 未安装/需准备 → 一键安装(手动点击,绝不自动)
// - 已就绪未跑 → 启动按钮(冷启动 job 轮询,torch 加载可达两分钟)
// - 运行中(port 就绪) → webview 指向 http://127.0.0.1:<port>/
// 该 tab 也是后续阶段(业务自定义节点/画布主体切换)的调试台。

import { useEffect, useMemo, useRef } from "react";
import { Loader2, PlayCircle, ServerCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useComfyEngineSettings } from "@/components/panels/settings/comfy-engine/useComfyEngineSettings";
import { getComfyEngineClient } from "@/components/panels/settings/comfy-engine/comfy-engine-contract";
import { consumeComfyBridgeWritebacks } from "@/lib/assist/image-studio/comfy-bridge-writeback-consumer";
import { syncStoryboardOverviewToLibrary } from "@/lib/assist/image-studio/storyboard-overview-sync";
import { useStudioStore } from "@/stores/studio/studio-store";

/** 画布内文本选中样式:ComfyUI 前端唯一选中规则是 xterm vendor css 泄漏的
 * 全局 ::selection{color:transparent} 且无背景定义 → Chromium 默认黄底裸奔
 * (09-10 实弹:工作流树选中=黄条+隐形字,与两边主题都不符)。宿主注入
 * 主题一致选中色(照应用 ::selection 配方 --primary/28%,文字恢复可见)。 */
export const WEBVIEW_SELECTION_CSS =
  "::selection{background:hsl(212 100% 48% / 0.28)!important;color:inherit!important}";

/** Electron webview 的宿主注入面(React 类型表不覆盖 webview tag 专有 API)。 */
type WebviewElement = HTMLElement & {
  insertCSS?: (css: string) => Promise<string>;
  __selectionHooked?: boolean;
};

export function ComfyCanvasStudio() {
  const webviewRef = useRef<WebviewElement | null>(null);
  // dom-ready 不在 React 合成事件类型表里 → ref 回调挂原生监听(幂等防重)。
  // ⚠不可挂载即调:attach 前调 insertCSS 是同步 throw(Electron 实弹 21:31 白屏:
  // "must be attached...before this method"),事件期调用则安全;双事件兜底
  // (did-finish-load 每次加载必发,防 dom-ready 竞态错过),重复注入同规则无害。
  const attachWebview = (node: WebviewElement | null) => {
    webviewRef.current = node;
    if (node && !node.__selectionHooked) {
      node.__selectionHooked = true;
      const inject = () => {
        try {
          node.insertCSS?.(WEBVIEW_SELECTION_CSS)?.catch(() => undefined);
        } catch {
          // 未就绪窗口的同步抛错:吞掉,等下一事件兜底
        }
      };
      node.addEventListener("dom-ready", inject);
      node.addEventListener("did-finish-load", inject);
    }
  };
  // client 引用必须稳定(传入 hook):否则 hook 内 getComfyEngineClient() 每次
  // 渲染返回新 HTTP client→挂载探测 effect 循环重跑(09-09 实弹报障同根因)
  const client = useMemo(() => getComfyEngineClient(), []);
  const {
    hasBridge,
    status,
    activeJob,
    installEngine,
    startService,
    isStartingService,
  } = useComfyEngineSettings({ client, pollIntervalMs: 1200 });

  // bridge 回写消费(阶段1):tab 在场即轮询收件箱——收件箱在 sidecar,
  // 引擎停着也可能有积压(上轮画布出图未消费);重叠轮询用 inFlight 压。
  useEffect(() => {
    if (!hasBridge) return;
    let inFlight = false;
    let stopped = false;
    const tick = async () => {
      if (inFlight || stopped) return;
      inFlight = true;
      try {
        // 业务侧栏数据面(阶段2 批3):快照与收件箱同 tick 推/拉
        const storyboards = useStudioStore.getState().storyboards;
        void client?.pushBridgeStoryboards(
          storyboards.map((item) => ({
            id: item.id,
            label: `S${String(item.index).padStart(2, "0")}${item.videoDesc ? ` · ${item.videoDesc.slice(0, 12)}` : ""}`,
            episodeId: item.episodeId,
          })),
        ).catch(() => undefined);
        // 主视图 ComfyUI 化(批8):总览图库内保鲜(指纹守卫,分镜未动不导入)
        void syncStoryboardOverviewToLibrary().catch(() => undefined);
        await consumeComfyBridgeWritebacks({ client });
      } catch {
        // 消费器内部已吞错并通知;此处兜底静默(轮询面不弹窗轰炸)
      } finally {
        inFlight = false;
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 5000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [client, hasBridge]);

  const installing = activeJob?.state === "running" && activeJob.kind === "install";
  const port = status?.port ?? null;
  const running = status?.serviceRunning === true && Boolean(port);
  const src = running && port ? `http://127.0.0.1:${port}/` : null;

  if (!hasBridge) {
    return (
      <Center>
        <ServerCog className="mb-3 h-10 w-10 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">
          当前环境不支持引擎管理(webview 桥不可达),请在桌面应用中使用。
        </p>
      </Center>
    );
  }

  // 安装进行中(job 活着)优先展示进度——此时状态查询可能被本地服务抖动挡住
  if (installing) {
    return (
      <Center>
        <ServerCog className="mb-3 h-10 w-10 text-muted-foreground" aria-hidden />
        <h3 className="text-base font-medium text-foreground">ComfyUI 画布</h3>
        <p className="mb-4 max-w-md text-center text-sm text-muted-foreground">
          {`正在安装引擎(${activeJob?.progress ?? 0}%)——${activeJob?.message ?? "下载中,体积较大请耐心等待"}`}
        </p>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          安装进行中…
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          安装位置/磁盘可在 设置 → 本地配置 → ComfyUI 引擎 → 存储位置 里自定义
        </p>
      </Center>
    );
  }

  // 状态查询不到(sidecar 未起/刚死/网络抖动):是「未知」不是「未安装」——
  // 09-10 用户实弹报障:引擎已装却渲染「还没安装」,点安装还会被同一门禁挡住。
  // 自愈拉起在 useComfyEngineSettings(连续失败节流 prepare),这里只如实展示。
  if (!status) {
    return (
      <Center data-comfy-canvas-checking>
        <Loader2 className="mb-3 h-8 w-8 animate-spin text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">正在确认引擎状态(本地服务未就绪,正在尝试拉起)…</p>
      </Center>
    );
  }

  // 引擎未装/装了一半:手动一键安装(下载引擎源码+依赖,进度走 job)
  if (status.state === "not-installed" || status.state === "needs-setup") {
    return (
      <Center>
        <ServerCog className="mb-3 h-10 w-10 text-muted-foreground" aria-hidden />
        <h3 className="text-base font-medium text-foreground">ComfyUI 画布</h3>
        <p className="mb-4 max-w-md text-center text-sm text-muted-foreground">
          {status.state === "needs-setup"
            ? "引擎装了一半(上次安装中断),点下面继续安装即可接上。"
            : "还没安装 ComfyUI 引擎。安装只在你点击时开始(源码+依赖体积较大);装好即可使用完整画布与两千多个生态节点。"}
        </p>
        <Button data-comfy-canvas-install onClick={() => void installEngine()}>
          {status.state === "needs-setup" ? "继续安装" : "安装引擎"}
        </Button>
        <p className="mt-4 text-xs text-muted-foreground">
          安装位置/磁盘可在 设置 → 本地配置 → ComfyUI 引擎 → 存储位置 里自定义
        </p>
      </Center>
    );
  }

  // 已就绪未跑:启动(冷启动含 torch 加载,走 job)
  if (!running) {
    return (
      <Center>
        <PlayCircle className="mb-3 h-10 w-10 text-muted-foreground" aria-hidden />
        <h3 className="text-base font-medium text-foreground">引擎已就绪,未在运行</h3>
        <p className="mb-4 max-w-md text-center text-sm text-muted-foreground">
          启动需要加载模型运行时(最长两分钟);启动完成后这里就是完整的 ComfyUI 界面。
        </p>
        {isStartingService ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" data-comfy-canvas-starting>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            正在启动引擎…
          </div>
        ) : (
          <Button data-comfy-canvas-start onClick={() => void startService()}>
            启动引擎
          </Button>
        )}
      </Center>
    );
  }

  // 运行中:webview 加载引擎原生前端(独立进程)。
  // 09-10 用户裁定:状态条与功能按钮(存量迁移/刷新)整块退役——画布即全部,
  // 端口/说明不进布局;存量迁移入口仍在 ComfyCanvasSwap 头部条,刷新=重进页即重探。
  return (
    <div className="relative flex h-full w-full min-h-0 min-w-0 flex-col" data-comfy-canvas-live>
      <webview
        ref={attachWebview}
        src={src ?? "about:blank"}
        className="h-full w-full flex-1"
        // 独立进程渲染;禁弹窗(09-10 类型收紧:布尔字面量,React 会序列化为属性)
        allowpopups={false}
        data-comfy-canvas-webview
      />
    </div>
  );
}

function Center({ children, ...rest }: { children: React.ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center p-6" data-comfy-canvas-placeholder {...rest}>
      {children}
    </div>
  );
}
