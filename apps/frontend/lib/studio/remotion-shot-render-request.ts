/**
 * 单镜生产请求:逐镜 Remotion 队列卡片按钮 → 视图模型监听 →
 * handleRunChapterAutoVideo({ onlyStoryboardIds: [shotId] })。
 *
 * 走 DOM 事件而非 props 钻取:队列卡片在节点预览深层,事件解耦让按钮
 * 无需节点画布→生产节点→预览层层传回调。
 */
export const REMOTION_SHOT_RENDER_REQUEST_EVENT = "studio:remotion-shot-render-request";

export interface RemotionShotRenderRequestDetail {
  shotId: string;
}

export function dispatchRemotionShotRenderRequest(shotId: string): void {
  window.dispatchEvent(
    new CustomEvent<RemotionShotRenderRequestDetail>(REMOTION_SHOT_RENDER_REQUEST_EVENT, {
      detail: { shotId },
    }),
  );
}

export function subscribeRemotionShotRenderRequest(
  handler: (detail: RemotionShotRenderRequestDetail) => void,
): () => void {
  const listener = (event: Event) => {
    handler((event as CustomEvent<RemotionShotRenderRequestDetail>).detail);
  };
  window.addEventListener(REMOTION_SHOT_RENDER_REQUEST_EVENT, listener);
  return () => window.removeEventListener(REMOTION_SHOT_RENDER_REQUEST_EVENT, listener);
}
