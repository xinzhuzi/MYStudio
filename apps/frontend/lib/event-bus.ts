/**
 * 全局事件总线 - 跨面板通信
 * 
 * 使用方式：
 *   发送：eventBus.emit('image:generated', { url, prompt, assetId })
 *   监听：eventBus.on('image:generated', handler)
 *   取消：eventBus.off('image:generated', handler)
 *   一次性：eventBus.once('image:generated', handler)
 */

// `never[]` keeps handlers contravariant for event-specific payloads while the
// bus remains intentionally string-keyed until an event map is introduced.
type EventHandler = (...args: never[]) => void;

class EventBus {
  private listeners = new Map<string, Set<EventHandler>>();

  on(event: string, handler: EventHandler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
    return () => this.off(event, handler);
  }

  once(event: string, handler: EventHandler) {
    const wrapper: EventHandler = (...args) => {
      this.off(event, wrapper);
      handler(...args);
    };
    return this.on(event, wrapper);
  }

  off(event: string, handler: EventHandler) {
    const listeners = this.listeners.get(event);
    if (!listeners) return;
    listeners.delete(handler);
    this.cleanupEmptyListeners(event, listeners);
  }

  private cleanupEmptyListeners(event: string, listeners: Set<EventHandler>) {
    if (
      listeners.size === 0
      && this.listeners.get(event) === listeners
      && !this.dispatchDepths.has(event)
    ) {
      this.listeners.delete(event);
    }
  }

  emit(event: string, ...args: unknown[]) {
    const listeners = this.listeners.get(event);
    if (!listeners) return;

    this.dispatchDepths.set(event, (this.dispatchDepths.get(event) ?? 0) + 1);
    try {
      listeners.forEach((handler) => {
        try { handler(...(args as never[])); } catch (e) { console.error(`[EventBus] Error in ${event}:`, e); }
      });
    } finally {
      const remainingDepth = this.dispatchDepths.get(event)! - 1;
      if (remainingDepth === 0) this.dispatchDepths.delete(event);
      else this.dispatchDepths.set(event, remainingDepth);
      this.cleanupEmptyListeners(event, listeners);
    }
  }

  /** 清除某事件的所有监听 */
  clear(event: string) {
    this.listeners.delete(event);
  }

  private dispatchDepths = new Map<string, number>();
}

export const eventBus = new EventBus();

/**
 * 已定义的事件类型（供参考，不强制）：
 * 
 * 'image:generated'     - 图片工作室生成完成 { url: string, prompt: string, sourceAssetId?: string }
 * 'image:saved'         - 图片已保存到素材 { assetId: string, filePath: string }
 * 'asset:updated'       - 素材数据更新 { id: string, type: string }
 * 'asset:deleted'       - 素材被删除 { id: string, type: string }
 * 'style:created'       - 新风格创建 { stylePath: string }
 * 'tab:switch'          - 切换面板 { tab: string, params?: any }
 */
