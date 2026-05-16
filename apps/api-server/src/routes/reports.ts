import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Payment }     from '../models/Payment.js';
import { Membership }  from '../models/Membership.js';
import { Member }      from '../models/Member.js';
import { AccessEvent } from '../models/AccessEvent.js';
import { Product }     from '../models/Product.js';
import { Staff }       from '../models/Staff.js';
import { MemberStatus, AccessDecision } from '@edge-gym/shared-types';

const DateRangeQuery = z.object({
  branchId: z.string().optional(),
  from:     z.string().optional(),
  to:       z.string().optional(),
});

const reportsRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /dues
  fastify.get('/dues', async (req, reply) => {
    const { branchId } = DateRangeQuery.parse(req.query);
    const filter: Record<string, unknown> = { status: MemberStatus.Expired };
    if (branchId) filter['branchId'] = branchId;

    const members = await Member.find(filter).limit(500);
    return reply.send({ data: members, total: members.length });
  });

  // GET /daily-collection
  fastify.get('/daily-collection', async (req, reply) => {
    const { branchId, from, to } = DateRangeQuery.parse(req.query);
    const matchStage: Record<string, unknown> = {};
    if (branchId) matchStage['branchId'] = branchId;
    if (from || to) {
      matchStage['paidAt'] = {
        ...(from ? { $gte: new Date(from) } : {}),
        ...(to   ? { $lte: new Date(to)   } : {}),
      };
    }

    const result = await Payment.aggregate([
      { $match: matchStage },
      { $group: {
        _id:   { $dateToString: { format: '%Y-%m-%d', date: '$paidAt' } },
        total: { $sum: '$totalAmount' },
        count: { $sum: 1 },
      }},
      { $sort: { '_id': -1 } },
    ]);

    return reply.send({ data: result });
  });

  // GET /reports/expiring — members expiring within N days
  fastify.get<{ Querystring: { days?: string; branchId?: string } }>(
    '/expiring',
    async (req, reply) => {
      const days = Number(req.query.days ?? 7);
      const until = new Date(Date.now() + days * 86_400_000);

      const filter: Record<string, unknown> = {
        status:  MemberStatus.Active,
        endDate: { $lte: until, $gte: new Date() },
      };
      if (req.query.branchId) filter['branchId'] = req.query.branchId;

      const data = await Membership.find(filter).limit(200).sort({ endDate: 1 });
      return reply.send({ data, total: data.length });
    },
  );

  // GET /access-denied
  fastify.get('/access-denied', async (req, reply) => {
    const { branchId, from, to } = DateRangeQuery.parse(req.query);
    const filter: Record<string, unknown> = { decision: AccessDecision.Deny };
    if (branchId) filter['branchId'] = branchId;
    if (from || to) {
      filter['eventTime'] = {
        ...(from ? { $gte: new Date(from) } : {}),
        ...(to   ? { $lte: new Date(to)   } : {}),
      };
    }

    const data = await AccessEvent.find(filter).sort({ eventTime: -1 }).limit(500);
    return reply.send({ data, total: data.length });
  });

  // GET /stock-low
  fastify.get('/stock-low', async (req, reply) => {
    const { branchId } = DateRangeQuery.parse(req.query);
    const filter: Record<string, unknown> = {
      $expr: { $lte: ['$stockQty', '$minStockLevel'] },
      isActive: true,
    };
    if (branchId) filter['branchId'] = branchId;
    const data = await Product.find(filter);
    return reply.send({ data, total: data.length });
  });

  // GET /attendance
  fastify.get('/attendance', async (req, reply) => {
    const { branchId, from, to } = DateRangeQuery.parse(req.query);
    const filter: Record<string, unknown> = { decision: AccessDecision.Allow };
    if (branchId) filter['branchId'] = branchId;
    if (from || to) {
      filter['eventTime'] = {
        ...(from ? { $gte: new Date(from) } : {}),
        ...(to   ? { $lte: new Date(to)   } : {}),
      };
    }

    const result = await AccessEvent.aggregate([
      { $match: filter },
      { $group: {
        _id: { date: { $dateToString: { format: '%Y-%m-%d', date: '$eventTime' } }, branchId: '$branchId' },
        count: { $sum: 1 },
        uniqueMembers: { $addToSet: '$subjectId' },
      }},
      { $project: { date: '$_id.date', branchId: '$_id.branchId', count: 1, uniqueCount: { $size: '$uniqueMembers' } } },
      { $sort: { date: -1 } },
    ]);

    return reply.send({ data: result });
  });
  // GET /staff-attendance — individual staff punch records
  fastify.get('/staff-attendance', async (req, reply) => {
    const { branchId, from, to } = DateRangeQuery.parse(req.query);
    const filter: Record<string, unknown> = { subjectType: 'staff', decision: AccessDecision.Allow };
    if (branchId) filter['branchId'] = branchId;
    if (from || to) {
      filter['eventTime'] = {
        ...(from ? { $gte: new Date(from) } : {}),
        ...(to   ? { $lte: new Date(to)   } : {}),
      };
    }

    const events = await AccessEvent.find(filter).sort({ eventTime: -1 }).limit(1000).lean();

    // Enrich with machineUserId for ALOG export
    const staffIds = [...new Set(events.map((e) => e.subjectId).filter(Boolean))];
    const staffDocs = await Staff.find({ _id: { $in: staffIds } }, 'firstName lastName machineUsers').lean();
    const staffMap = new Map(staffDocs.map((s) => [s._id.toString(), s]));

    const data = events.map((ev) => {
      const s = staffMap.get(ev.subjectId);
      const machineUserId = s?.machineUsers?.[0]?.machineUserId ?? null;
      return {
        _id:           ev._id,
        subjectId:     ev.subjectId,
        subjectName:   ev.subjectName,
        machineUserId,
        identifierUsed: ev.identifierUsed,
        edgeDeviceId:  ev.edgeDeviceId,
        zone:          ev.zone,
        eventTime:     ev.eventTime,
      };
    });

    return reply.send({ data, total: data.length });
  });

  // GET /staff-attendance/download — ALOG_003.txt for EDGEFOLIO salary import
  fastify.get('/staff-attendance/download', async (req, reply) => {
    const { branchId, from, to } = DateRangeQuery.parse(req.query);
    const filter: Record<string, unknown> = { subjectType: 'staff', decision: AccessDecision.Allow };
    if (branchId) filter['branchId'] = branchId;
    if (from || to) {
      filter['eventTime'] = {
        ...(from ? { $gte: new Date(from) } : {}),
        ...(to   ? { $lte: new Date(to)   } : {}),
      };
    }

    const events = await AccessEvent.find(filter).sort({ eventTime: 1 }).limit(5000).lean();

    const staffIds = [...new Set(events.map((e) => e.subjectId).filter(Boolean))];
    const staffDocs = await Staff.find({ _id: { $in: staffIds } }, 'machineUsers').lean();
    const staffMap = new Map(staffDocs.map((s) => [s._id.toString(), s]));

    const header = ['No', 'TMNo', 'EnNo', 'Name', 'GMNo', 'Mode', 'In/Out', 'Antipass', 'ProxyWork', 'DateTime'].join('\t');

    const rows = events.map((ev, idx) => {
      const s = staffMap.get(ev.subjectId);
      // machineUserId may differ per device; pick the one for this edgeDeviceId, else first
      const mu = s?.machineUsers?.find((m: { deviceCode: string; machineUserId: string }) => m.deviceCode === ev.edgeDeviceId)
        ?? s?.machineUsers?.[0];
      const enNo = mu?.machineUserId ? String(mu.machineUserId).padStart(8, '0') : '00000000';
      const mode = ev.identifierUsed === 'rfid' ? 30 : 1;  // 1=face, 30=card
      const dt   = new Date(ev.eventTime)
        .toISOString().replace('T', ' ').substring(0, 19);

      return [idx + 1, 3, enNo, '', 3, mode, 1, 0, 0, dt].join('\t');
    });

    const content = [header, ...rows].join('\r\n');

    // Filename: ALOG_001.txt → ALOG_012.txt based on the selected month
    const monthNum = from ? new Date(from).getMonth() + 1 : new Date().getMonth() + 1;
    const fileName = `ALOG_0${String(monthNum).padStart(2, '0')}.txt`;

    void reply.header('Content-Type', 'text/plain; charset=utf-8');
    void reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
    return reply.send(content);
  });
};

export default reportsRoutes;
