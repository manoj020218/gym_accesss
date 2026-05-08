import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Member } from '../models/Member.js';
import { Membership } from '../models/Membership.js';
import { AuditLog } from '../models/AuditLog.js';
import { requireRoles } from '../middleware/rbac.js';
import { StaffRole, MemberStatus, NotificationType } from '@edge-gym/shared-types';
import { fcmSendToToken, fcmSendMulticast } from '../services/fcm.js';

const SendBody = z.object({
  memberId: z.string(),
  title:    z.string().min(1),
  body:     z.string().min(1),
  type:     z.nativeEnum(NotificationType),
  data:     z.record(z.string()).optional(),
});

const CampaignBody = z.object({
  branchId: z.string(),
  title:    z.string().min(1),
  body:     z.string().min(1),
  type:     z.nativeEnum(NotificationType),
  data:     z.record(z.string()).optional(),
});

const RenewalBatchBody = z.object({
  branchId:  z.string(),
  daysAhead: z.coerce.number().int().min(1).max(30).default(7),
});

function pickFcmToken(member: unknown): string | undefined {
  return (member as { fcmToken?: string }).fcmToken;
}

const notificationRoutes: FastifyPluginAsync = async (fastify) => {

  // POST /notifications/send — push to a single member by DB id
  fastify.post<{ Body: z.infer<typeof SendBody> }>(
    '/send',
    { preHandler: requireRoles(
        StaffRole.Owner, StaffRole.Manager,
        StaffRole.Trainer, StaffRole.Receptionist,
      ),
    },
    async (req, reply) => {
      const body   = SendBody.parse(req.body);
      const member = await Member.findById(body.memberId).lean();
      if (!member) return reply.status(404).send({ error: 'Member not found' });

      const token = pickFcmToken(member);
      if (!token) return reply.status(422).send({ error: 'Member has no FCM token registered' });

      const messageId = await fcmSendToToken(fastify.firebase, token, body.title, body.body, {
        ...body.data,
        type:     body.type,
        memberId: body.memberId,
      });

      await AuditLog.create({
        actorId: req.actor.sub, actorEmail: req.actor.email, actorRole: req.actor.role,
        action: 'SEND_NOTIFICATION', resourceType: 'Member', resourceId: body.memberId,
        after: { type: body.type, title: body.title }, ip: req.ip,
      });

      return reply.send({ messageId, memberId: body.memberId });
    },
  );

  // POST /notifications/campaign — broadcast to all active members of a branch
  fastify.post<{ Body: z.infer<typeof CampaignBody> }>(
    '/campaign',
    { preHandler: requireRoles(StaffRole.Owner, StaffRole.Manager) },
    async (req, reply) => {
      const body = CampaignBody.parse(req.body);

      const members = await Member.find({
        branchId: body.branchId,
        status:   MemberStatus.Active,
        fcmToken: { $exists: true, $ne: null },
      }).lean().select('fcmToken');

      const tokens = members
        .map(pickFcmToken)
        .filter((t): t is string => typeof t === 'string' && t.length > 0);

      if (tokens.length === 0) {
        return reply.send({ sent: 0, failed: 0, message: 'No active members with FCM tokens' });
      }

      const result = await fcmSendMulticast(fastify.firebase, tokens, body.title, body.body, {
        ...body.data,
        type: body.type,
      });

      return reply.send({ sent: result.successCount, failed: result.failureCount, total: tokens.length });
    },
  );

  // POST /notifications/renewal-batch — renewal reminders for members expiring within N days
  fastify.post<{ Body: z.infer<typeof RenewalBatchBody> }>(
    '/renewal-batch',
    { preHandler: requireRoles(StaffRole.Owner, StaffRole.Manager) },
    async (req, reply) => {
      const { branchId, daysAhead } = RenewalBatchBody.parse(req.body);
      const now       = new Date();
      const cutoff    = new Date(now.getTime() + daysAhead * 86_400_000);

      const expiringMemberships = await Membership.find({
        branchId,
        status:  MemberStatus.Active,
        endDate: { $gt: now, $lte: cutoff },
      }).lean();

      const memberIds = expiringMemberships.map(m => m.memberId);
      if (memberIds.length === 0) {
        return reply.send({ sent: 0, failed: 0, expiring: 0 });
      }

      const members = await Member.find({
        _id:      { $in: memberIds },
        fcmToken: { $exists: true, $ne: null },
      }).lean();

      const tokens = members
        .map(pickFcmToken)
        .filter((t): t is string => typeof t === 'string' && t.length > 0);

      if (tokens.length === 0) {
        return reply.send({ sent: 0, failed: 0, expiring: memberIds.length });
      }

      const result = await fcmSendMulticast(
        fastify.firebase,
        tokens,
        '⏰ Membership Expiring Soon',
        `Your membership expires in ${daysAhead} day(s). Renew now to keep gym access!`,
        { type: NotificationType.RenewalReminder, branchId, daysAhead: String(daysAhead) },
      );

      return reply.send({
        sent:     result.successCount,
        failed:   result.failureCount,
        expiring: memberIds.length,
      });
    },
  );
};

export default notificationRoutes;
