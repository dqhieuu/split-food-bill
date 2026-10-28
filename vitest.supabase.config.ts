import { defineConfig } from 'vitest/config';
export default defineConfig({
	test: { include: ['tests/integration/supabase-store.test.ts'], fileParallelism: false, testTimeout: 15000 }
});
