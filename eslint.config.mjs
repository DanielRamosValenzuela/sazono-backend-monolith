import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const noProjectCommentsPlugin = {
  rules: {
    'no-project-comments': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow comments in project source files',
        },
        schema: [],
      },
      create(context) {
        const sourceCode = context.sourceCode;

        return {
          Program() {
            for (const comment of sourceCode.getAllComments()) {
              context.report({
                loc: comment.loc,
                message: 'Comments are not allowed in project source files.',
              });
            }
          },
        };
      },
    },
  },
};

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['src/**/*.ts', 'apps/**/*.ts', 'libs/**/*.ts', 'test/**/*.ts'],
    plugins: {
      project: noProjectCommentsPlugin,
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      'project/no-project-comments': 'error',
    },
  },
  {
    rules: {
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always'],
      'no-inline-comments': 'error',
      'no-warning-comments': [
        'warn',
        {
          terms: ['todo', 'fixme', 'xxx'],
          location: 'anywhere',
        },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
);
