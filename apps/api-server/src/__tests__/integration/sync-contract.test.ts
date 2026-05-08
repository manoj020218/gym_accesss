import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import { randomUUID } from 'crypto';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from '../helpers/build-test-app.js';
import { startMongo, stopMongo, clearMongo } from '../helpers/mongo.js';
import { Member } from '../../models/Member.js';
import { AccessEvent } from '../../models/AccessEvent.js';
import { MemberStatus, Zone } from '@edge-gym/shared-types';

const SHARED_SECRET = process.env['EDGE_SHARED_SECRET']!;
const DEVICE_ID = 'edge-device-sync-test';
const BRANCH_ID = 'branch-sync-test';

function makeHmac(batchId: string, fromSeq: number, toSeq: number): string {
  return createHmac('sha256', SHARED_SECRET)
    .update(batchId + fromSeq + toSeq)
    .digest('hex');
}

function makePushBody(events: object[], batchId = randomUUID(), fromSeq = 1, toSeq = events.length) {
  return {
    batchId,
    edgeDeviceId:  DEVICE_ID,
    branchId:      BRANCH_ID,
    fromSeq,
    toSeq,
    events,
    hmacSignature: makeHmac(batchId, fromSeq, toSeq),
  };
}

const sampleEvent = (seq: number) => ({
  id:             randomUUID(),
  zone:           'main_entry',
  subjectType:    'member',
  subjectId:      'mem-001',
  decision:       'ALLOW',
  identifierUsed: 'rfid',
  localSeq:       seq,
  eventTime:      new Date().toISOString(),
});

let app: FastifyInstance;

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

describe('POST /api/v1/edge/push-events', () => {
  it('accepts a valid HMAC-signed batch and stores events', async () => {
    const events = [sampleEvent(1), sampleEvent(2)];
    const body   = makePushBody(events, randomUUID(), 1, 2);

    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/edge/push-events',
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    const json = res.json<{ accepted: number; ackCursor: number; rejected: unknown[] }>();
    expect(json.accepted).toBe(2);
    expect(json.ackCursor).toBe(2);
    expect(json.rejected).toHaveLength(0);

    const stored = await AccessEvent.countDocuments({ edgeDeviceId: DEVICE_ID });
    expect(stored).toBe(2);
  });

  it('is idempotent — replaying the same batch does not create duplicates', async () => {
    const events  = [sampleEvent(1)];
    const batchId = randomUUID();
    const body    = makePushBody(events, batchId, 1, 1);

    // First push
    await app.inject({ method: 'POST', url: '/api/v1/edge/push-events', payload: body });
    // Replay the exact same batch
    const res2 = await app.inject({ method: 'POST', url: '/api/v1/edge/push-events', payload: body });

    expect(res2.statusCode).toBe(200);
    const count = await AccessEvent.countDocuments({ edgeDeviceId: DEVICE_ID });
    expect(count).toBe(1);
  });

  it('rejects a batch with invalid HMAC', async () => {
    const body = {
      batchId:      randomUUID(),
      edgeDeviceId: DEVICE_ID,
      branchId:     BRANCH_ID,
      fromSeq:      1,
      toSeq:        1,
      events:       [sampleEvent(1)],
      hmacSignature: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    };

    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/edge/push-events',
      payload: body,
    });

    expect(res.statusCode).toBe(401);
    expect(res.json<{ error: string }>().error).toMatch(/hmac/i);
  });
});

describe('GET /api/v1/edge/pull', () => {
  it('returns members and staff arrays for a branch', async () => {
    await Member.create({
      memberCode:       'MEM001',
      branchId:         BRANCH_ID,
      allowedBranchIds: [BRANCH_ID],
      firstName:        'Test',
      lastName:         'Member',
      phone:            '9999999999',
      status:           MemberStatus.Active,
      allowedZones:     [Zone.MainEntry],
      faceEnrolled:     false,
      healthDeclarationSigned: false,
    });

    const res = await app.inject({
      method: 'GET',
      url:    `/api/v1/edge/pull?branchId=${BRANCH_ID}&edgeDeviceId=${DEVICE_ID}`,
    });

    expect(res.statusCode).toBe(200);
    const json = res.json<{ members: unknown[]; staff: unknown[]; policyVersion: number }>();
    expect(json.members).toHaveLength(1);
    expect(json.staff).toBeInstanceOf(Array);
    expect(typeof json.policyVersion).toBe('number');
  });
});

describe('POST /api/v1/edge/heartbeat', () => {
  it('accepts heartbeat and returns driftMs', async () => {
    const res = await app.inject({
      method: 'POST',
      url:    '/api/v1/edge/heartbeat',
      payload: {
        edgeDeviceId:      DEVICE_ID,
        branchId:          BRANCH_ID,
        localTime:         new Date().toISOString(),
        syncLag:           0,
        pendingEventCount: 0,
        uptime:            120,
      },
    });

    expect(res.statusCode).toBe(200);
    const json = res.json<{ driftMs: number; serverTime: string; ok: boolean }>();
    expect(typeof json.driftMs).toBe('number');
    expect(json.ok).toBe(true);
  });
});
