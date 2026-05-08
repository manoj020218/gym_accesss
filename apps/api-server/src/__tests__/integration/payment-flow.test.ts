import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from '../helpers/build-test-app.js';
import { startMongo, stopMongo } from '../helpers/mongo.js';
import { ownerToken, TEST_BRANCH_ID } from '../helpers/tokens.js';
import { MemberPlan } from '../../models/MemberPlan.js';
import { Member } from '../../models/Member.js';
import { Membership } from '../../models/Membership.js';
import { Payment } from '../../models/Payment.js';
import { PlanType, PlanDurationUnit, Zone, PaymentMode } from '@edge-gym/shared-types';

let app: FastifyInstance;
let planId: string;
let memberId: string;

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  await startMongo();
  app = await buildTestApp();

  // Seed a MemberPlan used across tests
  const plan = await MemberPlan.create({
    name:          'Monthly Basic',
    planType:      PlanType.Basic,
    durationValue: 1,
    durationUnit:  PlanDurationUnit.Month,
    price:         999,
    gstPercent:    18,
    allowedZones:  [Zone.MainEntry, Zone.Cardio],
    isActive:      true,
    branchId:      TEST_BRANCH_ID,
  });
  planId = plan.id as string;
});

afterAll(async () => {
  await app.close();
  await stopMongo();
});

beforeEach(async () => {
  // Clear transactional data; preserve MemberPlan seeded in beforeAll
  await Promise.all([
    Member.deleteMany({}),
    Membership.deleteMany({}),
    Payment.deleteMany({}),
  ]);
});

describe('Member creation', () => {
  it('creates a member with pending status', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/members',
      headers: auth(ownerToken),
      payload: {
        branchId:  TEST_BRANCH_ID,
        firstName: 'Ravi',
        lastName:  'Kumar',
        phone:     '9000000010',
        email:     'ravi@test.com',
      },
    });

    expect(res.statusCode).toBe(201);
    const member = res.json<{ status: string; memberCode: string; _id: string }>();
    expect(member.status).toBe('pending');
    expect(member.memberCode).toMatch(/^MEM/);
    memberId = member._id;
  });
});

describe('Membership + payment flow', () => {
  beforeEach(async () => {
    // Create a fresh member for each test
    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/members',
      headers: auth(ownerToken),
      payload: {
        branchId: TEST_BRANCH_ID, firstName: 'Test', lastName: 'User', phone: '9000000020',
      },
    });
    memberId = res.json<{ _id: string }>()._id;
  });

  it('creates membership, activates member, and records payment', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/memberships',
      headers: auth(ownerToken),
      payload: {
        memberId,
        branchId:    TEST_BRANCH_ID,
        planId,
        startDate:   new Date().toISOString(),
        paymentMode: PaymentMode.Cash,
        amountPaid:  999,
        discount:    0,
      },
    });

    expect(res.statusCode).toBe(201);
    const membership = res.json<{ status: string; planType: string }>();
    expect(membership.status).toBe('active');

    // Member status should now be active
    const memberRes = await app.inject({
      method: 'GET', url: `/api/v1/members/${memberId}`, headers: auth(ownerToken),
    });
    expect(memberRes.json<{ status: string }>().status).toBe('active');

    // Payment should exist
    const paymentsRes = await app.inject({
      method: 'GET', url: `/api/v1/payments?memberId=${memberId}`, headers: auth(ownerToken),
    });
    expect(paymentsRes.json<{ data: unknown[]; total: number }>().total).toBe(1);
  });

  it('renews a membership and creates a new payment', async () => {
    // Create initial membership
    const memRes = await app.inject({
      method:  'POST', url: '/api/v1/memberships', headers: auth(ownerToken),
      payload: { memberId, branchId: TEST_BRANCH_ID, planId,
        startDate: new Date().toISOString(), paymentMode: PaymentMode.UPI, amountPaid: 999, discount: 0 },
    });
    const membershipId = memRes.json<{ _id: string }>()._id;

    // Renew
    const renewRes = await app.inject({
      method:  'POST',
      url:     `/api/v1/memberships/${membershipId}/renew`,
      headers: auth(ownerToken),
      payload: { paymentMode: PaymentMode.Cash, amountPaid: 999, discount: 50 },
    });

    expect(renewRes.statusCode).toBe(200);
    const renewed = renewRes.json<{ renewalCount: number }>();
    expect(renewed.renewalCount).toBe(1);

    // Two payments: initial + renewal
    const payments = await app.inject({
      method: 'GET', url: `/api/v1/payments?memberId=${memberId}`, headers: auth(ownerToken),
    });
    expect(payments.json<{ total: number }>().total).toBe(2);
  });

  it('freezes a membership and extends end date', async () => {
    const memRes = await app.inject({
      method: 'POST', url: '/api/v1/memberships', headers: auth(ownerToken),
      payload: { memberId, branchId: TEST_BRANCH_ID, planId,
        startDate: new Date().toISOString(), paymentMode: PaymentMode.Cash, amountPaid: 999, discount: 0 },
    });
    const membershipId = memRes.json<{ _id: string; endDate: string }>()._id;
    const originalEnd  = memRes.json<{ endDate: string }>().endDate;

    const freezeRes = await app.inject({
      method:  'POST',
      url:     `/api/v1/memberships/${membershipId}/freeze`,
      headers: auth(ownerToken),
      payload: {
        freezeStartDate: new Date().toISOString(),
        freezeEndDate:   new Date(Date.now() + 7 * 86_400_000).toISOString(),
        reason: 'Travel',
      },
    });

    expect(freezeRes.statusCode).toBe(200);
    const frozen = freezeRes.json<{ status: string; endDate: string; freezeDaysUsed: number }>();
    expect(frozen.status).toBe('frozen');
    expect(frozen.freezeDaysUsed).toBe(7);
    expect(new Date(frozen.endDate).getTime()).toBeGreaterThan(new Date(originalEnd).getTime());
  });
});

describe('Payment summary and receipt', () => {
  it('GET /payments/summary returns aggregate totals', async () => {
    // Create member + membership (which creates a payment)
    const mRes = await app.inject({
      method: 'POST', url: '/api/v1/members', headers: auth(ownerToken),
      payload: { branchId: TEST_BRANCH_ID, firstName: 'Sum', lastName: 'Test', phone: '9000000030' },
    });
    const mId = mRes.json<{ _id: string }>()._id;

    await app.inject({
      method: 'POST', url: '/api/v1/memberships', headers: auth(ownerToken),
      payload: { memberId: mId, branchId: TEST_BRANCH_ID, planId,
        startDate: new Date().toISOString(), paymentMode: PaymentMode.Online, amountPaid: 999, discount: 0 },
    });

    const res = await app.inject({
      method:  'GET',
      url:     `/api/v1/payments/summary?branchId=${TEST_BRANCH_ID}`,
      headers: auth(ownerToken),
    });

    expect(res.statusCode).toBe(200);
    const summary = res.json<{ totalRevenue: number; count: number }>();
    expect(summary.count).toBe(1);
    expect(summary.totalRevenue).toBeGreaterThan(0);
  });

  it('GET /payments/:id returns a receipt', async () => {
    // Create a standalone payment
    const pRes = await app.inject({
      method:  'POST', url: '/api/v1/payments', headers: auth(ownerToken),
      payload: { memberId: 'walk-in', branchId: TEST_BRANCH_ID,
        amount: 500, discount: 0, gstAmount: 90, mode: PaymentMode.Cash },
    });
    const receiptId = pRes.json<{ _id: string }>()._id;

    const res = await app.inject({
      method: 'GET', url: `/api/v1/payments/${receiptId}`, headers: auth(ownerToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ receiptNo: string }>().receiptNo).toMatch(/^RCP/);
  });
});
