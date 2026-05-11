import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'crypto';
import { AccessDevice } from '../models/AccessDevice.js';
import { AccessEvent }  from '../models/AccessEvent.js';
import { SyncCheckpoint } from '../models/SyncCheckpoint.js';
import { Member } from '../models/Member.js';
import { Staff }  from '../models/Staff.js';
import { config } from '../config.js';
import type { EdgeMemberRecord } from '@edge-gym/shared-types';
import { MemberStatus } from '@edge-gym/shared-types';

const HeartbeatBody = z.object({
  edgeDeviceId:    z.string(),
  branchId:        z.string(),
  localTime:       z.string(),
  syncLag:         z.number(),
  pendingEventCount: z.number(),
  uptime:          z.number(),
  edgeServiceIp:   z.string().optional(),
  edgeServicePort: z.number().optional(),
});

const PushBody = z.object({
  batchId:      z.string().uuid(),
  edgeDeviceId: z.string(),
  branchId:     z.string(),
  fromSeq:      z.number().int().nonnegative(),
  toSeq:        z.number().int().nonnegative(),
  events:       z.array(z.object({
    id:              z.string(),
    zone:            z.string(),
    subjectType:     z.string(),
    subjectId:       z.string(),
    subjectName:     z.string().optional(),
    decision:        z.string(),
    denyReason:      z.string().optional(),
    identifierUsed:  z.string(),
    localSeq:        z.number(),
    eventTime:       z.string(),
  })),
  hmacSignature: z.string(),
});

const POLICY_VERSION = 1; // increment when master data changes

const edgeSyncRoutes: FastifyPluginAsync = async (fastify) => {

  // POST /edge/register
  fastify.post<{ Body: { branchId: string; name: string } }>(
    '/edge/register',
    { config: { skipAuth: true } },
    async (req, reply) => {
      const { branchId, name } = req.body;
      const deviceCode = `DEV-${branchId.slice(-4).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
      const secret     = `sk_edge_${deviceCode}_${Math.random().toString(36).slice(2)}`;
      const secretHash = createHmac('sha256', secret).update(deviceCode).digest('hex');

      const device = await AccessDevice.create({
        deviceCode, name, branchId,
        zone: 'main_entry', type: 'rfid', protocol: 'tcp_ip',
        secretKeyHash: secretHash, relayEnabled: false, antiPassback: 'disabled',
      });

      return reply.status(201).send({ deviceId: device.id, deviceCode, secret });
    },
  );

  // POST /edge/heartbeat
  fastify.post<{ Body: z.infer<typeof HeartbeatBody> }>(
    '/edge/heartbeat',
    { config: { skipAuth: true } },
    async (req, reply) => {
      const body = HeartbeatBody.parse(req.body);

      await SyncCheckpoint.findOneAndUpdate(
        { edgeDeviceId: body.edgeDeviceId },
        {
          branchId:         body.branchId,
          lastHeartbeatAt:  new Date(),
          syncLag:          body.syncLag,
          pendingEventCount: body.pendingEventCount,
          uptimeSeconds:    body.uptime,
        },
        { upsert: true, new: true },
      );

      const edgeUpdate: Record<string, unknown> = { lastHeartbeatAt: new Date() };
      if (body.edgeServiceIp)   edgeUpdate['edgeServiceIp']   = body.edgeServiceIp;
      if (body.edgeServicePort) edgeUpdate['edgeServicePort'] = body.edgeServicePort;

      await AccessDevice.findOneAndUpdate(
        { deviceCode: body.edgeDeviceId },
        {
          ...edgeUpdate,
          $setOnInsert: {
            name:          `Device ${body.edgeDeviceId}`,
            branchId:      body.branchId,
            zone:          'main_entry',
            type:          'rfid',
            protocol:      'tcp_ip',
            relayEnabled:  true,
            antiPassback:  'disabled',
            secretKeyHash: 'auto-registered',
            isActive:      true,
            registeredAt:  new Date(),
          },
        },
        { upsert: true, new: true },
      );

      const serverTime = new Date().toISOString();
      const drift = Math.abs(new Date(body.localTime).getTime() - Date.now());

      return reply.send({ serverTime, driftMs: drift, ok: true });
    },
  );

  // GET /edge/pull?sinceVersion=N&branchId=X
  fastify.get<{ Querystring: { sinceVersion?: string; branchId: string; edgeDeviceId: string } }>(
    '/edge/pull',
    { config: { skipAuth: true } },
    async (req, reply) => {
      const branchId     = req.query.branchId;
      const edgeDeviceId = req.query.edgeDeviceId;

      const [members, staffList, device] = await Promise.all([
        Member.find({ allowedBranchIds: branchId }),
        Staff.find({ branchId, isActive: true }),
        AccessDevice.findOne({ deviceCode: edgeDeviceId }),
      ]);

      const edgeMembers: EdgeMemberRecord[] = members.map(m => ({
        memberId:         m.id as string,
        memberCode:       m.memberCode,
        rfidCardId:       m.rfidCardId,
        qrToken:          m.qrToken,
        status:           m.status as MemberStatus,
        activeUntil:      m.createdAt.toISOString(),
        allowedZones:     m.allowedZones,
        allowedBranchIds: m.allowedBranchIds,
        planType:         'basic',
        hasDues:          false,
      }));

      const edgeStaff = staffList.map(s => ({
        staffId:      s.id as string,
        name:         `${s.firstName} ${s.lastName}`,
        role:         s.role,
        allowedZones: s.allowedZones,
        shiftStart:   s.shiftStart,
        shiftEnd:     s.shiftEnd,
        rfidCardId:   s.rfidCardId,
      }));

      // Include MQTT live-access config so edge service can connect without a restart
      const mqttConfig = device?.mqttLiveEnabled ? {
        brokerUrl:  device.mqttBrokerUrl,
        infoTopic:  device.mqttInfoTopic,
        username:   device.mqttUsername,
        password:   device.mqttPassword,
      } : null;

      return reply.send({
        policyVersion: POLICY_VERSION,
        members:  edgeMembers,
        staff:    edgeStaff,
        policies: [],
        blocklist: members.filter(m => m.status === MemberStatus.Blocked).map(m => m.id as string),
        generatedAt: new Date().toISOString(),
        mqttConfig,
      });
    },
  );

  // POST /edge/push-events
  fastify.post<{ Body: z.infer<typeof PushBody> }>(
    '/edge/push-events',
    { config: { skipAuth: true } },
    async (req, reply) => {
      const body = PushBody.parse(req.body);

      // HMAC verification — must match EDGE_SHARED_SECRET used by edge service signing
      const expected = createHmac('sha256', config.EDGE_SHARED_SECRET)
        .update(body.batchId + body.fromSeq + body.toSeq)
        .digest('hex');
      const provided = body.hmacSignature.padEnd(expected.length, '0').slice(0, expected.length);
      const valid = timingSafeEqual(
        Buffer.from(expected, 'hex'),
        Buffer.from(provided, 'hex'),
      );

      if (!valid) {
        return reply.status(401).send({ error: 'Invalid HMAC signature' });
      }

      const accepted: number[] = [];
      const rejected: Array<{ eventId: string; reason: string }> = [];

      for (const ev of body.events) {
        try {
          await AccessEvent.findOneAndUpdate(
            { edgeDeviceId: body.edgeDeviceId, localSeq: ev.localSeq },
            {
              edgeDeviceId: body.edgeDeviceId,
              branchId:     body.branchId,
              zone:         ev.zone,
              subjectType:  ev.subjectType,
              subjectId:    ev.subjectId,
              subjectName:  ev.subjectName,
              decision:     ev.decision,
              denyReason:   ev.denyReason,
              identifierUsed: ev.identifierUsed,
              localSeq:     ev.localSeq,
              eventTime:    new Date(ev.eventTime),
              syncedAt:     new Date(),
            },
            { upsert: true },
          );
          accepted.push(ev.localSeq);
        } catch (err) {
          rejected.push({ eventId: ev.id, reason: (err as Error).message });
        }
      }

      await SyncCheckpoint.findOneAndUpdate(
        { edgeDeviceId: body.edgeDeviceId },
        { lastEventAckCursor: body.toSeq, lastSyncAt: new Date() },
        { upsert: true },
      );

      return reply.send({
        ackCursor: body.toSeq,
        accepted:  accepted.length,
        rejected,
      });
    },
  );
};

export default edgeSyncRoutes;
