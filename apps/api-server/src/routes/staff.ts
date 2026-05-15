import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Staff } from '../models/Staff.js';
import { User } from '../models/User.js';
import { AccessEvent } from '../models/AccessEvent.js';
import { AuditLog } from '../models/AuditLog.js';
import { AccessDevice } from '../models/AccessDevice.js';
import { requireRoles } from '../middleware/rbac.js';
import { StaffRole, Zone } from '@edge-gym/shared-types';

const CreateBody = z.object({
  branchId:     z.string(),
  firstName:    z.string().min(1),
  lastName:     z.string().min(1),
  phone:        z.string().min(10),
  email:        z.string().email().optional(),
  role:         z.string().min(1),  // accepts StaffRole enum values or custom gym-specific roles
  allowedZones: z.array(z.nativeEnum(Zone)).optional(),
  shiftStart:   z.string().regex(/^\d{2}:\d{2}$/, 'HH:MM format required').optional(),
  shiftEnd:     z.string().regex(/^\d{2}:\d{2}$/, 'HH:MM format required').optional(),
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

  // POST /staff/:id/enroll-face — upload photo to U5 machine
  fastify.post<{ Params: { id: string }; Body: { imageBase64?: string } }>(
    '/staff/:id/enroll-face',
    async (req, reply) => {
      const staff = await Staff.findById(req.params.id);
      if (!staff) return reply.status(404).send({ error: 'Not Found' });

      const { imageBase64 } = (req.body ?? {}) as { imageBase64?: string };
      if (!imageBase64) {
        return reply.status(400).send({ error: 'Image required', hint: 'Upload a face photo.' });
      }

      const device = await AccessDevice.findOne({
        branchId: staff.branchId,
        isActive: true,
        ipAddress: { $exists: true, $ne: null },
      });

      if (!device?.ipAddress) {
        return reply.status(503).send({
          error: 'No device found for this branch',
          hint:  'Register and connect an access machine first.',
        });
      }

      const machineUrl = `http://${device.ipAddress}:${device.port ?? 80}`;
      const picLarge   = imageBase64.startsWith('data:')
        ? imageBase64
        : `data:image/jpeg;base64,${imageBase64}`;

      let machineUserId: string | undefined;
      try {
        const u5Res = await fetch(`${machineUrl}/insertEmployee`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            password:           device.machinePassword ?? '123456',
            name:               `${staff.firstName} ${staff.lastName}`.slice(0, 10),
            id_number:          staff._id.toString(),
            access_card_number: staff.rfidCardId ?? '',
            pass_date:          '0',
            pass_time:          '0',
            pic_large:          picLarge,
          }),
          signal: AbortSignal.timeout(15_000),
        });

        if (!u5Res.ok) {
          return reply.status(502).send({
            error: 'Machine rejected request',
            hint:  `U5 responded with HTTP ${u5Res.status}`,
          });
        }

        const u5Raw  = await u5Res.text();
        const u5Data = JSON.parse(u5Raw) as { code: number; userId?: string };
        if (u5Data.code !== 200) {
          const hint = u5Data.code === 12
            ? 'Face too similar to an existing employee — try a different photo'
            : `U5 enrollment failed (code ${u5Data.code})`;
          return reply.status(422).send({ error: 'Machine rejected enrollment', hint });
        }

        machineUserId = u5Data.userId;
      } catch (err: unknown) {
        const isTimeout = err instanceof Error && err.name === 'TimeoutError';
        return reply.status(503).send({
          error: isTimeout ? 'Machine timed out' : 'Cannot reach machine',
          hint:  `Could not connect to ${machineUrl}. Check the device is on the same network.`,
        });
      }

      await Staff.findByIdAndUpdate(req.params.id, machineUserId
        ? { faceEnrolled: true, $addToSet: { machineUsers: { deviceCode: device.deviceCode, machineUserId } } }
        : { faceEnrolled: true },
      );

      return reply.send({ enrolled: true, machineUserId, deviceCode: device.deviceCode });
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
