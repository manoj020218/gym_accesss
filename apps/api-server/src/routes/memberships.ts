import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Membership } from '../models/Membership.js';
import { MemberPlan } from '../models/MemberPlan.js';
import { Member } from '../models/Member.js';
import { Payment } from '../models/Payment.js';
import { MemberStatus } from '@edge-gym/shared-types';
import { AuditLog } from '../models/AuditLog.js';

const CreateBody = z.object({
  memberId:    z.string(),
  branchId:    z.string(),
  planId:      z.string(),
  startDate:   z.string(),
  paymentMode: z.string(),
  amountPaid:  z.number().positive(),
  discount:    z.number().min(0).default(0),
  notes:       z.string().optional(),
});

const RenewBody = z.object({
  planId:      z.string().optional(),
  startDate:   z.string().optional(),
  paymentMode: z.string(),
  amountPaid:  z.number().positive(),
  discount:    z.number().min(0).default(0),
  notes:       z.string().optional(),
});

const FreezeBody = z.object({
  freezeStartDate: z.string(),
  freezeEndDate:   z.string(),
  reason:          z.string().optional(),
});

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}

const membershipRoutes: FastifyPluginAsync = async (fastify) => {

  // POST /memberships  — create + record payment + activate member
  fastify.post<{ Body: z.infer<typeof CreateBody> }>('/memberships', async (req, reply) => {
    const body = CreateBody.parse(req.body);
    const plan = await MemberPlan.findById(body.planId);
    if (!plan) return reply.status(404).send({ error: 'Plan not found' });

    const startDate = new Date(body.startDate);
    const endDate   = plan.durationUnit === 'year'
      ? addMonths(startDate, plan.durationValue * 12)
      : plan.durationUnit === 'month'
        ? addMonths(startDate, plan.durationValue)
        : addDays(startDate, plan.durationValue);

    const membership = await Membership.create({
      memberId: body.memberId, branchId: body.branchId, planId: body.planId,
      planType: plan.planType, status: MemberStatus.Active,
      startDate, endDate, renewalCount: 0, freezeDaysUsed: 0,
      notes: body.notes,
    });

    const gstAmount = (body.amountPaid - body.discount) * plan.gstPercent / 100;
    await Payment.create({
      memberId: body.memberId, branchId: body.branchId, membershipId: membership.id,
      amount: body.amountPaid, discount: body.discount, gstAmount,
      totalAmount: body.amountPaid - body.discount + gstAmount,
      mode: body.paymentMode, collectedBy: req.actor.sub, paidAt: new Date(),
      receiptNo: `RCP${Date.now()}`,
    });

    await Member.findByIdAndUpdate(body.memberId, { status: MemberStatus.Active });

    await AuditLog.create({
      actorId: req.actor.sub, actorEmail: req.actor.email, actorRole: req.actor.role,
      branchId: body.branchId, action: 'CREATE_MEMBERSHIP', resourceType: 'Membership',
      resourceId: membership.id, after: membership.toObject(), ip: req.ip,
    });

    return reply.status(201).send(membership);
  });

  // POST /memberships/:id/renew
  fastify.post<{ Params: { id: string }; Body: z.infer<typeof RenewBody> }>(
    '/memberships/:id/renew',
    async (req, reply) => {
      const body = RenewBody.parse(req.body);
      const existing = await Membership.findById(req.params.id);
      if (!existing) return reply.status(404).send({ error: 'Not Found' });

      const planId = body.planId ?? existing.planId;
      const plan   = await MemberPlan.findById(planId);
      if (!plan) return reply.status(404).send({ error: 'Plan not found' });

      const startDate = body.startDate ? new Date(body.startDate) : new Date();
      const endDate   = plan.durationUnit === 'month'
        ? addMonths(startDate, plan.durationValue)
        : addDays(startDate, plan.durationValue);

      const updated = await Membership.findByIdAndUpdate(
        req.params.id,
        { planId, planType: plan.planType, status: MemberStatus.Active, startDate, endDate,
          $inc: { renewalCount: 1 }, notes: body.notes },
        { new: true },
      );

      const gstAmount = (body.amountPaid - body.discount) * plan.gstPercent / 100;
      await Payment.create({
        memberId: existing.memberId, branchId: existing.branchId, membershipId: existing.id,
        amount: body.amountPaid, discount: body.discount, gstAmount,
        totalAmount: body.amountPaid - body.discount + gstAmount,
        mode: body.paymentMode, collectedBy: req.actor.sub, paidAt: new Date(),
        receiptNo: `RCP${Date.now()}`,
      });

      await Member.findByIdAndUpdate(existing.memberId, { status: MemberStatus.Active });

      return reply.send(updated);
    },
  );

  // POST /memberships/:id/freeze
  fastify.post<{ Params: { id: string }; Body: z.infer<typeof FreezeBody> }>(
    '/memberships/:id/freeze',
    async (req, reply) => {
      const body = FreezeBody.parse(req.body);
      const freeze0 = new Date(body.freezeStartDate);
      const freeze1 = new Date(body.freezeEndDate);
      const freezeDays = Math.ceil((freeze1.getTime() - freeze0.getTime()) / 86_400_000);

      const existing = await Membership.findById(req.params.id);
      if (!existing) return reply.status(404).send({ error: 'Not Found' });

      const newEndDate = addDays(existing.endDate, freezeDays);
      const updated = await Membership.findByIdAndUpdate(
        req.params.id,
        { status: MemberStatus.Frozen, freezeStartDate: freeze0, freezeEndDate: freeze1,
          endDate: newEndDate, $inc: { freezeDaysUsed: freezeDays } },
        { new: true },
      );

      await Member.findByIdAndUpdate(existing.memberId, { status: MemberStatus.Frozen });
      return reply.send(updated);
    },
  );
};

export default membershipRoutes;
