import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { Product } from '../models/Product.js';
import { InventoryTransaction } from '../models/InventoryTransaction.js';
import { Payment } from '../models/Payment.js';
import { AuditLog } from '../models/AuditLog.js';
import { requireRoles } from '../middleware/rbac.js';
import { StaffRole, PaymentMode } from '@edge-gym/shared-types';

const CreateBody = z.object({
  branchId:      z.string(),
  name:          z.string().min(1),
  category:      z.string().optional(),
  sku:           z.string().optional(),
  price:         z.number().positive(),
  gstPercent:    z.number().min(0).max(100).default(18),
  gstIncluded:   z.boolean().default(false),
  photos:        z.string().array().max(3).optional(),
  stockQty:      z.number().int().min(0).default(0),
  minStockLevel: z.number().int().min(0).default(5),
});

const UpdateBody = CreateBody.omit({ branchId: true }).partial().extend({
  isActive:         z.boolean().optional(),
  broadcastEnabled: z.boolean().optional(),
});

const StockInBody = z.object({
  qty:   z.number().int().positive(),
  price: z.number().positive().optional(),
  notes: z.string().optional(),
});

const SellBody = z.object({
  qty:         z.number().int().positive(),
  memberId:    z.string().optional(),
  paymentMode: z.nativeEnum(PaymentMode),
  discount:    z.number().min(0).default(0),
  notes:       z.string().optional(),
});

const ListQuery = z.object({
  branchId:  z.string().optional(),
  category:  z.string().optional(),
  lowStock:  z.coerce.boolean().optional(),
  isActive:  z.coerce.boolean().optional(),
  broadcast: z.coerce.boolean().optional(),
  page:      z.coerce.number().default(1),
  limit:     z.coerce.number().default(20),
});

const productRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /products
  fastify.get('/products', async (req, reply) => {
    const q = ListQuery.parse(req.query);
    const filter: Record<string, unknown> = {};

    if (req.actor.role !== StaffRole.Owner) {
      filter['branchId'] = { $in: req.actor.branchIds };
    } else if (q.branchId) {
      filter['branchId'] = q.branchId;
    }

    if (q.category)                    filter['category'] = q.category;
    if (q.isActive !== undefined)      filter['isActive'] = q.isActive;
    if (q.broadcast !== undefined)     filter['broadcastEnabled'] = q.broadcast;
    if (q.lowStock) {
      filter['$expr'] = { $lte: ['$stockQty', '$minStockLevel'] };
    }

    const skip  = (q.page - 1) * q.limit;
    const total = await Product.countDocuments(filter);
    const data  = await Product.find(filter).skip(skip).limit(q.limit).sort({ name: 1 });

    return reply.send({ data, total, page: q.page, limit: q.limit, pages: Math.ceil(total / q.limit) });
  });

  // POST /products
  fastify.post<{ Body: z.infer<typeof CreateBody> }>(
    '/products',
    { preHandler: requireRoles(StaffRole.Owner, StaffRole.Manager) },
    async (req, reply) => {
      const body    = CreateBody.parse(req.body);
      const product = await Product.create({ ...body, isActive: true });
      await AuditLog.create({
        actorId: req.actor.sub, actorEmail: req.actor.email, actorRole: req.actor.role,
        branchId: body.branchId, action: 'CREATE', resourceType: 'Product', resourceId: product.id,
        after: product.toObject(), ip: req.ip,
      });
      return reply.status(201).send(product);
    },
  );

  // GET /products/:id
  fastify.get<{ Params: { id: string } }>('/products/:id', async (req, reply) => {
    const product = await Product.findById(req.params.id);
    if (!product) return reply.status(404).send({ error: 'Not Found' });
    return reply.send(product);
  });

  // PUT /products/:id
  fastify.put<{ Params: { id: string }; Body: z.infer<typeof UpdateBody> }>(
    '/products/:id',
    { preHandler: requireRoles(StaffRole.Owner, StaffRole.Manager) },
    async (req, reply) => {
      const body   = UpdateBody.parse(req.body);
      const before = await Product.findById(req.params.id);
      if (!before) return reply.status(404).send({ error: 'Not Found' });
      const updated = await Product.findByIdAndUpdate(req.params.id, body, { new: true });
      await AuditLog.create({
        actorId: req.actor.sub, actorEmail: req.actor.email, actorRole: req.actor.role,
        action: 'UPDATE', resourceType: 'Product', resourceId: req.params.id,
        before: before.toObject(), after: updated?.toObject(), ip: req.ip,
      });
      return reply.send(updated);
    },
  );

  // DELETE /products/:id — soft-delete
  fastify.delete<{ Params: { id: string } }>(
    '/products/:id',
    { preHandler: requireRoles(StaffRole.Owner, StaffRole.Manager) },
    async (req, reply) => {
      const product = await Product.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
      if (!product) return reply.status(404).send({ error: 'Not Found' });
      return reply.status(204).send();
    },
  );

  // PATCH /products/:id/broadcast — toggle broadcast on/off
  fastify.patch<{ Params: { id: string }; Body: { enabled: boolean } }>(
    '/products/:id/broadcast',
    { preHandler: requireRoles(StaffRole.Owner, StaffRole.Manager) },
    async (req, reply) => {
      const product = await Product.findByIdAndUpdate(
        req.params.id,
        { broadcastEnabled: req.body.enabled },
        { new: true },
      );
      if (!product) return reply.status(404).send({ error: 'Not Found' });
      return reply.send(product);
    },
  );

  // POST /products/:id/stock-in — restock / purchase
  fastify.post<{ Params: { id: string }; Body: z.infer<typeof StockInBody> }>(
    '/products/:id/stock-in',
    { preHandler: requireRoles(StaffRole.Owner, StaffRole.Manager, StaffRole.Accountant) },
    async (req, reply) => {
      const body    = StockInBody.parse(req.body);
      const product = await Product.findById(req.params.id);
      if (!product) return reply.status(404).send({ error: 'Not Found' });

      const unitPrice = body.price ?? product.price;
      product.stockQty += body.qty;
      await product.save();

      const tx = await InventoryTransaction.create({
        branchId:    product.branchId,
        productId:   product.id,
        type:        'purchase',
        qty:         body.qty,
        unitPrice,
        totalAmount: body.qty * unitPrice,
        doneBy:      req.actor.sub,
        notes:       body.notes,
      });

      return reply.status(201).send({ product, transaction: tx });
    },
  );

  // POST /products/:id/sell — POS sale
  fastify.post<{ Params: { id: string }; Body: z.infer<typeof SellBody> }>(
    '/products/:id/sell',
    async (req, reply) => {
      const body    = SellBody.parse(req.body);
      const product = await Product.findById(req.params.id);
      if (!product) return reply.status(404).send({ error: 'Not Found' });
      if (!product.isActive) return reply.status(400).send({ error: 'Product is inactive' });
      if (product.stockQty < body.qty) {
        return reply.status(400).send({ error: 'Insufficient stock', available: product.stockQty });
      }

      // If price is GST-inclusive, back-calculate the base price
      const basePrice  = product.gstIncluded
        ? product.price / (1 + product.gstPercent / 100)
        : product.price;
      const subtotal   = basePrice * body.qty;
      const discounted = subtotal - body.discount;
      const gstAmount  = discounted * product.gstPercent / 100;
      const total      = discounted + gstAmount;

      product.stockQty -= body.qty;
      await product.save();

      const [tx, payment] = await Promise.all([
        InventoryTransaction.create({
          branchId:    product.branchId,
          productId:   product.id,
          type:        'sale',
          qty:         body.qty,
          unitPrice:   product.price,
          totalAmount: total,
          memberId:    body.memberId,
          doneBy:      req.actor.sub,
          notes:       body.notes,
        }),
        Payment.create({
          memberId:     body.memberId ?? 'walk-in',
          branchId:     product.branchId,
          amount:       subtotal,
          discount:     body.discount,
          gstAmount,
          totalAmount:  total,
          mode:         body.paymentMode,
          collectedBy:  req.actor.sub,
          paidAt:       new Date(),
          receiptNo:    `SALE${Date.now()}`,
          notes:        `Product: ${product.name} x${body.qty}`,
        }),
      ]);

      return reply.status(201).send({ transaction: tx, payment, remainingStock: product.stockQty });
    },
  );
};

export default productRoutes;
