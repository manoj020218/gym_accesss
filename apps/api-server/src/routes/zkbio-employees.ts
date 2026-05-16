import type { FastifyPluginAsync } from 'fastify';
import { ZkbioEmployee, DEFAULT_PASS_DATE, DEFAULT_PASS_TIME } from '../models/ZkbioEmployee.js';
import { Member } from '../models/Member.js';

// Routes for managing ZKBio face-recognition machine employees.
//
// Import flow:
//   1. Browser (on gym LAN) calls GET http://192.168.1.92/getEmployeeList → gets face data from machine
//   2. Browser POSTs that data to POST /api/v1/zkbio-employees/import (via HTTPS to cloud)
//   3. Machine polls POST /devicePass/selectPassInfo (handled in zkbio-cloud.ts) → gets the list back
//   4. Machine uses the list to recognize faces → pushes attendance records

const zkbioEmployeesRoutes: FastifyPluginAsync = async (fastify) => {

  // ── Import employees from machine's /getEmployeeList ─────────────────────
  fastify.post(
    '/zkbio-employees/import',
    { schema: { body: {} } },
    async (req, reply) => {
      const body = (req.body ?? {}) as { deviceSn?: string; employees?: unknown[] };
      if (!body.deviceSn || !Array.isArray(body.employees)) {
        return reply.status(400).send({ error: 'deviceSn and employees[] required' });
      }

      let inserted = 0;
      let updated  = 0;
      let skipped  = 0;

      for (const emp of body.employees as Array<Record<string, unknown>>) {
        const machineUserId = emp.userid as string | undefined;
        const name          = emp.name  as string | undefined;
        if (!machineUserId || !name) { skipped++; continue; }

        const rawPassDate = emp.pass_date as string | undefined;
        const rawPassTime = emp.pass_time as string | undefined;
        const $set: Record<string, unknown> = {
          name,
          // Machine sends "0" when no schedule is configured — treat as "always open"
          passDate:   (!rawPassDate || rawPassDate === '0') ? DEFAULT_PASS_DATE : rawPassDate,
          passTime:   (!rawPassTime || rawPassTime === '0') ? DEFAULT_PASS_TIME : rawPassTime,
          importedAt: new Date(),
        };
        if (emp.pic_large) $set.picLarge = emp.pic_large as string;

        const result = await ZkbioEmployee.updateOne(
          { deviceSn: body.deviceSn, machineUserId },
          { $set, $setOnInsert: { deviceSn: body.deviceSn, machineUserId } },
          { upsert: true },
        );
        if (result.upsertedCount) inserted++;
        else if (result.modifiedCount) updated++;
      }

      fastify.log.info(
        { deviceSn: body.deviceSn, inserted, updated, skipped },
        'ZKBio employee import',
      );
      return reply.send({ inserted, updated, skipped, total: body.employees.length });
    },
  );

  // ── List imported employees ───────────────────────────────────────────────
  fastify.get(
    '/zkbio-employees',
    { schema: { querystring: {} } },
    async (req, reply) => {
      const { deviceSn } = (req.query ?? {}) as Record<string, string>;
      const filter = deviceSn ? { deviceSn } : {};
      // Exclude picLarge to keep the response small
      const employees = await ZkbioEmployee.find(filter, { picLarge: 0 }).lean();
      return reply.send({ employees });
    },
  );

  // ── Get all active ZkbioEmployee records for a member ─────────────────────
  fastify.get('/zkbio-employees/member/:memberId', async (req, reply) => {
    const { memberId } = req.params as { memberId: string };
    const employees = await ZkbioEmployee.find(
      { memberId, deletedAt: { $exists: false } },
      { picLarge: 0 },
    ).lean();
    return reply.send({ employees });
  });

  // ── Enroll a member on a ZKBio machine (web-admin side enrollment) ─────────
  // Creates a new ZkbioEmployee with picLarge so the machine syncs it via selectPassInfo.
  fastify.post('/zkbio-employees/enroll', { schema: { body: {} } }, async (req, reply) => {
    const body = (req.body ?? {}) as { deviceSn?: string; memberId?: string; picLarge?: string };
    if (!body.deviceSn || !body.memberId || !body.picLarge) {
      return reply.status(400).send({ error: 'deviceSn, memberId, picLarge required' });
    }

    const member = await Member.findById(body.memberId);
    if (!member) return reply.status(404).send({ error: 'Member not found' });

    // Auto-assign the next available integer machineUserId for this device
    const existing = await ZkbioEmployee.find({ deviceSn: body.deviceSn }, { machineUserId: 1 }).lean();
    const usedIds  = new Set(existing.map(e => parseInt(e.machineUserId, 10)).filter(n => !isNaN(n)));
    let next = 1;
    while (usedIds.has(next)) next++;

    const name = `${member.firstName} ${member.lastName}`.slice(0, 24);
    const emp  = await ZkbioEmployee.create({
      deviceSn:      body.deviceSn,
      machineUserId: String(next),
      name,
      picLarge:      body.picLarge,
      memberId:      body.memberId,
      importedAt:    new Date(),
    });

    await Member.findByIdAndUpdate(body.memberId, { $set: { faceEnrolled: true } });

    fastify.log.info(
      { deviceSn: body.deviceSn, machineUserId: String(next), memberId: body.memberId },
      'ZKBio enroll: new employee created',
    );
    return reply.status(201).send({ employee: { ...emp.toObject(), picLarge: undefined } });
  });

  // ── Soft-delete a ZkbioEmployee (remove from machine) ─────────────────────
  // Sets deletedAt; machine picks it up via selectDeleteInfo and removes the face template.
  fastify.delete(
    '/zkbio-employees/:deviceSn/:machineUserId',
    async (req, reply) => {
      const { deviceSn, machineUserId } = req.params as Record<string, string>;
      const emp = await ZkbioEmployee.findOneAndUpdate(
        { deviceSn, machineUserId, deletedAt: { $exists: false } },
        { $set: { deletedAt: new Date() } },
        { new: true },
      );
      if (!emp) return reply.status(404).send({ error: 'Employee not found' });

      // Clear faceEnrolled if member has no remaining active enrollments
      if (emp.memberId) {
        const remaining = await ZkbioEmployee.countDocuments({
          memberId: emp.memberId, deletedAt: { $exists: false },
        });
        if (!remaining) await Member.findByIdAndUpdate(emp.memberId, { $set: { faceEnrolled: false } });
      }

      return reply.send({ ok: true });
    },
  );

  // ── Link or unlink an imported employee to/from a Member ──────────────────
  // Send { memberId: "<id>" } to link; { memberId: null } to unlink.
  fastify.patch(
    '/zkbio-employees/:deviceSn/:machineUserId/link',
    { schema: { body: {} } },
    async (req, reply) => {
      const { deviceSn, machineUserId } = req.params as Record<string, string>;
      const body = (req.body ?? {}) as { memberId?: string | null };
      if (!('memberId' in body)) return reply.status(400).send({ error: 'memberId required (null to unlink)' });

      const emp = await ZkbioEmployee.findOneAndUpdate(
        { deviceSn, machineUserId },
        { $set: { memberId: body.memberId ?? undefined }, ...(body.memberId ? {} : { $unset: { memberId: 1 } }) },
        { new: true, projection: { picLarge: 0 } },
      );
      if (!emp) return reply.status(404).send({ error: 'Employee not found' });

      // Keep Member.faceEnrolled in sync
      if (body.memberId) {
        await Member.findByIdAndUpdate(body.memberId, { $set: { faceEnrolled: true } });
      }

      return reply.send({ employee: emp });
    },
  );
};

export default zkbioEmployeesRoutes;
