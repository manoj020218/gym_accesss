import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Staff } from '../models/Staff.js';
import { User } from '../models/User.js';
import { AccessEvent } from '../models/AccessEvent.js';
import { AuditLog } from '../models/AuditLog.js';
import { requireRoles } from '../middleware/rbac.js';
import { StaffRole, Zone } from '@edge-gym/shared-types';

const CreateBody = z.object({
  branchId:     z.string(),
  firstName:    z.string().min(1),
  lastName:     z.string().min(1),
  phone:        z.string().min(10),
  email:        z.string().email().optional(),
  role:         z.nativeEnum(StaffRole),
  allowedZones: z.array(z.nativeEnum(Zone)).optional(),
  shiftStart:   z.string().regex(/^\d{2}:\d{2}$/, 'HH:MM format required'),
  shiftEnd:     z.string().regex(/^\d{2}:\d{2}$/, 'HH:MM format required'),
  rfidCardId:   z.string().optional(),
});

const UpdateBody = CreateBody.omit({ branchId: true }).partial().extend({
  isActive: z.boolean().optional(),
});

const ListQuery = z.object({
  branchId: z.string().optional(),
  role:     z.nativeEnum(StaffRole).optional(),
  isActive: z.coerce.boolean().optional(),
  page:     z.coerce.number().default(1),
  limit:    z.coerce.number().default(20),
});

const AttendanceQuery = z.object({
  from:  z.string().optional(),
  to:    z.string().optional(),
  limit: z.coerce.number().default(50),
});

const staffRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /staff
  fastify.get('/staff', async (req, reply) => {
    const q = ListQuery.parse(req.query);
    const filter: Record<string, unknown> = {};

    if (req.actor.role !== StaffRole.Owner) {
      filter['branchId'] = { $in: req.actor.branchIds };
    } else if (q.branchId) {
      filter['branchId'] = q.branchId;
    }

    if (q.role !== undefined)     filter['role']     = q.role;
    if (q.isActive !== undefined) filter['isActive'] = q.isActive;

    const skip  = (q.page - 1) * q.limit;
    const total = await Staff.countDocuments(filter);
    const data  = await Staff.find(filter).skip(skip).limit(q.limit).sort({ firstName: 1 });

    return reply.send({ data, total, page: q.page, limit: q.limit, pages: Math.ceil(total / q.limit) });
  });

  // POST /staff — owner or manager
  fastify.post<{ Body: z.infer<typeof CreateBody> }>(
    '/staff',
    { preHandler: requireRoles(StaffRole.Owner, StaffRole.Manager) },
    async (req, reply) => {
      const body  = CreateBody.parse(req.body);
      const staff = await Staff.create({
        ...body,
        allowedZones: body.allowedZones ?? [Zone.MainEntry, Zone.StaffRoom],
        isActive: true,
        joinedAt: new Date(),
      });
      await AuditLog.create({
        actorId: req.actor.sub, actorEmail: req.actor.email, actorRole: req.actor.role,
        branchId: body.branchId, action: 'CREATE', resourceType: 'Staff', resourceId: staff.id,
        after: staff.toObject(), ip: req.ip,
      });
      return reply.status(201).send(staff);
    },
  );

  // GET /staff/:id
  fastify.get<{ Params: { id: string } }>('/staff/:id', async (req, reply) => {
    const staff = await Staff.findById(req.params.id);
    if (!staff) return reply.status(404).send({ error: 'Not Found' });
    if (req.actor.role !== StaffRole.Owner && !req.actor.branchIds.includes(staff.branchId)) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    return reply.send(staff);
  });

  // PUT /staff/:id
  fastify.put<{ Params: { id: string }; Body: z.infer<typeof UpdateBody> }>(
    '/staff/:id',
    { preHandler: requireRoles(StaffRole.Owner, StaffRole.Manager) },
    async (req, reply) => {
      const body   = UpdateBody.parse(req.body);
      const before = await Staff.findById(req.params.id);
      if (!before) return reply.status(404).send({ error: 'Not Found' });
      const updated = await Staff.findByIdAndUpdate(req.params.id, body, { new: true });
      await AuditLog.create({
        actorId: req.actor.sub, actorEmail: req.actor.email, actorRole: req.actor.role,
        action: 'UPDATE', resourceType: 'Staff', resourceId: req.params.id,
        before: before.toObject(), after: updated?.toObject(), ip: req.ip,
      });
      return reply.send(updated);
    },
  );

  // DELETE /staff/:id — deactivate
  fastify.delete<{ Params: { id: string } }>(
    '/staff/:id',
    { preHandler: requireRoles(StaffRole.Owner, StaffRole.Manager) },
    async (req, reply) => {
      const staff = await Staff.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
      if (!staff) return reply.status(404).send({ error: 'Not Found' });
      return reply.status(204).send();
    },
  );

  // PUT /users/:userId/permissions — owner only, assign permissions to a login account
  fastify.put<{ Params: { userId: string }; Body: { permissions: string[] } }>(
    '/users/:userId/permissions',
    { preHandler: requireRoles(StaffRole.Owner) },
    async (req, reply) => {
      const { permissions } = req.body as { permissions: string[] };
      if (!Array.isArray(permissions)) {
        return reply.status(400).send({ error: 'permissions must be an array' });
      }
      const user = await User.findByIdAndUpdate(
        req.params.userId,
        { permissions },
        { new: true },
      );
      if (!user) return reply.status(404).send({ error: 'User not found' });
      await AuditLog.create({
        actorId: req.actor.sub, actorEmail: req.actor.email, actorRole: req.actor.role,
        action: 'UPDATE_PERMISSIONS', resourceType: 'User', resourceId: req.params.userId,
        after: { permissions }, ip: req.ip,
      });
      return reply.send({ userId: user.id, permissions: user.permissions });
    },
  );

  // GET /staff/:id/attendance — access events for this staff member
  fastify.get<{ Params: { id: string }; Querystring: z.infer<typeof AttendanceQuery> }>(
    '/staff/:id/attendance',
    async (req, reply) => {
      const q     = AttendanceQuery.parse(req.query);
      const staff = await Staff.findById(req.params.id).lean();
      if (!staff) return reply.status(404).send({ error: 'Not Found' });

      const filter: Record<string, unknown> = { subjectId: req.params.id };
      if (q.from || q.to) {
        const timeFilter: Record<string, unknown> = {};
        if (q.from) timeFilter['$gte'] = new Date(q.from);
        if (q.to)   timeFilter['$lte'] = new Date(q.to);
        filter['eventTime'] = timeFilter;
      }

      const events = await AccessEvent.find(filter)
        .sort({ eventTime: -1 })
        .limit(q.limit)
        .lean();

      return reply.send({ data: events, staffId: req.params.id, total: events.length });
    },
  );
};

export default staffRoutes;
