import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Branch } from '../models/Branch.js';
import { AuditLog } from '../models/AuditLog.js';
import { requireRoles } from '../middleware/rbac.js';
import { StaffRole } from '@edge-gym/shared-types';

const CreateBody = z.object({
  name:     z.string().min(1),
  address:  z.string().min(1),
  phone:    z.string().min(10),
  timezone: z.string().default('Asia/Kolkata'),
});

const UpdateBody = CreateBody.partial().extend({
  isActive:            z.boolean().optional(),
  accessHoursEnabled:  z.boolean().optional(),
  accessHoursStart:    z.string().regex(/^\d{2}:\d{2}$/).optional(),
  accessHoursEnd:      z.string().regex(/^\d{2}:\d{2}$/).optional(),
  accessAllowedDays:   z.array(z.number().int().min(0).max(6)).optional(),
});

const branchRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /branches
  fastify.get('/branches', async (req, reply) => {
    const filter: Record<string, unknown> = {};
    if (req.actor.role !== StaffRole.Owner) {
      filter['_id'] = { $in: req.actor.branchIds };
    }
    const branches = await Branch.find(filter).sort({ name: 1 }).lean();
    return reply.send({ data: branches, total: branches.length });
  });

  // POST /branches — owner only
  fastify.post<{ Body: z.infer<typeof CreateBody> }>(
    '/branches',
    { preHandler: requireRoles(StaffRole.Owner) },
    async (req, reply) => {
      const body   = CreateBody.parse(req.body);
      const branch = await Branch.create({ ...body, ownerId: req.actor.sub, isActive: true });
      await AuditLog.create({
        actorId: req.actor.sub, actorEmail: req.actor.email, actorRole: req.actor.role,
        action: 'CREATE', resourceType: 'Branch', resourceId: branch.id,
        after: branch.toObject(), ip: req.ip,
      });
      return reply.status(201).send(branch);
    },
  );

  // GET /branches/:id
  fastify.get<{ Params: { id: string } }>('/branches/:id', async (req, reply) => {
    if (req.actor.role !== StaffRole.Owner && !req.actor.branchIds.includes(req.params.id)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const branch = await Branch.findById(req.params.id);
    if (!branch) return reply.status(404).send({ error: 'Not Found' });
    return reply.send(branch);
  });

  // PUT /branches/:id — owner only
  fastify.put<{ Params: { id: string }; Body: z.infer<typeof UpdateBody> }>(
    '/branches/:id',
    { preHandler: requireRoles(StaffRole.Owner) },
    async (req, reply) => {
      const body   = UpdateBody.parse(req.body);
      const before = await Branch.findById(req.params.id);
      if (!before) return reply.status(404).send({ error: 'Not Found' });
      const updated = await Branch.findByIdAndUpdate(req.params.id, body, { new: true });
      await AuditLog.create({
        actorId: req.actor.sub, actorEmail: req.actor.email, actorRole: req.actor.role,
        action: 'UPDATE', resourceType: 'Branch', resourceId: req.params.id,
        before: before.toObject(), after: updated?.toObject(), ip: req.ip,
      });
      return reply.send(updated);
    },
  );

  // DELETE /branches/:id — soft-delete, owner only
  fastify.delete<{ Params: { id: string } }>(
    '/branches/:id',
    { preHandler: requireRoles(StaffRole.Owner) },
    async (req, reply) => {
      const branch = await Branch.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
      if (!branch) return reply.status(404).send({ error: 'Not Found' });
      await AuditLog.create({
        actorId: req.actor.sub, actorEmail: req.actor.email, actorRole: req.actor.role,
        action: 'DEACTIVATE', resourceType: 'Branch', resourceId: req.params.id,
        ip: req.ip,
      });
      return reply.status(204).send();
    },
  );
};

export default branchRoutes;
