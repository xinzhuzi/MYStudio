# 第三方来源声明

本文件记录 MYStudio 已吸收或明确参考的第三方项目边界。MYStudio 自身许可见仓库根目录的 `LICENSE` 与 `COMMERCIAL_LICENSE.md`。

## OpenCut

- 项目：`OpenCut-app/OpenCut`
- 核验提交：`bab8af831b354a0b5a98a4a6e818ab7d633b94df`
- 许可证：MIT
- 来源：https://github.com/OpenCut-app/OpenCut
- 使用边界：仅参考公开架构方向；当前未复制其源码、素材或运行时。MYStudio 的 `EditingProjectV1`、时间线编译器、Electron runtime、FFmpeg 构图、证据结构和 Daojie direct runner 均为本仓库原生 TypeScript/Electron 实现。

## OpenCut Classic

- 项目：`OpenCut-app/opencut-classic`
- 核验提交：`cf5e79e919144200294fb9fed22a222592a0aeea`
- 许可证：MIT
- 来源：https://github.com/OpenCut-app/opencut-classic
- 使用边界：参考时间线、编辑命令、字幕和预览的设计思想；MYStudio 使用原生 TypeScript/Electron/FFmpeg 实现，当前未复制其源码或素材，也未把 OpenCut 或 OpenCut Classic 加入自动成片运行时依赖。

OpenCut 的 MIT 许可证正文和免责声明：

- https://github.com/OpenCut-app/OpenCut/blob/bab8af831b354a0b5a98a4a6e818ab7d633b94df/LICENSE
- https://github.com/OpenCut-app/opencut-classic/blob/cf5e79e919144200294fb9fed22a222592a0aeea/LICENSE

如果后续版本复制或修改 OpenCut 的实质代码，将在本文件补充原版权声明、精确源文件与本地目标文件。未经逐项许可证核验的 OpenCut 字体、图片、贴纸和其他素材不会进入 MYStudio；LGPL-2.1 的 `soundtouchjs` 也不作为首期运行时依赖。
