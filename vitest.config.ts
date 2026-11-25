/**
 * Page tests: every member screen is OPENED, with realistic data, in a test.
 *
 * Why (2026-11-25): a release crashed the program page for every program with
 * an unwritten week ("Cannot access before initialization"). The type check,
 * the build and every existing test passed — none of them ever rendered a
 * page. These tests render pages the way a member's browser does and fail on
 * any crash. Run: npm run test:pages
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['tests/pages/**/*.test.tsx'],
    setupFiles: ['tests/pages/setup.ts'],
    css: false,
    testTimeout: 20000,
  },
});
