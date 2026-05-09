import type { FastifyPluginAsync } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { Member } from '../models/Member.js';
import { Membership } from '../models/Membership.js';
import { MemberStatus, Zone } from '@edge-gym/shared-types';
import { AuditLog } from '../models/AuditLog.js';

const emptyToUndefined = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());

const CreateBody = z.object({
  branchId:    z.string().min(1),
  firstName:   z.string().min(1),
  lastName:    z.string().min(1),
  phone:       z.string().min(10),
  email:       z.preprocess((v) => (v === '' ? undefined : v), z.string().email().optional()),
  address:     emptyToUndefined,
  dateOfBirth: emptyToUndefined,
  emergencyContact: z.object({ name: z.string(), phone: z.string() }).optional(),
  allowedBranchIds: z.array(z.string()).optional(),
});

const UpdateBody = CreateBody.partial().omit({ branchId: true }).extend({
  allowedZones: z.array(z.nativeEnum(Zone)).optional(),
  rfidCardId:   z.string().optional(),
});

const BlockBody = z.object({ reason: z.string().min(1) });

const ListQuery = z.object({
  branchId: z.string().optional(),
  status:   z.nativeEnum(MemberStatus).optional(),
  search:   z.string().optional(),
  page:     z.coerce.number().default(1),
  limit:    z.coerce.number().default(20),
});

function nextMemberCode(): string {
  return `MEM${Date.now().toString().slice(-6)}`;
}

const memberRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /members
  fastify.get('/members', async (req, reply) => {
    const q = ListQuery.parse(req.query);
    const filter: Record<string, unknown> = {};

    if (req.actor.role !== 'owner') {
      filter['branchId'] = { $in: req.actor.branchIds };
    } else if (q.branchId) {
      filter['branchId'] = q.branchId;
    }

    if (q.status) filter['status'] = q.status;
    if (q.search) {
      filter['$or'] = [
        { firstName: { $regex: q.search, $options: 'i' } },
        { lastName:  { $regex: q.search, $options: 'i' } },
        { phone:     { $regex: q.search, $options: 'i' } },
        { memberCode: { $regex: q.search, $options: 'i' } },
      ];
    }

    const skip  = (q.page - 1) * q.limit;
    const total = await Member.countDocuments(filter);
    const data  = await Member.find(filter).skip(skip).limit(q.limit).sort({ createdAt: -1 });

    return reply.send({
      data,
      total,
      page: q.page,
      limit: q.limit,
      pages: Math.ceil(total / q.limit),
    });
  });

  // POST /members
  fastify.post<{ Body: z.infer<typeof CreateBody> }>('/members', async (req, reply) => {
    const body = CreateBody.parse(req.body);
    const member = await Member.create({
      ...body,
      memberCode:      nextMemberCode(),
      status:          MemberStatus.Pending,
      allowedZones:    [Zone.MainEntry],
      allowedBranchIds: body.allowedBranchIds ?? [body.branchId],
      faceEnrolled:    false,
      healthDeclarationSigned: false,
    });

    await AuditLog.create({
      actorId: req.actor.sub, actorEmail: req.actor.email, actorRole: req.actor.role,
      branchId: body.branchId, action: 'CREATE', resourceType: 'Member', resourceId: member.id,
      after: member.toObject(), ip: req.ip,
    });

    return reply.status(201).send(member);
  });

  // GET /members/:id
  fastify.get<{ Params: { id: string } }>('/members/:id', async (req, reply) => {
    const member = await Member.findById(req.params.id);
    if (!member) return reply.status(404).send({ error: 'Not Found' });
    return reply.send(member);
  });

  // PUT /members/:id
  fastify.put<{ Params: { id: string }; Body: z.infer<typeof UpdateBody> }>(
    '/members/:id',
    async (req, reply) => {
      const body   = UpdateBody.parse(req.body);
      const before = await Member.findById(req.params.id);
      if (!before) return reply.status(404).send({ error: 'Not Found' });

      const member = await Member.findByIdAndUpdate(req.params.id, body, { new: true });

      await AuditLog.create({
        actorId: req.actor.sub, actorEmail: req.actor.email, actorRole: req.actor.role,
        action: 'UPDATE', resourceType: 'Member', resourceId: req.params.id,
        before: before.toObject(), after: member?.toObject(), ip: req.ip,
      });

      return reply.send(member);
    },
  );

  // POST /members/:id/block
  fastify.post<{ Params: { id: string }; Body: z.infer<typeof BlockBody> }>(
    '/members/:id/block',
    async (req, reply) => {
      const { reason } = BlockBody.parse(req.body);
      const member = await Member.findByIdAndUpdate(
        req.params.id,
        { status: MemberStatus.Blocked, blacklistReason: reason, blacklistedAt: new Date() },
        { new: true },
      );
      if (!member) return reply.status(404).send({ error: 'Not Found' });

      await AuditLog.create({
        actorId: req.actor.sub, actorEmail: req.actor.email, actorRole: req.actor.role,
        action: 'BLOCK_MEMBER', resourceType: 'Member', resourceId: req.params.id,
        after: { reason }, ip: req.ip,
      });

      return reply.send(member);
    },
  );

  // POST /members/:id/unblock
  fastify.post<{ Params: { id: string } }>('/members/:id/unblock', async (req, reply) => {
    const member = await Member.findByIdAndUpdate(
      req.params.id,
      { status: MemberStatus.Active, $unset: { blacklistReason: 1, blacklistedAt: 1 } },
      { new: true },
    );
    if (!member) return reply.status(404).send({ error: 'Not Found' });
    return reply.send(member);
  });

  // POST /members/:id/qr-token — regenerate QR access token (synced to edge on next pull)
  fastify.post<{ Params: { id: string } }>('/members/:id/qr-token', async (req, reply) => {
    const qrToken = randomBytes(20).toString('hex');
    const member  = await Member.findByIdAndUpdate(
      req.params.id,
      { qrToken },
      { new: true },
    );
    if (!member) return reply.status(404).send({ error: 'Not Found' });
    await AuditLog.create({
      actorId: req.actor.sub, actorEmail: req.actor.email, actorRole: req.actor.role,
      action: 'REGEN_QR_TOKEN', resourceType: 'Member', resourceId: req.params.id,
      ip: req.ip,
    });
    return reply.send({ qrToken, memberId: req.params.id });
  });

  // POST /members/:id/enroll-face — trigger face enrollment on the edge device
  fastify.post<{ Params: { id: string } }>('/members/:id/enroll-face', async (req, reply) => {
    const member = await Member.findById(req.params.id);
    if (!member) return reply.status(404).send({ error: 'Not Found' });

    // Mark faceEnrolled = true.
    // In production: forward to edge service to open camera, then confirm on callback.
    // The edge service links captured biometric to member.memberCode as unique identity key.
    await Member.findByIdAndUpdate(req.params.id, { faceEnrolled: true });

    await AuditLog.create({
      actorId: req.actor.sub, actorEmail: req.actor.email, actorRole: req.actor.role,
      action: 'FACE_ENROLL', resourceType: 'Member', resourceId: req.params.id,
      after: { faceEnrolled: true, memberCode: member.memberCode }, ip: req.ip,
    });

    return reply.send({
      success:    true,
      memberId:   member.id as string,
      memberCode: member.memberCode,
      message:    'Face enrolled and linked to member ID',
    });
  });

  // PUT /members/:id/fcm-token — called by the member app to register their FCM push token
  fastify.put<{ Params: { id: string }; Body: { fcmToken: string } }>(
    '/members/:id/fcm-token',
    async (req, reply) => {
      const { fcmToken } = req.body as { fcmToken: string };
      if (typeof fcmToken !== 'string' || fcmToken.length === 0) {
        return reply.status(400).send({ error: 'fcmToken is required' });
      }
      const member = await Member.findByIdAndUpdate(req.params.id, { fcmToken }, { new: true });
      if (!member) return reply.status(404).send({ error: 'Not Found' });
      return reply.send({ ok: true });
    },
  );
};

export default memberRoutes;
