// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
// C1③ leveldb 明文物理清除:必须**首位** import——ESM 按导入序求值,本模块体
// (拍1 同步回写)须先于下方 React/App 及其引带的一切 store 模块执行。
import './lib/storage/local-storage-purge-restore.ts'
// 字体本地化(10-26 用户令,根治断网/代理抽风时 Google Fonts 拉取失败导致的
// smoke 假红/离线丢字体):原 renderer/index.html 引 fonts.googleapis.com 三款
// =Cormorant Garamond 300/400/600+400italic、JetBrains Mono 300/400/500、
// Noto Serif SC 300/400/600(900 已由 RenderingSettingsTab 注册)。此处同款
// 同字重改走 @fontsource 本地 woff2(分包内置,OFL 开源可随包分发),观感零
// 变化;CSP 同步收紧(csp-plugin.ts)。
import '@fontsource/cormorant-garamond/300.css'
import '@fontsource/cormorant-garamond/400.css'
import '@fontsource/cormorant-garamond/600.css'
import '@fontsource/cormorant-garamond/400-italic.css'
import '@fontsource/jetbrains-mono/300.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/noto-serif-sc/300.css'
import '@fontsource/noto-serif-sc/400.css'
import '@fontsource/noto-serif-sc/600.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { AppErrorBoundary } from './components/AppErrorBoundary.tsx'
import { installComfyCloudRelayExecutor } from './lib/assist/image-studio/comfy-cloud-relay-executor.ts'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
)

// 漫影云中继执行面(09-10 云端收编):引擎「漫影 云端生图」节点经 main 中继
// 转进渲染层,由 lib/ai 云链单源执行;装在启动期=与画布 tab 在不在场无关。
installComfyCloudRelayExecutor()

if (window.appEvents) {
  window.appEvents.onMainProcessMessage((_message) => {
  })
}
