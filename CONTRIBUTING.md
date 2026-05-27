# 贡献指南 | Contributing Guide

感谢你对 **漫影工作室 (Manying Studio)** 的关注！欢迎任何形式的贡献。

## 开发环境

### 前置要求

- **Node.js** >= 18
- **npm** >= 9（或 pnpm >= 8）
- **Git**

### 快速开始

```bash
# 克隆仓库
git clone https://github.com/zhengbingjin/MYStudio.git
cd MYStudio

# 安装依赖
npm install

# 启动开发模式
npm run dev
```

### 项目结构

```
manying-studio/
├── src/
│   ├── electron/      # Electron 主进程 + Preload
│   ├── components/    # React UI 组件
│   ├── stores/        # Zustand 状态管理
│   ├── lib/           # 工具库和业务逻辑
│   ├── packages/      # 内部包 (@opencut/ai-core)
│   ├── scripts/       # 构建和工具脚本
│   ├── config/        # 构建、打包和工具配置
│   ├── renderer/      # Renderer HTML 入口
│   ├── assets/brand/  # 品牌 Logo 与应用图标
│   └── types/         # TypeScript 类型定义
```

### 构建

```bash
# 编译项目
npm run build

# 仅编译（不打包安装程序）
npx electron-vite build
```

## 贡献流程

1. **Fork** 本仓库
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 提交代码：`git commit -m 'feat: add some feature'`
4. 推送分支：`git push origin feature/your-feature`
5. 提交 **Pull Request**

### Commit 规范

请使用 [Conventional Commits](https://www.conventionalcommits.org/) 格式：

- `feat:` 新功能
- `fix:` Bug 修复
- `docs:` 文档更新
- `refactor:` 代码重构
- `style:` 代码格式（不影响逻辑）
- `perf:` 性能优化
- `test:` 测试相关
- `chore:` 构建/工具变更

### 代码风格

- 使用 TypeScript 严格模式
- React 组件使用函数式组件 + Hooks
- 使用 Tailwind CSS 进行样式开发
- 中文注释优先，公共 API 使用英文

## 贡献者许可协议 (CLA)

提交 Pull Request 即表示你同意：

1. 你拥有所提交代码的版权或有权提交
2. 你授权项目维护者将你的贡献纳入 AGPL-3.0 开源版本和商业许可版本
3. 你的贡献将以 AGPL-3.0 许可证发布

这确保项目维护者可以持续维护双重许可模式。

## 问题反馈

- 🐛 Bug 报告：[GitHub Issues](https://github.com/zhengbingjin/MYStudio/issues)
- 💡 功能建议：[GitHub Issues](https://github.com/zhengbingjin/MYStudio/issues)
- 💬 讨论交流：[GitHub Discussions](https://github.com/zhengbingjin/MYStudio/discussions)

## 行为准则

请阅读并遵守我们的 [行为准则](CODE_OF_CONDUCT.md)。
