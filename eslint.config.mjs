import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['dist/**', 'www/**', 'android/**', 'node_modules/**', '.next/**', 'test-results/**']),
  ...tseslint.configs.recommended,
]);
