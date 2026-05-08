import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AccessEvent } from '../models/AccessEvent.js';
import { AccessDecision, Zone, SubjectType } from '@edge-gym/shared-types';
import { StaffRole } from '@edge-gym/shared-types';

const ListQuery = z.object({
  branchId:    z.string().optional(),
  memberId:    z.string().optional(),
  deviceId:    z.string().optional(),
  zone:        z.nativeEnum(Zone).optional(),
  decision:    z.nativeEnum(AccessDecision).optional(),
  subjectType: z.nativeEnum(SubjectType).optional(),
  from:        z.string().optional(),
  to:          z.string().optional(),
  page:        z.coerce.number().default(1),
  limit:       z.coerce.number().default(50),
});

const AttendanceQuery = z.object({
  from:  z.string().optional(),
  to:    z.string().optional(),
});

const accessRoutes: FastifyPluginAsync = async (fastify) => {

  // GET /access/events
  fastify.get('/access/events', async (req, reply) => {
    const q = ListQuery.parse(req.query);
    const filter: Record<string, unknown> = {};

    if (req.actor.role !== StaffRole.Owner) {
      filter['branchId'] = { $in: req.actor.branchIds };
    } else if (q.branchId) {
      filter['branchId'] = q.branchId;
    }

    if (q.memberId)    filter['subjectId']    = q.memberId;
    if (q.deviceId)    filter['edgeDeviceId'] = q.deviceId;
    if (q.zone)        filter['zone']         = q.zone;
    if (q.decision)    filter['decision']     = q.decision;
    if (q.subjectType) filter['subjectType']  = q.subjectType;

    if (q.from || q.to) {
      const timeFilter: Record<string, unknown> = {};
      if (q.from) timeFilter['$gte'] = new Date(q.from);
      if (q.to)   timeFilter['$lte'] = new Date(q.to);
      filter['eventTime'] = timeFilter;
    }

    const skip  = (q.page - 1) * q.limit;
    const total = await AccessEvent.countDocuments(filter);
    const data  = await AccessEvent.find(filter).skip(skip).limit(q.limit).sort({ eventTime: -1 });

    return reply.send({ data, total, page: q.page, limit: q.limit, pages: Math.ceil(total / q.limit) });
  });

  // GET /access/attendance/:memberId — aggregate check-in/out sessions from main_entry events
  fastify.get<{ Params: { memberId: string }; Querystring: z.infer<typeof AttendanceQuery> }>(
    '/access/attendance/:memberId',
    async (req, reply) => {
      const q = AttendanceQuery.parse(req.query);
      const filter: Record<string, unknown> = {
        subjectId: req.params.memberId,
        decision:  AccessDecision.Allow,
      };

      if (q.from || q.to) {
        const timeFilter: Record<string, unknown> = {};
        if (q.from) timeFilter['$gte'] = new Date(q.from);
        if (q.to)   timeFilter['$lte'] = new Date(q.to);
        filter['eventTime'] = timeFilter;
      }

      const events = await AccessEvent.find(filter).sort({ eventTime: 1 }).lean();

      // Each main_entry allow event starts a new visit session
      const sessions: Array<{
        checkIn: Date;
        checkOut?: Date;
        durationMinutes?: number;
        zone: string;
      }> = [];

      let current: { checkIn: Date; zone: string } | null = null;

      for (const ev of events) {
        if (ev.zone === Zone.MainEntry) {
          if (current) {
            const durationMinutes = Math.round(
              (ev.eventTime.getTime() - current.checkIn.getTime()) / 60_000,
            );
            sessions.push({ checkIn: current.checkIn, checkOut: ev.eventTime, durationMinutes, zone: current.zone });
          }
          current = { checkIn: ev.eventTime, zone: ev.zone };
        }
      }

      if (current) sessions.push({ checkIn: current.checkIn, zone: current.zone });

      return reply.send({
        memberId:    req.params.memberId,
        totalVisits: sessions.length,
        sessions,
      });
    },
  );
};

export default accessRoutes;
