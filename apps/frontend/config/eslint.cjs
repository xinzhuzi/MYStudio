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
    // Child 4 quality-gate: 分批打开规则(warn 级,给团队适应期)
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    'no-console': 'off',
    'react-hooks/exhaustive-deps': 'warn',
    'react-refresh/only-export-components': 'off',
    'no-empty': 'off',
    'no-constant-condition': ['error', { checkLoops: false }],
    'no-useless-escape': 'off',
  },
};
