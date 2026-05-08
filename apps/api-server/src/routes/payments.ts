import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Payment } from '../models/Payment.js';
import { AuditLog } from '../models/AuditLog.js';
import { PaymentMode } from '@edge-gym/shared-types';

const CreateBody = z.object({
  memberId:    z.string(),
  branchId:    z.string(),
  amount:      z.number().positive(),
  discount:    z.number().min(0).default(0),
  gstAmount:   z.number().min(0).default(0),
  mode:        z.nativeEnum(PaymentMode),
  referenceNo: z.string().optional(),
  notes:       z.string().optional(),
});

const ListQuery = z.object({
  branchId: z.string().optional(),
  memberId: z.string().optional(),
  mode:     z.nativeEnum(PaymentMode).optional(),
  from:     z.string().optional(),
  to:       z.string().optional(),
  page:     z.coerce.number().default(1),
  limit:    z.coerce.number().default(20),
});

function buildDateFilter(from?: string, to?: string): Record<string, Date> | undefined {
  if (!from && !to) return undefined;
  const f: Record<string, Date> = {};
  if (from) f['$gte'] = new Date(from);
  if (to)   f['$lte'] = new Date(to);
  return f;
}

const paymentRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /payments
  fastify.get('/payments', async (req, reply) => {
    const q = ListQuery.parse(req.query);
    const filter: Record<string, unknown> = {};

    if (req.actor.role !== 'owner') {
      filter['branchId'] = { $in: req.actor.branchIds };
    } else if (q.branchId) {
      filter['branchId'] = q.branchId;
    }

    if (q.memberId) filter['memberId'] = q.memberId;
    if (q.mode)     filter['mode']     = q.mode;

    const dateFilter = buildDateFilter(q.from, q.to);
    if (dateFilter) filter['paidAt'] = dateFilter;

    const skip  = (q.page - 1) * q.limit;
    const total = await Payment.countDocuments(filter);
    const data  = await Payment.find(filter).skip(skip).limit(q.limit).sort({ paidAt: -1 });

    return reply.send({ data, total, page: q.page, limit: q.limit, pages: Math.ceil(total / q.limit) });
  });

  // GET /payments/summary — aggregate revenue totals
  fastify.get('/payments/summary', async (req, reply) => {
    const q = ListQuery.parse(req.query);
    const match: Record<string, unknown> = {};

    if (req.actor.role !== 'owner') {
      match['branchId'] = { $in: req.actor.branchIds };
    } else if (q.branchId) {
      match['branchId'] = q.branchId;
    }

    const dateFilter = buildDateFilter(q.from, q.to);
    if (dateFilter) match['paidAt'] = dateFilter;

    const [summary] = await Payment.aggregate([
      { $match: match },
      {
        $group: {
          _id:           null,
          totalRevenue:  { $sum: '$totalAmount' },
          totalDiscount: { $sum: '$discount' },
          totalGst:      { $sum: '$gstAmount' },
          count:         { $sum: 1 },
        },
      },
    ]);

    const byMode = await Payment.aggregate([
      { $match: match },
      { $group: { _id: '$mode', total: { $sum: '$totalAmount' }, count: { $sum: 1 } } },
    ]);

    return reply.send({
      ...(summary ?? { totalRevenue: 0, totalDiscount: 0, totalGst: 0, count: 0 }),
      byMode,
    });
  });

  // GET /payments/:id — receipt lookup
  fastify.get<{ Params: { id: string } }>('/payments/:id', async (req, reply) => {
    const payment = await Payment.findById(req.params.id);
    if (!payment) return reply.status(404).send({ error: 'Not Found' });
    return reply.send(payment);
  });

  // POST /payments — standalone payment (locker, guest day pass, etc.)
  fastify.post<{ Body: z.infer<typeof CreateBody> }>('/payments', async (req, reply) => {
    const body    = CreateBody.parse(req.body);
    const total   = body.amount - body.discount + body.gstAmount;
    const payment = await Payment.create({
      ...body,
      totalAmount: total,
      collectedBy: req.actor.sub,
      paidAt:      new Date(),
      receiptNo:   `RCP${Date.now()}`,
    });
    await AuditLog.create({
      actorId: req.actor.sub, actorEmail: req.actor.email, actorRole: req.actor.role,
      branchId: body.branchId, action: 'CREATE', resourceType: 'Payment', resourceId: payment.id,
      after: payment.toObject(), ip: req.ip,
    });
    return reply.status(201).send(payment);
  });
};

export default paymentRoutes;
