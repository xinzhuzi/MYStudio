/**
 * 主进程/preload 构建专用空桩——electron-vite.config.ts 的 main/preload
 * resolve.alias 把 "@/lib/studio/manuals-images" 指到本文件(排在 "@" 通配
 * 别名之前,前缀匹配才会命中)。渲染层构建与本文件无关,仍用真图。
 * 为什么允许为空:主进程只消费手册文本,preset.images 在主进程侧零消费
 * (09-15 全树实证,详见 manuals-images.ts 头注)。
 */
export const visualImages: Record<string, string> = {};

export const directorImages: Record<string, string> = {};
