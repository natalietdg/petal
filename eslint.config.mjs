// Lint for correctness, not style: recommended JS + TypeScript rules and a few that catch real mistakes.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import { defineConfig } from 'eslint/config';

export default defineConfig(
  { ignores: ['out/**', 'dist/**', 'dist.noindex/**', 'node_modules/**', 'build/**', '.claude/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['src/main/**', 'src/dev/**', 'src/preload.ts', 'test/**', 'scripts/**', '*.config.*'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/renderer/**'],
    languageOptions: { globals: globals.browser },
  },
  {
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-console': ['error', { allow: ['error', 'warn'] }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      // `typeof import('./x')` is how a module's type is named; plain imports of types must say `type`.
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports', disallowTypeAnnotations: false }],
    },
  },
  {
    files: ['scripts/**'],
    rules: { 'no-console': 'off' }, // command-line scripts report on stdout
  },
);
