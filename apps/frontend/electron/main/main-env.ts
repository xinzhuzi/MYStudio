/**
 * main.ts 环境常量族(assembly 专批外迁,体逐字保留)——dev server 地址/
 * 构建输出目录/渲染器入口/后台 smoke 开关。main.ts 仍持有 process.env 副作用。
 */
import path from 'node:path'

export const VITE_DEV_SERVER_URL = process.env['ELECTRON_RENDERER_URL'] || process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(__dirname)
export const RENDERER_DIST = path.join(__dirname, '../renderer')
export const RENDERER_INDEX_HTML = path.join('renderer', 'index.html')
export const isBackgroundSmoke = process.env.MYSTUDIO_SMOKE_BACKGROUND === '1'
