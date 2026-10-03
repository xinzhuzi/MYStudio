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
      // 旧门禁只 lint ts/tsx(--ext ts,tsx);flat 模式默认扫 js/mjs/cjs,显式排除保口径
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
      'frontend/electron/aitoearn/vendor/aitoearn-core/**',
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/__tests__/**',
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
];
