/**
 * 手册图片资产表(仅渲染层构建真正使用)。
 *
 * 从 manuals.ts 拆出的原因(09-15 打包瘦身):import.meta.glob(?url) 会让
 * 每个把本模块打进 bundle 的构建各发射一份图片资产。本模块被 lib/studio
 * 上下文构造器引用而进入主进程构建,out/main/chunks 曾因此重复拷贝 75 张
 * PNG 共 56MB(与 out/renderer 完全同内容)。主进程只消费手册文本,
 * preset.images 在主进程侧零消费(09-15 全树实证),故 electron-vite 的
 * main/preload 构建用别名把本文件替换为 manuals-images.main-stub.ts 空桩。
 */
export const visualImages = import.meta.glob([
  "../../assets/studio-manuals/art_skills/**/*.{png,jpg,jpeg,webp,gif,svg}",
], {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

export const directorImages = import.meta.glob("../../assets/studio-manuals/story_skills/**/*.{png,jpg,jpeg,webp,gif,svg}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
