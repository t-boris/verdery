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

  // Build scripts and tool configuration files sit outside the TypeScript
  // projects on purpose: they are executed by Node directly and are not part of
  // any package's compiled output. Type-aware rules therefore cannot apply.
  {
    files: ['**/*.mjs', '**/*.cjs', '**/*.config.ts', '**/*.config.mts'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      parserOptions: { projectService: false, project: false },
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
  },

  prettier,
);
