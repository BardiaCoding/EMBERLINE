import { readFileSync } from 'node:fs'
import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// Raw hex colours (#rgb, #rgba, #rrggbb, #rrggbbaa) are forbidden in source.
// Colours come from CSS variables in src/styles/tokens.css, or from the
// CVD-checked palettes in src/styles/palettes.ts (design.md section 11.8).
const HEX_COLOUR = '#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])'
const HEX_MESSAGE =
  'Raw hex colours are not allowed here. Use a token from src/styles/tokens.css or a palette from src/styles/palettes.ts.'

// Help sentences live only in src/lib/helpText.json (requirement 15.20, design.md section 11.4).
// A string or template literal that repeats the first words of any of them is an error, so a
// sentence cannot be pasted into a component. The selectors are built from the JSON file.
const HELP_PREFIX_WORDS = 6
const helpSentences = Object.values(
  JSON.parse(readFileSync(new URL('./src/lib/helpText.json', import.meta.url), 'utf8')),
)
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
const helpPrefixes = helpSentences.map((sentence) =>
  escapeRegex(sentence.split(/\s+/).slice(0, HELP_PREFIX_WORDS).join(' ')),
)
const HELP_MESSAGE =
  'Help sentences belong only in src/lib/helpText.json. Use helpText(key) or <InfoControl>.'
const helpSelectors = helpPrefixes.flatMap((prefix) => [
  { selector: `Literal[value=/${prefix}/]`, message: HELP_MESSAGE },
  { selector: `TemplateElement[value.raw=/${prefix}/]`, message: HELP_MESSAGE },
])

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', 'src/lib/api.types.ts'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked, prettier],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'no-restricted-syntax': [
        'error',
        {
          selector: `Literal[value=/${HEX_COLOUR}/]`,
          message: HEX_MESSAGE,
        },
        {
          selector: `TemplateElement[value.raw=/${HEX_COLOUR}/]`,
          message: HEX_MESSAGE,
        },
        ...helpSelectors,
      ],
    },
  },
  {
    // The only TypeScript file allowed to hold raw hex colours.
    files: ['src/styles/palettes.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // Node-side config files are not part of the TypeScript projects.
    files: ['**/*.js'],
    extends: [js.configs.recommended, prettier],
    languageOptions: { ecmaVersion: 2022, globals: globals.node },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
)
