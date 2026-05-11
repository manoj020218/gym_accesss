/**
 * Local dev entry point — no MongoDB install required, no Firebase credentials needed.
 * Run with:  pnpm dev:local   (from apps/api-server)
 *
 * What it does:
 *  - Starts an in-memory MongoDB (mongodb-memory-server)
 *  - Skips Firebase auth plugin
 *  - Exposes POST /api/v1/auth/dev-login → returns a JWT with owner role
 *  - Seeds: Dev Gym branch + 3 membership plans
 */

// ── Env vars MUST be set before any other import reads config ────────────────
// Use Object.assign so these override nothing if already set externally
Object.assign(process.env, {
  NODE_ENV:                 process.env['NODE_ENV']                 ?? 'development',
  DEV_SKIP_FIREBASE:        'true',
  PORT:                     process.env['PORT']                     ?? '8080',
  LOG_LEVEL:                process.env['LOG_LEVEL']                ?? 'info',
  JWT_SECRET:               process.env['JWT_SECRET']               ?? 'dev_jwt_secret_32chars_for_local_testing!!',
  JWT_EXPIRES_IN:           '24h',
  REFRESH_TOKEN_SECRET:     process.env['REFRESH_TOKEN_SECRET']     ?? 'dev_refresh_secret_32chars_local_testing!!',
  REFRESH_TOKEN_EXPIRES_IN: '30d',
  CORS_ORIGINS:             process.env['CORS_ORIGINS']             ?? 'http://localhost:5173',
  EDGE_SHARED_SECRET:       process.env['EDGE_SHARED_SECRET']       ?? 'dev_edge_hmac_16chars!!',
  // MongoMemoryServer reads these at instance creation time — must be set before import
  MONGOMS_STARTUP_TIMEOUT:  '120000',  // 120s — Windows first-run extraction is slow
  MONGOMS_DOWNLOAD_TIMEOUT: '120000',
});

// ── Start in-memory MongoDB ───────────────────────────────────────────────────
const { MongoMemoryServer, MongoBinary } = await import('mongodb-memory-server');

// Ensure the binary is downloaded before trying to start (first run on a fresh machine
// can take 30–90s to download ~80 MB on slow connections — start gives up after timeout
// if the binary isn't ready yet).
console.log('⏳  Checking MongoDB binary (downloading if first run)…');
try {
  await MongoBinary.getPath();
  console.log('✅  MongoDB binary ready');
} catch {
  console.error(
    '\n❌  MongoDB binary download failed.\n' +
    '    Check internet connectivity, then retry.\n' +
    '    Or set MONGODB_URI env var to point at a local MongoDB instance\n' +
    '    and run "pnpm dev" instead of "pnpm dev:local".\n',
  );
  process.exit(1);
}

const mongod   = await MongoMemoryServer.create();
const mongoUri = `${mongod.getUri()}edge_gym`;
process.env['MONGODB_URI'] = mongoUri;
console.log('🗄️  Memory MongoDB started →', mongoUri);

// ── Build and start the API app ───────────────────────────────────────────────
const { buildApp }    = await import('./app.js');
const { startWorker } = await import('./worker/index.js');

const app = await buildApp();

await app.listen({ port: Number(process.env['PORT']), host: '0.0.0.0' });
app.log.info(`⚡ DEV API listening on :${process.env['PORT']}`);
startWorker(app.log);

// ── Seed initial data ─────────────────────────────────────────────────────────
const { Branch }     = await import('./models/Branch.js');
const { User }       = await import('./models/User.js');
const { MemberPlan } = await import('./models/MemberPlan.js');
const { StaffRole, PlanType, PlanDurationUnit, Zone } = await import('@edge-gym/shared-types');

// Dev user (owner)
let devUser = await User.findOne({ email: 'dev@edgegym.local' });
if (!devUser) {
  devUser = await User.create({
    firebaseUid: 'dev-local-uid',
    email:       'dev@edgegym.local',
    displayName: 'Dev Owner',
    role:        StaffRole.Owner,
    branchIds:   [],
    isActive:    true,
    lastLoginAt: new Date(),
  });
}

// Dev branch
let devBranch = await Branch.findOne({ name: 'Dev Gym' });
if (!devBranch) {
  devBranch = await Branch.create({
    name:     'Dev Gym',
    address:  '123 Test Street, Dev City',
    phone:    '9999999999',
    timezone: 'Asia/Kolkata',
    isActive: true,
    ownerId:  devUser.id as string,
  });
  await User.findByIdAndUpdate(devUser.id, { branchIds: [devBranch.id as string] });
}

// Membership plans
const planCount = await MemberPlan.countDocuments({ branchId: devBranch.id as string });
if (planCount === 0) {
  await MemberPlan.insertMany([
    {
      name: 'Monthly Basic', planType: PlanType.Basic,
      durationValue: 1, durationUnit: PlanDurationUnit.Month,
      price: 1000, gstPercent: 18,
      allowedZones: [Zone.MainEntry, Zone.Cardio, Zone.WeightArea],
      features: ['Cardio area', 'Weight training'],
      isActive: true, branchId: devBranch.id,
    },
    {
      name: 'Quarterly Premium', planType: PlanType.Premium,
      durationValue: 3, durationUnit: PlanDurationUnit.Month,
      price: 2700, gstPercent: 18,
      allowedZones: [Zone.MainEntry, Zone.Cardio, Zone.WeightArea, Zone.PTRoom],
      features: ['Cardio', 'Weights', 'PT Room', '2 trainer sessions/month'],
      isActive: true, branchId: devBranch.id,
    },
    {
      name: 'Yearly Gold', planType: PlanType.Yearly,
      durationValue: 1, durationUnit: PlanDurationUnit.Year,
      price: 9000, gstPercent: 18,
      allowedZones: Object.values(Zone) as Zone[],
      features: ['Full access', 'Steam room', 'Unlimited PT sessions'],
      isActive: true, branchId: devBranch.id,
    },
  ]);
}

const branchId = devBranch.id as string;

console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║  DEV SERVER READY — memory MongoDB, no Firebase needed       ║');
console.log('╠══════════════════════════════════════════════════════════════╣');
console.log(`║  API      →  http://localhost:${process.env['PORT']}/api/v1                ║`);
console.log(`║  Branch   →  ${branchId}  ║`);
console.log('╠══════════════════════════════════════════════════════════════╣');
console.log('║  Login:  POST /api/v1/auth/dev-login  (no body needed)      ║');
console.log('║  Or open: http://localhost:5173  (web admin)                ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');
console.log(`COPY THIS BRANCH ID → ${branchId}\n`);
