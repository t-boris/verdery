import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Repository lint policy.
 *
 * Module boundaries required by the architecture are enforced here rather than
 * by convention: a domain layer may not import infrastructure, and cross-module
 * imports must go through a module's `public.ts`.
 *
 * Source: architecture/backend-modular-monolith.md, section "5. Module Shape".
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.next/**',
      '**/generated/**',
      'apps/ios/**',
      'infrastructure/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  {
    files: ['services/*/src/modules/*/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['fastify', 'kysely', 'pg', 'firebase-admin', '@google-cloud/*'],
              message:
                'The domain layer must not import infrastructure. See architecture/backend-modular-monolith.md section 5.1.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['scripts/**/*.mjs', '*.mjs'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly' },
    },
  },

  prettier,
);
