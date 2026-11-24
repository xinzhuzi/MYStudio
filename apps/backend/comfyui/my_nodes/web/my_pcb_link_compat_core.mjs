// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * PCB 连线插件兼容垫片·纯逻辑(11-24,任务 11-24-comfyui-pcb-link-routing;design §三)。
 *
 * 为什么要有它:第三方纯前端插件 comfyui-pcb 在本仓两台机器的前端上有两处失灵——
 * ① 上游在画布**原型**上包 drawConnections,每帧调 beginFrame(扫节点框、升障碍物版本号);
 *    而 ComfyUI-MiniMaxH3-Easy 在画布**实例**上覆盖了 drawConnections,实例属性遮住原型方法,
 *    上游那一钩调不到 → 障碍物恒空、不随挪节点更新;
 * ② 上游按旧字段 graph._links 取连线表,现役前端已是 graph.links(LinkMap)
 *    → 端口侧车道分配、同对节点束线静默跳过。
 * 本件只补这两件事:
 * - 前置钩:包画布实例上的 drawConnections。首个「PCB 模式且图里有节点」的帧先探活
 *   (读 window.__pcb.stats().obstacles):插件自己的钩子够得着=此后永远直通;
 *   够不着=此后每帧在原函数之前补调一次 beginFrame(与上游原型层钩子同一时序、同一调用)。
 * - 走线期别名:包渲染器原型的 drawLink,只在这次调用期间让 graph._links 指向 graph.links,
 *   调用一结束即回到 undefined。**不挂图原型的全局别名**:引擎家现役 5 件扩展带读 _links 的
 *   分支,全局别名会让其中现在走不通的那几支突然起作用,波及面无法逐个验证。
 *
 * 纪律:
 * - 垫片自己的异常一律不外漏——漏进 drawConnections / drawLink,画布的渲染标志会卡死,
 *   整个会话不再重绘;原函数自己的返回值与异常原样透传(不吞、不改写)。
 * - 插件不在、没挂钩、接口对不上 = 零副作用。等插件挂钩不封顶(上游自己的轮询没有上限,
 *   画布晚出现的页面它照样会挂钩,垫片不能先睡);唯一的休眠终态=注册表模块取不到。
 *
 * 零依赖:页面里的东西(window.__pcb、app.canvas、注册表模块、告警)全部由 deps 注入,
 * 本件可被 node --test 直跑(测试 = my_pcb_link_compat.test.mjs);薄挂载 = my_pcb_link_compat.js。
 */

/** 画布实例层前置钩的标记(包装函数的自有属性)。 */
const FRAME_FLAG = "__myPcbLinkCompatShim";
/** 走线期别名包装的标记(挂在渲染器原型 drawLink 的包装函数上)。 */
const ROUTE_FLAG = "__myPcbLinkCompatRoute";
/** 上游按这个旧字段名读连线表(现役前端已改名 links)。 */
const LEGACY_LINKS = "_links";

/** warnOnce 的消息键(同一键只告警一次,由注入的 warnOnce 保证)。 */
const WARN_FRAME = "前置钩自身出错(已吞,不外漏)";
const WARN_BEGIN = "beginFrame 抛错(已吞,不外漏)";
const WARN_STATS = "探活读 stats 抛错(不下结论)";
const WARN_ROUTE = "走线期别名出错(已吞,不外漏)";
const WARN_REGISTRY = "注册表模块加载失败,本页休眠";
const WARN_ACTIVATE = "默认切到 PCB 失败(下次页面加载再试一次)";

/**
 * 默认切到 PCB 的判定(纯函数;design §3.6,按表序逐行判)。
 * @param input
 *   - activated          激活标记 My.PcbLinkMode.Activated 已为真
 *   - mode               当前连线模式(setting.get("Comfy.LinkRenderMode"))
 *   - defaultMode        出厂默认值(取不到时与 window.LiteGraph.SPLINE_LINK 比)
 *   - settingsAvailable  设置服务可用(app.extensionManager.setting 的 get/set 都是函数)
 * @returns {{ shouldActivate: boolean, reason: string }}
 *   reason ∈ already-activated | user-chose | settings-unavailable | first-run
 */
export function resolveDefaultMode(input) {
  const { activated, mode, defaultMode, settingsAvailable } = input ?? {};
  if (activated === true) return { shouldActivate: false, reason: "already-activated" };
  // 「用户手选过」用「连线模式仍等于出厂默认值」近似;比不出(任一侧未知)时同样不动。
  if (mode !== defaultMode) return { shouldActivate: false, reason: "user-chose" };
  if (settingsAvailable !== true) return { shouldActivate: false, reason: "settings-unavailable" };
  return { shouldActivate: true, reason: "first-run" };
}

/** 图里的节点数(上游 beginFrame 扫的就是 graph._nodes)。 */
function nodeCount(graph) {
  const nodes = graph?._nodes;
  return Array.isArray(nodes) ? nodes.length : 0;
}

/** 每帧绘制前补调 beginFrame;抛错只告警,绝不外漏(外漏=画布整个卡死)。 */
function safeBeginFrame(registry, canvas, warnOnce) {
  try {
    registry.beginFrame(canvas);
  } catch (error) {
    warnOnce(WARN_BEGIN, error);
  }
}

/** 探活:本帧我没补调;图里有节点而 obstacles 仍为 0 = 插件自己的钩子没被调到。 */
function probe(registry, warnOnce) {
  try {
    return registry.stats().obstacles > 0 ? "plugin" : "shim";
  } catch (error) {
    warnOnce(WARN_STATS, error);
    return "unknown";
  }
}

/**
 * 建一份垫片状态机(每个页面一份)。
 * @param deps 六样注入,见 design §3.3:
 *   getPcb()               读 window.__pcb;没有返回 null
 *   loadRegistry()         返回 Promise:动态 import("/extensions/comfyui-pcb/pathing/registry.js")
 *   warnOnce(msg, err)     同一 msg 只告警一次
 *   getCanvas()            当前画布对象(app.canvas),可能为 null
 *   getGraph()             当前图对象(app.canvas?.graph ?? app.graph),可能为 null;
 *                          前置钩与走线期别名都从画布自身取图(this.graph / canvas.graph,
 *                          与上游 routeFor 读的是同一个对象),本件现版不消费它
 *   activateDefaultMode()  返回 Promise<ActivationInfo>;不做默认切换时可不传
 * @returns {{ state, tick, canvasInfo, aliasInfo, activation }}
 *   state       可观察状态:{ phase, waitTicks, registry, liveByCanvas, depth, resolved,
 *               accessors, activation }
 *   tick()      async,返回当前 phase("waiting" | "ready" | "dormant");每调一次做一轮,全部幂等
 *   canvasInfo(canvas)  只读诊断:{ wrapped, live }
 *   aliasInfo(graph)    只读诊断:{ defined, resolved }
 *   activation()        只读诊断:{ activated, mode, defaultMode, reason }
 */
export function createPcbCompat(deps) {
  const state = {
    /** "waiting" | "ready" | "dormant" */
    phase: "waiting",
    /** 等插件挂钩已轮询的次数(调用方据 150 这个数放慢节拍;本件不封顶)。 */
    waitTicks: 0,
    /** 上游注册表模块(与插件自己 import 的是同一个模块实例)。 */
    registry: null,
    /** 画布 → 探活结论 "unknown" | "plugin" | "shim"。 */
    liveByCanvas: new WeakMap(),
    /** 走线期深度计数:仅在上游那次 drawLink 调用期间 > 0。 */
    depth: 0,
    /** 图 → 走线期是否确实取到了连线表。 */
    resolved: new WeakMap(),
    /** 已装走线期访问器的图对象(主图、各子图各一份)。 */
    accessors: new WeakSet(),
    /** 默认切换的结果;reason 另有 not-run(还没做)与 error(抛错)两个诊断值。 */
    activation: { activated: false, mode: null, defaultMode: null, reason: "not-run" },
  };

  /** 告警通道自身抛错也不外漏(它跑在绘制流程的 catch 里)。 */
  const warn = (msg, error) => {
    try {
      deps.warnOnce?.(msg, error);
    } catch {
      /* 告警失败静默:不得反噬绘制流程 */
    }
  };

  /**
   * 给画布实例上的 drawConnections 包一层前置钩(design §3.5)。
   * @returns {boolean} 本次是否新包了一层
   */
  function ensureFrameHook(canvas, registry, getPcb, warnOnce, liveByCanvas) {
    // 画布上没有「自有」drawConnections = 没有别的插件在实例层改写,插件自己的原型层钩子
    // 够得着:不动(再包一帧会调两次)。
    if (!canvas || !Object.prototype.hasOwnProperty.call(canvas, "drawConnections")) return false;
    const previous = canvas.drawConnections;
    if (typeof previous !== "function" || previous[FRAME_FLAG] === true) return false;
    // 注册表接口对不上(上游改了)=包了也补调不了,不包。
    if (typeof registry?.beginFrame !== "function") return false;

    const shim = function (ctx) {
      let active = false;
      try {
        const pcb = getPcb();
        active = Boolean(pcb && pcb.state?.patched === true && this.links_render_mode === pcb.PCB());
        // 探活结论=插件自己的钩子够不着:本帧由我补调(原函数之前,与上游原型层钩子同一时序)。
        if (active && liveByCanvas.get(this) === "shim") safeBeginFrame(registry, this, warnOnce);
      } catch (error) {
        warnOnce(WARN_FRAME, error);
      }
      const result = previous.apply(this, arguments);
      try {
        // 探活:本帧我没补调;图里有节点而 obstacles 仍为 0 = 插件自己的钩子没被调到。
        // 空图不下结论(空图的 obstacles 恒为 0,分不出死活),留到以后有节点的帧再判。
        if (active && liveByCanvas.get(this) === "unknown" && nodeCount(this.graph) > 0) {
          liveByCanvas.set(this, probe(registry, warnOnce));
        }
      } catch (error) {
        warnOnce(WARN_FRAME, error);
      }
      return result;
    };
    Object.defineProperty(shim, FRAME_FLAG, { value: true });
    try {
      canvas.drawConnections = shim;
    } catch (error) {
      warnOnce("装前置钩失败", error);
      return false;
    }
    liveByCanvas.set(canvas, "unknown");
    return true;
  }

  /**
   * 在图对象上装走线期访问器(自有访问器,不碰原型链)。
   * @returns {boolean} 本件的访问器是否已就位(现在装的,或此前装过)
   */
  function installAccessor(graph) {
    if (state.accessors.has(graph)) return true;
    // 图上已有别的代码留下的自有 _links:不装、不盖。
    if (Object.prototype.hasOwnProperty.call(graph, LEGACY_LINKS)) return false;
    if (typeof graph.links?.get !== "function") return false;
    Object.defineProperty(graph, LEGACY_LINKS, {
      configurable: true,
      get() {
        return state.depth > 0 ? this.links : undefined;
      },
    });
    state.accessors.add(graph);
    return true;
  }

  /**
   * 给渲染器原型的 drawLink 包一层走线期别名(design §3.4)。
   * 目的只有一个:让上游的 routeFor 与 laneStub(读 graph._links?.get?.(id))在算走线时
   * 拿得到连线表;其余时间、其余代码一律看不到 _links。
   * @returns {boolean} 本次是否新包了一层
   */
  function ensureRouteAlias(canvas, getPcb, state) {
    const renderer = canvas?.linkRenderer?.pathRenderer;
    const proto = renderer ? Object.getPrototypeOf(renderer) : null;
    if (!proto) return false;
    const previous = proto.drawLink;
    // 原型上的 drawLink 已带本模块标记 = 已包过,不重复包(此时它里面已是上游包过的函数)。
    // 原型上的 drawLink 可能被别的代码再包一层;本包装只认自己的标记,不做别的假设。
    if (typeof previous !== "function" || previous[ROUTE_FLAG] === true) return false;

    const shim = function (ctx, linkData, context) {
      let graph = null;
      let scoped = false;
      try {
        // 上游 routeFor 用的是 app.canvas 与它的 graph,这里取同一个对象。
        const current = getPcb() && deps.getCanvas();
        graph = current?.graph ?? null;
        const active = graph && current.links_render_mode === getPcb().PCB();
        if (active && installAccessor(graph)) {
          scoped = true;
          state.depth++;
        }
      } catch (error) {
        warn(WARN_ROUTE, error);
      }
      try {
        return previous.apply(this, arguments);
      } finally {
        if (scoped) {
          let tableSeen = false;
          try {
            tableSeen = graph._links === graph.links;
          } catch (error) {
            warn(WARN_ROUTE, error);
          }
          // 先读后减:深度一减回去,访问器就返回 undefined 了。
          state.depth--;
          state.resolved.set(graph, tableSeen);
        }
      }
    };
    Object.defineProperty(shim, ROUTE_FLAG, { value: true });
    try {
      proto.drawLink = shim;
    } catch (error) {
      warn("装走线期别名失败", error);
      return false;
    }
    return true;
  }

  /** 一轮检查,全部幂等;返回当前 phase。 */
  async function tick() {
    // 休眠是页面生命期内的终态:本页不再动。
    if (state.phase === "dormant") return state.phase;
    // 1. 等插件挂钩。不封顶:节拍由调用方按 waitTicks 放慢,这里只计数。
    const pcb = deps.getPcb();
    if (!pcb || pcb.state?.patched !== true) {
      state.waitTicks++;
      return state.phase;
    }
    // 2. 取注册表模块(仅第一次);取不到=本页休眠。
    if (!state.registry) {
      try {
        state.registry = await deps.loadRegistry();
      } catch (error) {
        warn(WARN_REGISTRY, error);
        state.phase = "dormant";
        return state.phase;
      }
    }
    // 3. 装前置钩 4. 装走线期别名(对当前画布;已处理过的原样返回,画布换新对象时在这里补上)。
    ensureFrameHook(deps.getCanvas(), state.registry, deps.getPcb, warn, state.liveByCanvas);
    ensureRouteAlias(deps.getCanvas(), deps.getPcb, state);
    // 5. 默认模式:仅第一次到 ready 时做一次。
    const firstReady = state.phase !== "ready";
    state.phase = "ready";
    if (firstReady && typeof deps.activateDefaultMode === "function") {
      try {
        state.activation = await deps.activateDefaultMode();
      } catch (error) {
        // 不重试到死:下一次页面加载会再试一次。
        warn(WARN_ACTIVATE, error);
        state.activation = { activated: false, mode: null, defaultMode: null, reason: "error" };
      }
    }
    return state.phase;
  }

  return {
    state,
    tick,
    /** 只读诊断:wrapped=该画布实例层的前置钩是本件包的;live=探活结论。 */
    canvasInfo(canvas) {
      const present = Boolean(canvas) && Object.prototype.hasOwnProperty.call(canvas, "drawConnections");
      return {
        wrapped: present && canvas.drawConnections?.[FRAME_FLAG] === true,
        live: (Boolean(canvas) && state.liveByCanvas.get(canvas)) || "unknown",
      };
    },
    /** 只读诊断:defined=该图上已装走线期访问器;resolved=走线期确实取到了连线表。 */
    aliasInfo(graph) {
      return {
        defined: Boolean(graph) && state.accessors.has(graph),
        resolved: Boolean(graph) && state.resolved.get(graph) === true,
      };
    },
    /** 只读诊断:默认切换的结果(副本)。 */
    activation() {
      return { ...state.activation };
    },
  };
}
