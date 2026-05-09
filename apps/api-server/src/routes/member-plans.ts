import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { MemberPlan } from '../models/MemberPlan.js';
import { StaffRole } from '@edge-gym/shared-types';

const CreateBody = z.object({
  name:          z.string().min(1),
  planType:      z.string().min(1),
  durationValue: z.number().positive(),
  durationUnit:  z.enum(['day', 'month', 'year']),
  price:         z.number().positive(),
  gstPercent:    z.number().min(0).default(18),
  allowedZones:  z.array(z.string()).default([]),
  features:      z.array(z.string()).default([]),
  branchId:      z.string().min(1),
});

const memberPlanRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /member-plans?branchId=...
  fastify.get('/member-plans', async (req, reply) => {
    const q = z.object({ branchId: z.string().optional() }).parse(req.query);

    const filter: Record<string, unknown> = { isActive: true };
    if (q.branchId) {
      filter['branchId'] = q.branchId;
    } else if (req.actor.role !== StaffRole.Owner) {
      filter['branchId'] = { $in: req.actor.branchIds };
    }

    const plans = await MemberPlan.find(filter).sort({ price: 1 }).lean();
    return reply.send(plans);
  });

  // POST /member-plans — owner or manage_plans permission
  fastify.post<{ Body: z.infer<typeof CreateBody> }>(
    '/member-plans',
    async (req, reply) => {
      if (req.actor.role !== StaffRole.Owner && !req.actor.permissions.includes('manage_plans')) {
        return reply.status(403).send({ error: 'Forbidden' });
      }
      const body = CreateBody.parse(req.body);
      const plan = await MemberPlan.create({ ...body, isActive: true });
      return reply.status(201).send(plan);
    },
  );

  // DELETE /member-plans/:id — owner or manage_plans permission
  fastify.delete<{ Params: { id: string } }>('/member-plans/:id', async (req, reply) => {
    if (req.actor.role !== StaffRole.Owner && !req.actor.permissions.includes('manage_plans')) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    await MemberPlan.findByIdAndUpdate(req.params.id, { isActive: false });
    return reply.status(204).send();
  });
};

export default memberPlanRoutes;
