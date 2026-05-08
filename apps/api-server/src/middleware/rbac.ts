import type { FastifyRequest, FastifyReply } from 'fastify';
import type { JwtPayload } from '@edge-gym/shared-types';
import { StaffRole } from '@edge-gym/shared-types';

declare module 'fastify' {
  interface FastifyRequest {
    actor: JwtPayload;
  }
}

export function requireRoles(...roles: StaffRole[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const actor = req.actor;
    if (!actor) {
      return reply.status(401).send({ error: 'Unauthorized', message: 'Missing authentication' });
    }
    if (!roles.includes(actor.role as StaffRole)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Insufficient role' });
    }
  };
}

export function requireBranchAccess(getBranchId: (req: FastifyRequest) => string | undefined) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const actor = req.actor;
    if (!actor) return reply.status(401).send({ error: 'Unauthorized' });
    if (actor.role === StaffRole.Owner) return;

    const branchId = getBranchId(req);
    if (branchId && !actor.branchIds.includes(branchId)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'No access to this branch' });
    }
  };
}
