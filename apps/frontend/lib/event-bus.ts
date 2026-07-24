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
    this.listeners.get(event)?.delete(handler);
  }

  emit(event: string, ...args: unknown[]) {
    this.listeners.get(event)?.forEach((handler) => {
      try { handler(...(args as never[])); } catch (e) { console.error(`[EventBus] Error in ${event}:`, e); }
    });
  }

  /** 清除某事件的所有监听 */
  clear(event: string) {
    this.listeners.delete(event);
  }
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
