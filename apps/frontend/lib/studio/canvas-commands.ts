/**
 * 画布指令层契约(08-31-canvas-ops-layer,从零命名、零外部代码抄写):
 * 「能对画布做什么」的类型化单一入口——自动化测试与未来 agent 驱动
 * 复用同一通道,替代 CDP 摸 DOM。与节点注册表(canvas-node-registry,
 * 「画布上有什么」)合成 Phase 2 内核骨架。
 *
 * lib 层只持契约与分发总线(纯 TS 状态,零 React);执行器在各画布面
 * hook 中注册,路由到既有 store actions——不改任何现有行为,只加通道。
 */

export type CanvasCommandSurface = "image-workflow" | "production-flow" | "image-studio";

export interface CanvasNodePatch {
  title?: string;
  position?: { x: number; y: number };
  /** 提示词正文(二期透传:面板/agent 写提示词不再绕 ops 直改 store) */
  prompt?: string;
}

export type CanvasCommand =
  | {
      kind: "add-node";
      surface: CanvasCommandSurface;
      nodeType: string;
      /** 可选:创建后自动连线(拖出手柄语义,见 connect-create 域规则) */
      connectFrom?: { nodeId: string; handleType: "source" | "target" };
    }
  | { kind: "update-node"; surface: CanvasCommandSurface; nodeId: string; patch: CanvasNodePatch }
  | { kind: "remove-node"; surface: CanvasCommandSurface; nodeId: string }
  | { kind: "connect"; surface: CanvasCommandSurface; source: string; target: string }
  | { kind: "disconnect"; surface: CanvasCommandSurface; edgeId: string }
  | { kind: "select"; surface: CanvasCommandSurface; nodeId: string | null }
  | {
      kind: "set-viewport";
      surface: CanvasCommandSurface;
      viewport: { x: number; y: number; zoom: number };
    }
  | {
      kind: "trigger-node-action";
      surface: CanvasCommandSurface;
      nodeId: string;
      action: string;
    }
  | {
      kind: "restore-generation";
      surface: CanvasCommandSurface;
      /** 复原一条生成记录当时的画布效果:参考图×N+提示词(含反向)+成图+连线 */
      prompt: string;
      negativePrompt?: string;
      model?: string;
      aspectRatio?: string;
      references?: string[];
      result: { imageUrl: string; mediaId?: string };
      batchImageUrls?: string[];
      /** 记录的成图时间,回填节点 generatedAt 保持时序忠实 */
      generatedAt?: number;
    };

export interface CanvasCommandOk {
  ok: true;
  /** 新建节点 id(add-node)等回执;建组时附 promptNodeId(组内提示词节点) */
  detail?: { nodeId?: string; edgeId?: string; promptNodeId?: string };
}

export interface CanvasCommandFailure {
  ok: false;
  reason: string;
}

export type CanvasCommandResult = CanvasCommandOk | CanvasCommandFailure;

export type CanvasCommandDispatcher = (command: CanvasCommand) => CanvasCommandResult;

/**
 * 中间件锚点(R5 未来挂点:撤销埋点/agent 权限围栏/审计)。
 * 本任务只提供接口与组装,不实现任何具体中间件。
 */
export type CanvasCommandMiddleware = (
  command: CanvasCommand,
  next: CanvasCommandDispatcher,
) => CanvasCommandResult;

const dispatchers = new Map<CanvasCommandSurface, CanvasCommandDispatcher>();
const middlewares: CanvasCommandMiddleware[] = [];

/** 画布面挂载时注册执行器;返回注销函数(useEffect cleanup 用) */
export function registerCanvasDispatcher(
  surface: CanvasCommandSurface,
  dispatcher: CanvasCommandDispatcher,
): () => void {
  dispatchers.set(surface, dispatcher);
  return () => {
    if (dispatchers.get(surface) === dispatcher) dispatchers.delete(surface);
  };
}

export function addCanvasCommandMiddleware(middleware: CanvasCommandMiddleware): () => void {
  middlewares.push(middleware);
  return () => {
    const index = middlewares.indexOf(middleware);
    if (index >= 0) middlewares.splice(index, 1);
  };
}

/** 统一入口:发指令+拿类型化结果(供测试断言/未来 agent 桥) */
export function dispatchCanvasCommand(
  surface: CanvasCommandSurface,
  command: CanvasCommand,
): CanvasCommandResult {
  if (command.surface !== surface) {
    return { ok: false, reason: `command surface ${command.surface} 与入口 ${surface} 不一致` };
  }
  const dispatcher = dispatchers.get(surface);
  if (!dispatcher) {
    return { ok: false, reason: `画布面 ${surface} 未挂载(执行器未注册)` };
  }
  const terminate: CanvasCommandDispatcher = (cmd) => dispatcher(cmd);
  const composed = middlewares.reduceRight<CanvasCommandDispatcher>(
    (next, middleware) => (cmd) => middleware(cmd, next),
    terminate,
  );
  return composed(command);
}

/** 供测试隔离:清空全部注册(仅测试用) */
export function __resetCanvasCommandBusForTests(): void {
  dispatchers.clear();
  middlewares.length = 0;
}
