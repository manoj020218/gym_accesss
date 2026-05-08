import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from '../helpers/build-test-app.js';
import { startMongo, stopMongo, clearMongo } from '../helpers/mongo.js';
import {
  ownerToken, managerToken, receptionistToken,
  otherBranchManagerToken, TEST_BRANCH_ID,
} from '../helpers/tokens.js';

let app: FastifyInstance;

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  await startMongo();
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
  await stopMongo();
});

beforeEach(async () => {
  await clearMongo();
});

describe('Authentication guard', () => {
  it('returns 401 with no token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/members' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with a tampered token', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/members',
      headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.garbage.signature' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('Branch CRUD — owner-only mutations', () => {
  const branchPayload = {
    name: 'Test Branch', address: '1 Main St', phone: '9876543210',
  };

  it('owner can create a branch', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/branches',
      headers: auth(ownerToken),
      payload: branchPayload,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<{ name: string }>().name).toBe('Test Branch');
  });

  it('manager cannot create a branch — 403', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/branches',
      headers: auth(managerToken),
      payload: branchPayload,
    });
    expect(res.statusCode).toBe(403);
  });

  it('receptionist cannot create a branch — 403', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/branches',
      headers: auth(receptionistToken),
      payload: branchPayload,
    });
    expect(res.statusCode).toBe(403);
  });

  it('owner can delete (deactivate) a branch', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/v1/branches',
      headers: auth(ownerToken), payload: branchPayload,
    });
    const id = created.json<{ _id: string }>()._id;

    const del = await app.inject({
      method:  'DELETE',
      url:     `/api/v1/branches/${id}`,
      headers: auth(ownerToken),
    });
    expect(del.statusCode).toBe(204);
  });
});

describe('Staff mutations — owner or manager only', () => {
  const staffPayload = {
    branchId:   TEST_BRANCH_ID,
    firstName:  'John',
    lastName:   'Doe',
    phone:      '9876543211',
    role:       'trainer',
    shiftStart: '06:00',
    shiftEnd:   '14:00',
  };

  it('receptionist cannot create staff — 403', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/staff',
      headers: auth(receptionistToken),
      payload: staffPayload,
    });
    expect(res.statusCode).toBe(403);
  });

  it('manager can create staff for their own branch', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/staff',
      headers: auth(managerToken),
      payload: staffPayload,
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('Branch-scoped data isolation', () => {
  it('manager from branch B cannot see branch A members', async () => {
    // Create member in TEST_BRANCH_ID (branch A)
    await app.inject({
      method: 'POST', url: '/api/v1/members',
      headers: auth(ownerToken),
      payload: {
        branchId: TEST_BRANCH_ID,
        firstName: 'Alice', lastName: 'Smith', phone: '9000000001',
      },
    });

    // otherBranchManagerToken is for branch-test-002
    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/members',
      headers: auth(otherBranchManagerToken),
    });

    expect(res.statusCode).toBe(200);
    // Manager for branch-002 should see 0 members (branch-001 is not in their branchIds)
    expect(res.json<{ data: unknown[] }>().data).toHaveLength(0);
  });

  it('owner can see members across all branches', async () => {
    await app.inject({
      method: 'POST', url: '/api/v1/members',
      headers: auth(ownerToken),
      payload: { branchId: TEST_BRANCH_ID, firstName: 'Bob', lastName: 'Jones', phone: '9000000002' },
    });

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/members',
      headers: auth(ownerToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ data: unknown[] }>().data.length).toBeGreaterThan(0);
  });
});

describe('Unauthenticated endpoints — skipAuth', () => {
  it('/health is public', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBeLessThan(503);
  });

  it('/api/v1/metrics is public', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ uptimeS: number }>().uptimeS).toBeGreaterThanOrEqual(0);
  });
});
