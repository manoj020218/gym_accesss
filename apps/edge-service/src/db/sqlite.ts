import BetterSqlite3 from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname }   from 'path';
import { applySchema } from './schema.js';
import type {
  EdgeMemberRecord, EdgeStaffRecord, EdgeAccessPolicy,
} from '@edge-gym/shared-types';

export class EdgeDB {
  private db: BetterSqlite3.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new BetterSqlite3(dbPath);
    applySchema(this.db);
  }

  // ── Member lookup ─────────────────────────────────────────────────────────
  getMemberByRfid(rfidCardId: string): EdgeMemberRecord | undefined {
    const row = this.db.prepare('SELECT * FROM local_members WHERE rfid_card_id = ?').get(rfidCardId) as Record<string, unknown> | undefined;
    return row ? this.rowToMember(row) : undefined;
  }

  getMemberByQr(qrToken: string): EdgeMemberRecord | undefined {
    const row = this.db.prepare('SELECT * FROM local_members WHERE qr_token = ?').get(qrToken) as Record<string, unknown> | undefined;
    return row ? this.rowToMember(row) : undefined;
  }

  getMemberById(memberId: string): EdgeMemberRecord | undefined {
    const row = this.db.prepare('SELECT * FROM local_members WHERE member_id = ?').get(memberId) as Record<string, unknown> | undefined;
    return row ? this.rowToMember(row) : undefined;
  }

  // ── Staff lookup ──────────────────────────────────────────────────────────
  getStaffByRfid(rfidCardId: string): EdgeStaffRecord | undefined {
    const row = this.db.prepare('SELECT * FROM local_staff WHERE rfid_card_id = ?').get(rfidCardId) as Record<string, unknown> | undefined;
    return row ? this.rowToStaff(row) : undefined;
  }

  // ── Blocklist ─────────────────────────────────────────────────────────────
  getBlocklist(): Set<string> {
    const rows = this.db.prepare('SELECT subject_id FROM local_blocklist').all() as Array<{ subject_id: string }>;
    return new Set(rows.map(r => r.subject_id));
  }

  // ── Policies ──────────────────────────────────────────────────────────────
  getPolicies(): EdgeAccessPolicy[] {
    const rows = this.db.prepare('SELECT * FROM local_access_policies').all() as Array<Record<string, unknown>>;
    return rows.map(r => ({
      zone:                  r['zone'] as string,
      allowedPlanTypes:      JSON.parse(r['allowed_plan_types'] as string) as string[],
      timeWindows:           JSON.parse(r['time_windows'] as string) as EdgeAccessPolicy['timeWindows'],
      antiPassbackEnabled:   Boolean(r['anti_passback_enabled']),
    }));
  }

  // ── Blocklist upsert (called during pull) ────────────────────────────────
  upsertBlocklist(memberIds: string[]): void {
    // Replace the entire blocklist atomically
    const replace = this.db.transaction((ids: string[]) => {
      this.db.prepare('DELETE FROM local_blocklist').run();
      const insert = this.db.prepare(
        `INSERT OR IGNORE INTO local_blocklist (subject_id) VALUES (?)`,
      );
      for (const id of ids) insert.run(id);
    });
    replace(memberIds);
  }

  // ── Event queue ───────────────────────────────────────────────────────────
  appendEvent(ev: {
    eventId: string; deviceId: string; branchId: string; zone: string;
    subjectType: string; subjectId: string; subjectName?: string;
    decision: string; denyReason?: string; identifierUsed: string; eventTime: string;
  }): number {
    const stmt = this.db.prepare(`
      INSERT INTO local_events
        (event_id,device_id,branch_id,zone,subject_type,subject_id,subject_name,
         decision,deny_reason,identifier_used,event_time)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `);
    const info = stmt.run(
      ev.eventId, ev.deviceId, ev.branchId, ev.zone, ev.subjectType, ev.subjectId,
      ev.subjectName ?? null, ev.decision, ev.denyReason ?? null, ev.identifierUsed, ev.eventTime,
    );
    return info.lastInsertRowid as number;
  }

  getPendingEvents(limit = 100): Array<Record<string, unknown>> {
    return this.db.prepare(
      `SELECT * FROM local_events WHERE sync_state = 'pending' ORDER BY local_seq LIMIT ?`,
    ).all(limit) as Array<Record<string, unknown>>;
  }

  markEventsSynced(fromSeq: number, toSeq: number): void {
    this.db.prepare(`
      UPDATE local_events SET sync_state = 'synced', synced_at = datetime('now')
      WHERE local_seq BETWEEN ? AND ?
    `).run(fromSeq, toSeq);
  }

  // ── Sync state ────────────────────────────────────────────────────────────
  getSyncState(): { lastPolicyVersion: number; lastEventAckCursor: number } {
    const row = this.db.prepare('SELECT * FROM local_sync_state WHERE id = 1').get() as Record<string, unknown>;
    return {
      lastPolicyVersion:   Number(row['last_policy_version'] ?? 0),
      lastEventAckCursor:  Number(row['last_event_ack_cursor'] ?? 0),
    };
  }

  updateAckCursor(cursor: number): void {
    this.db.prepare(`
      UPDATE local_sync_state SET last_event_ack_cursor = ?, last_heartbeat_at = datetime('now') WHERE id = 1
    `).run(cursor);
  }

  // ── Master data upsert (used during pull) ─────────────────────────────────
  upsertMembers(members: EdgeMemberRecord[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO local_members
        (member_id,member_code,rfid_card_id,qr_token,status,active_until,plan_type,
         allowed_zones,allowed_branch_ids,has_dues)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(member_id) DO UPDATE SET
        member_code=excluded.member_code, rfid_card_id=excluded.rfid_card_id,
        qr_token=excluded.qr_token, status=excluded.status,
        active_until=excluded.active_until, plan_type=excluded.plan_type,
        allowed_zones=excluded.allowed_zones, allowed_branch_ids=excluded.allowed_branch_ids,
        has_dues=excluded.has_dues, updated_at=datetime('now')
    `);
    const insertMany = this.db.transaction((rows: EdgeMemberRecord[]) => {
      for (const m of rows) {
        stmt.run(
          m.memberId, m.memberCode, m.rfidCardId ?? null, m.qrToken ?? null,
          m.status, m.activeUntil, m.planType,
          JSON.stringify(m.allowedZones), JSON.stringify(m.allowedBranchIds),
          m.hasDues ? 1 : 0,
        );
      }
    });
    insertMany(members);
  }

  // ── Private helpers ───────────────────────────────────────────────────────
  private rowToMember(r: Record<string, unknown>): EdgeMemberRecord {
    return {
      memberId:         r['member_id'] as string,
      memberCode:       r['member_code'] as string,
      rfidCardId:       r['rfid_card_id'] as string | undefined,
      qrToken:          r['qr_token'] as string | undefined,
      status:           r['status'] as EdgeMemberRecord['status'],
      activeUntil:      r['active_until'] as string,
      planType:         r['plan_type'] as string,
      allowedZones:     JSON.parse(r['allowed_zones'] as string) as EdgeMemberRecord['allowedZones'],
      allowedBranchIds: JSON.parse(r['allowed_branch_ids'] as string) as string[],
      hasDues:          Boolean(r['has_dues']),
    };
  }

  private rowToStaff(r: Record<string, unknown>): EdgeStaffRecord {
    return {
      staffId:      r['staff_id'] as string,
      name:         r['name'] as string,
      role:         r['role'] as string,
      allowedZones: JSON.parse(r['allowed_zones'] as string) as EdgeStaffRecord['allowedZones'],
      shiftStart:   r['shift_start'] as string,
      shiftEnd:     r['shift_end'] as string,
      rfidCardId:   r['rfid_card_id'] as string | undefined,
    };
  }

  close(): void { this.db.close(); }
}
