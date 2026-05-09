import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Payment }     from '../models/Payment.js';
import { Membership }  from '../models/Membership.js';
import { Member }      from '../models/Member.js';
import { AccessEvent } from '../models/AccessEvent.js';
import { Product }     from '../models/Product.js';
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
        _id: { date: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt' } }, branchId: '$branchId' },
        totalAmount: { $sum: '$totalAmount' },
        count:       { $sum: 1 },
      }},
      { $sort: { '_id.date': -1 } },
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
      $expr: { $lte: ['$currentStock', '$minStockLevel'] },
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
};

export default reportsRoutes;
