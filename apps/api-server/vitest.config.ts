import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals:     true,
    environment: 'node',
    testTimeout: 60_000,
    // Set all env vars before config.ts is imported — must come before module load
    env: {
      MONGOMS_STARTUP_TIMEOUT:   '120000',
      MONGOMS_DOWNLOAD_TIMEOUT:  '120000',
      NODE_ENV:                  'test',
      PORT:                      '0',
      LOG_LEVEL:                 'silent',
      MONGODB_URI:               'mongodb://127.0.0.1:27017/placeholder',
      JWT_SECRET:                'test-jwt-secret-minimum-32-characters!ok',
      JWT_EXPIRES_IN:            '15m',
      REFRESH_TOKEN_SECRET:      'test-refresh-token-secret-min32chars!ok',
      REFRESH_TOKEN_EXPIRES_IN:  '30d',
      CORS_ORIGINS:              'http://localhost:3000',
      FIREBASE_PROJECT_ID:       'test-project-id',
      FIREBASE_CLIENT_EMAIL:     'firebase@test-project.iam.gserviceaccount.com',
      FIREBASE_PRIVATE_KEY:      'test-private-key-placeholder',
      EDGE_SHARED_SECRET:        'test-shared-secret-16chars!',
    },
  },
});
