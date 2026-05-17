import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals:     true,
    environment: 'node',
    testTimeout: 30_000,
    env: {
      NODE_ENV:               'test',
      EDGE_DEVICE_ID:         'test-device-001',
      EDGE_BRANCH_ID:         'test-branch-001',
      EDGE_PORT:              '0',
      EDGE_SYNC_BASE_URL:     'http://localhost:9999',
      EDGE_SHARED_SECRET:     'test-shared-secret-16chars!',
      EDGE_SQLITE_PATH:       ':memory:',
      EDGE_SYNC_INTERVAL_MS:  '999999',
      EDGE_HEARTBEAT_INTERVAL_MS: '999999',
    },
  },
});
