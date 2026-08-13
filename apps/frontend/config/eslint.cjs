module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', 'out', 'release', '.cache', '.eslintrc.cjs', 'frontend/electron/aitoearn/vendor/aitoearn-core/**', '**/*.test.ts', '**/*.test.tsx', '**/__tests__/**'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    // Child 4 quality-gate: 三批规则已清零,从 warn 升级为 error(--max-warnings 0 门禁)
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    'no-console': ['error', { allow: ['warn', 'error'] }],
    'react-hooks/exhaustive-deps': 'error',
    'react-refresh/only-export-components': 'off',
    'no-empty': 'off',
    'no-constant-condition': ['error', { checkLoops: false }],
    'no-useless-escape': 'off',
  },
  // build 脚本/smoke 是 CLI,console 是其标准输出通道,豁免 no-console
  overrides: [
    {
      files: ['build/**/*.ts', 'build/**/*.mjs'],
      rules: { 'no-console': 'off' },
    },
  ],
};
