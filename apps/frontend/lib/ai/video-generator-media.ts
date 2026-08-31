import { saveVideoToLocal } from "@/lib/media/image-storage";

/**
 * 视频生成媒体工具——本地保存/末帧抽取/Grok 宽高比。file-size-reduction P2 拆出,体逐字保留。
 */

// Save video to local and return the local URL
export async function saveVideoLocally(videoUrl: string, sceneId: number): Promise<string> {
  try {
    const filename = `scene_${sceneId + 1}_${Date.now()}.mp4`;
    const localUrl = await saveVideoToLocal(videoUrl, filename);
    return localUrl;
  } catch (e) {
    console.warn('[VideoGen] Failed to save video locally, using URL:', e);
    return videoUrl;
  }
}

/**
 * Extract the last frame from a video URL as base64 image
 * Uses video element + canvas for frame extraction
 * @param videoUrl - Video URL (HTTP or local)
 * @param seekOffset - Seconds before end to extract (default 0.1s from end)
 * @returns Base64 data URL of the frame, or null on failure
 */
export async function extractLastFrameFromVideo(
  videoUrl: string,
  seekOffset: number = 0.1
): Promise<string | null> {
  // local-image:// 是 Electron 注册的自定义协议，可以直接使用
  // 不需要转换为 file://
  const resolvedUrl = videoUrl;
  
  return new Promise((resolve) => {
    const video = document.createElement('video');
    // local-image:// 是受信任的协议，不需要 crossOrigin
    if (!resolvedUrl.startsWith('local-image://') && !resolvedUrl.startsWith('file://')) {
      video.crossOrigin = 'anonymous';
    }
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    
    let hasResolved = false;
    let targetTime = -1; // -1 表示还未设置
    let isSeekStarted = false;
    
    const cleanup = () => {
      video.onloadedmetadata = null;
      video.onloadeddata = null;
      video.oncanplaythrough = null;
      video.onseeked = null;
      video.onerror = null;
      video.ontimeupdate = null;
      video.pause();
      video.src = '';
      video.load();
    };
    
    const timeoutId = setTimeout(() => {
      if (!hasResolved) {
        hasResolved = true;
        console.warn('[VideoGen] extractLastFrameFromVideo timeout');
        cleanup();
        resolve(null);
      }
    }, 30000); // 30s timeout
    
    const captureFrame = () => {
      if (hasResolved) return;
      
      // 确保视频尺寸有效
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        console.warn('[VideoGen] Video dimensions not ready, waiting...');
        setTimeout(captureFrame, 100);
        return;
      }
      
      try {
        video.pause();
        
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          console.warn('[VideoGen] Cannot get canvas context');
          hasResolved = true;
          clearTimeout(timeoutId);
          cleanup();
          resolve(null);
          return;
        }
        
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        
        
        hasResolved = true;
        clearTimeout(timeoutId);
        cleanup();
        resolve(dataUrl);
      } catch (e) {
        console.warn('[VideoGen] Failed to extract frame:', e);
        hasResolved = true;
        clearTimeout(timeoutId);
        cleanup();
        resolve(null);
      }
    };
    
    // 开始 seek 的函数
    const startSeek = () => {
      if (hasResolved || isSeekStarted) return;
      
      const duration = video.duration;
      if (!duration || duration <= 0 || !isFinite(duration)) {
        console.warn('[VideoGen] Invalid video duration:', duration);
        return;
      }
      
      isSeekStarted = true;
      targetTime = Math.max(0.1, duration - seekOffset);
      
      video.currentTime = targetTime;
    };
    
    // 方法：使用 timeupdate 监听播放进度，当接近目标时间时捕获
    video.ontimeupdate = () => {
      if (hasResolved || targetTime < 0) return; // 未开始 seek 时忽略
      
      // 当播放到目标时间附近时捕获帧
      if (video.currentTime >= targetTime - 0.05) {
        captureFrame();
      }
    };
    
    // 当 seek 完成时捕获
    video.onseeked = () => {
      if (hasResolved || targetTime < 0) return;
      
      // 检查是否真的 seek 到了目标位置
      if (Math.abs(video.currentTime - targetTime) < 0.5) {
        // seek 成功，等待一下再捕获
        setTimeout(captureFrame, 200);
      } else {
        // seek 可能失败，尝试播放到目标位置
        video.playbackRate = 16; // 快速播放
        video.play().catch(() => {
          // 如果播放失败，直接捕获当前帧
          console.warn('[VideoGen] Play failed, capturing current frame');
          captureFrame();
        });
      }
    };
    
    // 当视频数据加载完成时尝试 seek
    video.onloadeddata = () => {
      if (hasResolved) return;
      startSeek();
    };
    
    // 当可以播放时也尝试 seek（备选）
    video.oncanplaythrough = () => {
      if (hasResolved) return;
      startSeek();
    };
    
    video.onerror = (e) => {
      if (!hasResolved) {
        hasResolved = true;
        console.warn('[VideoGen] Video load error:', e);
        clearTimeout(timeoutId);
        cleanup();
        resolve(null);
      }
    };
    
    video.src = resolvedUrl;
    video.load();
  });
}

// ==================== 聚鑫API Grok Video Generation ====================

/**
 * Convert aspect ratio to Grok format
 */
export function toGrokAspectRatio(aspectRatio: string): string {
  // Grok supports: 2:3, 3:2, 1:1
  if (aspectRatio === '9:16' || aspectRatio === '3:4') return '2:3';
  if (aspectRatio === '1:1') return '1:1';
  // 16:9, 4:3, 21:9 → 3:2 (closest landscape)
  return '3:2';
}

/**
 * Call JuxinAPI (Grok) video generation API
 * API Documentation: https://juxinapi.apifox.cn/doc-7302525
 * 
 * Create video: POST /v1/video/create
 * Query task: GET /v1/video/query?id={taskId}
 */
