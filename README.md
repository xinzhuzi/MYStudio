<div align="center">

<img src="./apps/frontend/assets/brand/manying-studio-icon.png" alt="漫影工作室" width="140" height="140" />

# 漫影工作室 · MYStudio

**本地优先的 AI 漫剧与短剧制作工作台**

从小说到成片，把剧本、分镜、素材、配音和剪辑放进同一条可追踪的工作流。

<p>
  <img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License: AGPL-3.0" />
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-lightgrey.svg" alt="Platform" />
  <img src="https://img.shields.io/badge/Electron-React%20%2B%20TypeScript-47848F.svg" alt="Electron" />
  <img src="https://img.shields.io/badge/AI-MLX%20%7C%20Qwen%20%7C%20SenseVoice-ff6f00.svg" alt="AI" />
</p>

[简体中文](./README.md) · [English](./docs/README.en.md) · [商业授权](./COMMERCIAL_LICENSE.md)

</div>

---

## 项目介绍

漫影工作室是一个面向 AI 漫剧、短剧和小说影视化创作的桌面生产工具，目标是把长文本改编、剧本整理、角色与场景资产、分镜生产、视频候选生成、本地剪辑合成和项目配置管理放在同一个可追踪的工作流中。

项目强调本地优先和创作过程可控：素材、项目数据和生成记录优先保存在用户本机；AI 生成结果以草稿、候选和可编辑数据的形式进入项目，而不是直接覆盖正式内容；本地视频合成通过 FFmpeg 完成，便于在桌面端快速生成可预览、可复查、可继续编辑的片段和成片。

### 核心定位

- 面向小说改编、AI 漫剧、短剧分镜和本地成片的统一工作台。
- 用结构化工作流承接从文本到视频的完整生产过程。
- 用项目级存储管理原文、剧本、分镜、素材、候选视频和配置。
- 用本地 FFmpeg 支撑图片/视频素材转候选片段和整集拼接。
- 用配置中心管理模型、供应商能力和不同任务的模型绑定。

### 生产链路

项目的核心链路是：

```text
小说/剧本导入 -> Skill 上下文 -> 剧本草稿 -> 分镜表 -> 生产 track -> 候选片段 -> 剪辑合成 -> 配置校验
```

这条链路适合分阶段推进：可以只做剧本和分镜，也可以继续绑定素材、生成候选片段，再通过本地合成得到完整视频。每个阶段都保留人工修订入口，便于在 AI 生成质量不稳定时继续保持创作者控制权。

### 架构特征

- 桌面端应用：基于 Electron 运行，适合管理本地素材、调用本机能力和输出文件。
- 前端工作台：使用 React 和 TypeScript 构建交互界面。
- 状态管理：使用 Zustand 管理项目工作流、素材、分镜、候选和配置状态。
- 文件型存储：面向个人创作项目，减少数据库部署和后端维护成本。
- 本地合成：Electron 主进程调用 FFmpeg，处理候选片段渲染、字幕烧录和拼接输出。

### 设计目标

- 让小说、剧本、分镜、素材和视频候选之间有清晰的引用关系。
- 让 AI 输出可审查、可回退、可替换，而不是一次性黑盒生成。
- 让短剧生产需要的角色、场景、音色、字幕和镜头状态逐步结构化。
- 让普通用户可以按工作流顺序完成成片，高级用户可以进入更细的分镜、剪辑和配置环节。
- 让后续扩展到 TTS、字幕样式、多轨导出、Agent/Skill 编排时，不破坏当前项目数据。

## 内置艺术风格

内置 **60 种**美术风格，覆盖 2D 动画、3D 渲染、定格动画和真人影像，分镜生产时一键套用。

<table>
  <tr>
    <td align="center" width="25%"><img src="./apps/frontend/assets/studio-manuals/art_skills/2d_ghibli/images/1.png" width="180" /><br/><sub><b>2D自然手绘动画</b></sub></td>
    <td align="center" width="25%"><img src="./apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/images/style_ref.png" width="180" /><br/><sub><b>水墨国风修仙</b></sub></td>
    <td align="center" width="25%"><img src="./apps/frontend/assets/studio-manuals/art_skills/3D_clay_stopmotion/images/1.png" width="180" /><br/><sub><b>定格动画黏土</b></sub></td>
    <td align="center" width="25%"><img src="./apps/frontend/assets/studio-manuals/art_skills/real_wuxia/images/1.png" width="180" /><br/><sub><b>真人复古武侠</b></sub></td>
  </tr>
</table>

👉 [查看全部 60 种艺术风格 →](./docs/art-styles.md)

## 当前入口

进入项目后打开左侧 `工作流`：

1. `小说` 导入 `.txt/.md` 或粘贴正文。
2. `Skill` 生成上下文包并保存人工工作数据。
3. `剧本` 保存剧本草稿。
4. `分镜` 维护 track、时长、素材路径和台词。
5. `剪辑` 用本地 FFmpeg 生成候选片段，选择后拼接成片。
6. `配置` 保存中转站、模型定义和任务绑定。

## 许可证

本项目采用双重许可模式：

- 社区版默认使用 [GNU Affero General Public License v3.0](./LICENSE)（AGPL-3.0）发布。
- 如果你修改、分发本项目，或基于本项目向网络用户提供服务，需要遵守 AGPL-3.0 的源代码开放、版权声明保留等要求。
- 如果你希望将本项目集成到闭源商业产品、闭源 SaaS 服务或不公开修改内容的商业场景中，需要获取商业许可。

商业授权、闭源使用和企业支持说明见 [COMMERCIAL_LICENSE.md](./COMMERCIAL_LICENSE.md)。

## 最低系统要求

本项目的 AI 能力（TTS 声音克隆、语音识别、图像/视频生成等）依赖本地模型推理，**必须配备独立显卡（GPU）**，集成显卡无法满足算力需求。

### macOS（Apple Silicon）

| 项目 | 最低要求 | 推荐配置 |
|------|---------|---------|
| 芯片 | **Apple Silicon M1**（自带 GPU） | M2 Pro / M3 及以上 |
| 系统 | macOS 13 Ventura | macOS 14 Sonoma+ |
| 统一内存 | 16 GB | 32 GB+ |
| 磁盘 | 20 GB 可用空间 | 50 GB+ SSD |

> ⚠️ **不支持 Intel 芯片的 Mac**（无 MLX GPU 加速）。

### Windows

| 项目 | 最低要求 | 推荐配置 |
|------|---------|---------|
| 系统 | Windows 10 64 位 | Windows 11 |
| 显卡 | **NVIDIA 独立显卡，8 GB 显存**（支持 CUDA） | NVIDIA RTX 系列，16 GB+ 显存 |
| 内存 | 16 GB | 32 GB+ |
| 磁盘 | 20 GB 可用空间 | 50 GB+ SSD |

> ⚠️ **必须 NVIDIA 独立显卡**。集成显卡（Intel UHD / AMD 核显）和无 CUDA 的显卡无法运行本地 AI 推理。

### 通用

- Node.js >= 18（推荐 LTS 最新版）
- Python 3.12（项目自带，无需手动安装）

## 开发环境配置

### 前置要求

- Node.js >= 18
- macOS (Apple Silicon) / Linux x86_64

### 一键配置

```bash
git clone https://github.com/xinzhuzi/MYStudio.git
cd MYStudio
bash apps/build/setup.sh
```

脚本会自动：
1. 下载 Python 3.12（python-build-standalone，项目专用，不影响系统）
2. 安装 Python 后端依赖（MLX、transformers 等）
3. 安装 Node.js 依赖

### 启动

```bash
cd apps && npm run dev
```

### 打包

```bash
cd apps && npm run build
```
