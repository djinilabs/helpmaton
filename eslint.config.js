import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import importPlugin from 'eslint-plugin-import'
import tailwindcss from 'eslint-plugin-tailwindcss'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', 'scripts/**', 'test-results/**', 'playwright-report/**', 'apps/widget/**'] },
  // Base configuration for all TypeScript files
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.node,
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        },
        tsconfigRootDir: __dirname,
        project: ['./tsconfig.json']
      }
    },
    plugins: {
      import: importPlugin
    },
    rules: {
      ...importPlugin.configs.recommended.rules,
      ...importPlugin.configs.typescript.rules,
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'complexity': ['error', 50],
      'import/order': ['error', {
        'groups': [
          'builtin',
          'external',
          'internal',
          'parent',
          'sibling',
          'index'
        ],
        'newlines-between': 'always',
        'alphabetize': {
          'order': 'asc',
          'caseInsensitive': true
        }
      }],
      'import/no-unresolved': 'off', // TypeScript handles this
      'import/no-cycle': 'error',
      'import/no-duplicates': 'error'
    }
  },
  // Frontend-specific configuration with React
  {
    files: ['apps/frontend/**/*.{ts,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      import: importPlugin,
      tailwindcss
    },
    settings: {
      react: {
        version: 'detect'
      },
      tailwindcss: {
        callees: ['classnames', 'clsx', 'cn', 'cva'],
        config: './apps/frontend/tailwind.config.js'
      }
    },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      ...reactRefresh.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // Tailwind CSS rules
      'tailwindcss/classnames-order': 'error',
      'tailwindcss/enforces-negative-arbitrary-values': 'error',
      'tailwindcss/enforces-shorthand': 'error',
      'tailwindcss/no-arbitrary-value': 'off', // Allow arbitrary values for flexibility
      'tailwindcss/no-custom-classname': 'off', // Allow custom classnames when needed
      'tailwindcss/no-contradicting-classname': 'error'
    }
  },
  {
    files: ['apps/frontend/src/pages/AgentDetail.tsx'],
    rules: {
      'complexity': 'off'
    }
  },
  // Configuration for backend - disable React rules
  {
    files: ['apps/backend/**/*.{ts,tsx}'],
    rules: {
      // Disable all React-related rules for backend
      'react/jsx-uses-react': 'off',
      'react/jsx-uses-vars': 'off',
      'react/jsx-no-undef': 'off',
      'react/jsx-no-unused-vars': 'off',
      'react/jsx-key': 'off',
      'react/jsx-no-duplicate-props': 'off',
      'react/jsx-no-target-blank': 'off',
      'react/jsx-no-comment-textnodes': 'off',
      'react/jsx-no-bind': 'off',
      'react/jsx-no-literals': 'off',
      'react/jsx-pascal-case': 'off',
      'react/jsx-sort-props': 'off',
      'react/jsx-wrap-multilines': 'off',
      'react/jsx-closing-bracket-location': 'off',
      'react/jsx-closing-tag-location': 'off',
      'react/jsx-curly-spacing': 'off',
      'react/jsx-equals-spacing': 'off',
      'react/jsx-first-prop-new-line': 'off',
      'react/jsx-indent': 'off',
      'react/jsx-indent-props': 'off',
      'react/jsx-max-props-per-line': 'off',
      'react/jsx-no-multi-spaces': 'off',
      'react/jsx-no-useless-fragment': 'off',
      'react/jsx-one-expression-per-line': 'off',
      'react/jsx-props-no-multi-spaces': 'off',
      'react/jsx-sort-default-props': 'off',
      'react/jsx-tag-spacing': 'off',
      'react/jsx-boolean-value': 'off',
      'react/jsx-curly-brace-presence': 'off',
      'react/jsx-fragments': 'off',
      'react/jsx-no-constructed-context-values': 'off',
      'react/jsx-no-script-url': 'off',
      'react/jsx-props-no-spreading': 'off',
      'react/no-array-index-key': 'off',
      'react/no-children-prop': 'off',
      'react/no-danger': 'off',
      'react/no-danger-with-children': 'off',
      'react/no-deprecated': 'off',
      'react/no-direct-mutation-state': 'off',
      'react/no-find-dom-node': 'off',
      'react/no-is-mounted': 'off',
      'react/no-render-return-value': 'off',
      'react/no-string-refs': 'off',
      'react/no-unescaped-entities': 'off',
      'react/no-unknown-property': 'off',
      'react/no-unsafe': 'off',
      'react/prefer-es6-class': 'off',
      'react/prefer-stateless-function': 'off',
      'react/require-render-return': 'off',
      'react/self-closing-comp': 'off',
      'react/sort-comp': 'off',
      'react/sort-prop-types': 'off',
      'react/style-prop-object': 'off',
      'react/void-dom-elements-no-children': 'off',
      'react/jsx-no-leaked-render': 'off',
      'react/jsx-no-new-object-as-prop': 'off',
      // Disable React Hooks rules
      'react-hooks/rules-of-hooks': 'off',
      'react-hooks/exhaustive-deps': 'off',
      // Disable React Refresh rules
      'react-refresh/only-export-components': 'off',
      // Enforce promise handling to prevent unawaited promises (critical for Lambda)
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['error', {
        checksConditionals: true,
        checksVoidReturn: true,
        checksSpreads: true
      }]
    }
  },
  // Configuration for test files - relax void return check for mocks
  {
    files: ['**/__tests__/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-misused-promises': ['error', {
        checksConditionals: true,
        checksVoidReturn: false, // Allow promises in mocks that expect void
        checksSpreads: true
      }]
    }
  }
)

