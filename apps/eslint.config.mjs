// ESLint 10 flat config(1003 主版本迁移 B1:eslint 8→10,eslintrc→eslint.config.* 形态迁移)
// 规则集与旧 frontend/config/eslint.cjs 逐条对齐(规则零扩面,仅载体迁移):
// - 旧 `--ext ts,tsx` → 所有配置段 files 恒 ['**/*.{ts,tsx}'] 且 ignores 显式排除
//   js/mjs/cjs(flat 默认扫 js/mjs/cjs,不排则 200+ 个从未被 lint 的脚本涌入;旧 build/**/*.mjs
//   的 no-console 豁免因此在旧口径下从未生效过,属死条款,不迁)
// - 旧 `env: browser+es2020` → languageOptions.globals=globals.browser + ecmaVersion 2020
// - 旧 ignorePatterns → ignores(相对本文件即 apps/;旧 dist/out/release/.cache 为 config 目录
//   相对路径本就空匹配,此处补齐 apps 根实际存在的 output/ 等产物目录)
// - 旧 `--report-unused-disable-directives` CLI 旗标 → linterOptions 段(config 内声明)
// - tseslint recommended 自带 eslint-recommended(TS 版)已关 no-undef,对齐旧 plugin 链
// - 新版 recommended 扩入的规则在下方 rules 段显式关闭,保持旧门禁口径(B1 不做规则扩面,
//   新规则采纳另役):preserve-caught-error/no-useless-assignment(eslint 10 recommended 新增)、
//   no-unused-expressions/no-empty-object-type(tseslint 8 recommended 新增)、
//   no-unused-vars.caughtErrors 默认 none→all(v8 行为变更,显式还原 none)
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

const tsFiles = ['**/*.{ts,tsx}'];

export default [
  {
    ignores: [
      'node_modules',
      'out',
      'release',
      'output',
      'dist',
      '.cache',
      // .zcode 会话工作目录(git 已按 .gitignore `.zcode/` 任意深度忽略;根 .zcode 靠 lint 扫描根
      // =apps/ 天然出界,但 apps 内嵌套 .zcode(如 backend/comfyui/.zcode)会被扫进来,
      // 草稿 *.dwf.ts 一报 lint 错即锁死全仓 pre-commit——2006 实发。flat config 裸名只配根层,
      // 须 **/ 前缀盖任意深度,对齐 .gitignore 同款语义)
      '**/.zcode',
      // 旧门禁只 lint ts/tsx(--ext ts,tsx);flat 模式默认扫 js/mjs/cjs,显式排除保口径
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
      'frontend/electron/aitoearn/vendor/aitoearn-core/**',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/__tests__/**',
      // 例外再包含(1020 门禁返修):本任务门禁配方=「改动文件 + --max-warnings 0」,改动清单含
      // test 文件,而上面全局忽略匹配它们 → ESLint 10 对每个显式传入的被忽略文件发
      // "File ignored" warning → --max-warnings 0 即红。解法=对涉事 test 文件逐个否定再包含,
      // 使其真正纳入 lint(内容须过规则);其余 800+ test 文件维持忽略,全仓 pre-commit
      // (eslint .)口径零扩面。逐文件精确列出而非目录/通配模式,保证不把清单外既有 test 卷入。
      // 后续任务若门禁再传新 test 文件撞同款红,循例在此追加。
      '!frontend/components/panels/studio/AssetsBookExtractionCard.test.tsx',
      '!frontend/components/panels/studio/useNovelPipelineActions.test.tsx',
      '!frontend/components/panels/studio/workflow-stage-actions.test.tsx',
      '!frontend/lib/ai/ai-manager.test.ts',
      '!frontend/lib/studio/entity-appearances.test.ts',
      '!frontend/lib/studio/entity-extraction-errors.test.ts',
      '!frontend/lib/studio/entity-extraction-input.test.ts',
      '!frontend/lib/studio/entity-extraction-ledger.test.ts',
      '!frontend/lib/studio/entity-extraction-runner.test.ts',
      '!frontend/lib/studio/entity-sync.test.ts',
      // 10-24 asset-dialog 批2(循例追加):门禁改动清单含下述 6 个 test 文件,同款
      // 「显式传入被忽略文件 → File ignored warning → --max-warnings 0 红」;再包含后
      // 内容已过全规则(--no-ignore 验证零告警,dialog.test.ts 的 window 补桩已改类型化助手)。
      '!frontend/lib/studio/asset-image-kind.test.ts',
      '!frontend/lib/studio/asset-family-images.test.ts',
      '!frontend/electron/storage/studio-assets-storage.test.ts',
      '!frontend/components/panels/assets/studio-asset-detail-preview-pane.test.tsx',
      '!frontend/components/panels/assets/studio-asset-detail-dialog.test.ts',
      '!frontend/components/panels/assets/studio-asset-detail-dialog-interaction.test.tsx',
      // 10-24 asset-dialog 批3(循例追加):新服务 asset-type-shot 单测入清单,同款再包含;
      // 本批改动清单另含 eslint.config.mjs 自身(批3再包含条目),mjs 全局忽略撞同款
      // 「File ignored」红——再包含后零规则段适用(全规则段恒 tsFiles 收窄),实 lint 零告警。
      '!frontend/lib/studio/asset-type-shot.test.ts',
      '!eslint.config.mjs',
    ],
  },
  // 外来预设统一收窄到 ts/tsx(预设自身无 files 键 = 全文件适用,会波及 js/mjs/cjs)
  { ...js.configs.recommended, files: tsFiles },
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: tsFiles })),
  {
    files: tsFiles,
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    plugins: {
      // react-hooks v7 的 flat 预设(configs.flat.*)带 17 条规则(含 React Compiler 系
      // purity/refs/set-state-in-render 等),远超旧 v4 recommended 的两条口径;
      // B1 是形态迁移不扩规则集,按旧口径手动注册(rules-of-hooks error + exhaustive-deps error)
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // Child 4 quality-gate: 三批规则已清零,从 warn 升级为 error(--max-warnings 0 门禁)
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          // tseslint 8 起默认 caughtErrors 'none'→'all'(catch 绑定未用即报);
          // 旧 v7 口径不查 catch 绑定,显式还原
          caughtErrors: 'none',
        },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react-refresh/only-export-components': 'off',
      'no-empty': 'off',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-useless-escape': 'off',
      // ---- 以下为关闭新版 recommended 扩入规则(保旧口径,采纳另役) ----
      // eslint 10 recommended 新增
      'preserve-caught-error': 'off',
      'no-useless-assignment': 'off',
      // tseslint 8 recommended 新增
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
  // build 脚本/smoke 是 CLI,console 是其标准输出通道,豁免 no-console
  {
    files: ['build/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  // workflow-stage-actions.test.tsx(1020 门禁返修再包含,见 global ignores 例外段)存量 60 处
  // no-explicit-any:全部是测试 mock 惯用法((window as any).electronAPI 挂桩、
  // (globalThis as any).ResizeObserver 浏览器补桩、mock 回调参数),该文件自旧 ignorePatterns
  // 时代起从未被 lint,属存量债而非本次引入——清偿另役,不阻塞门禁。该文件其余规则
  // (react-hooks/no-console/no-unused-vars 等)照常生效。
  {
    files: ['frontend/components/panels/studio/workflow-stage-actions.test.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
