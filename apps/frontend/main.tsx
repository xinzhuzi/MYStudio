// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
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
