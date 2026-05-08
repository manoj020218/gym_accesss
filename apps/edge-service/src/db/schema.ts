import type Database from 'better-sqlite3';

export function applySchema(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    -- Members cache (pulled from VPS)
    CREATE TABLE IF NOT EXISTS local_members (
      member_id         TEXT PRIMARY KEY,
      member_code       TEXT NOT NULL,
      rfid_card_id      TEXT,
      qr_token          TEXT,
      status            TEXT NOT NULL,
      active_until      TEXT NOT NULL,
      plan_type         TEXT NOT NULL,
      allowed_zones     TEXT NOT NULL,   -- JSON array
      allowed_branch_ids TEXT NOT NULL,  -- JSON array
      has_dues          INTEGER NOT NULL DEFAULT 0,
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_lm_rfid ON local_members(rfid_card_id);
    CREATE INDEX IF NOT EXISTS idx_lm_qr   ON local_members(qr_token);

    -- Staff cache
    CREATE TABLE IF NOT EXISTS local_staff (
      staff_id       TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      role           TEXT NOT NULL,
      allowed_zones  TEXT NOT NULL,  -- JSON array
      shift_start    TEXT NOT NULL,
      shift_end      TEXT NOT NULL,
      rfid_card_id   TEXT,
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ls_rfid ON local_staff(rfid_card_id);

    -- Access policies cache
    CREATE TABLE IF NOT EXISTS local_access_policies (
      zone                    TEXT PRIMARY KEY,
      allowed_plan_types      TEXT NOT NULL,  -- JSON array
      time_windows            TEXT NOT NULL,  -- JSON array
      anti_passback_enabled   INTEGER NOT NULL DEFAULT 0,
      updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Blocklist
    CREATE TABLE IF NOT EXISTS local_blocklist (
      subject_id TEXT PRIMARY KEY,
      added_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Outbound event queue (append-only, never update)
    CREATE TABLE IF NOT EXISTS local_events (
      local_seq       INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id        TEXT NOT NULL UNIQUE,
      device_id       TEXT NOT NULL,
      branch_id       TEXT NOT NULL,
      zone            TEXT NOT NULL,
      subject_type    TEXT NOT NULL,
      subject_id      TEXT NOT NULL,
      subject_name    TEXT,
      decision        TEXT NOT NULL,
      deny_reason     TEXT,
      identifier_used TEXT NOT NULL,
      event_time      TEXT NOT NULL,
      sync_state      TEXT NOT NULL DEFAULT 'pending',
      synced_at       TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_le_sync  ON local_events(sync_state);
    CREATE INDEX IF NOT EXISTS idx_le_time  ON local_events(event_time);

    -- Sync state
    CREATE TABLE IF NOT EXISTS local_sync_state (
      id                    INTEGER PRIMARY KEY CHECK (id = 1),  -- singleton row
      last_policy_version   INTEGER NOT NULL DEFAULT 0,
      last_event_ack_cursor INTEGER NOT NULL DEFAULT 0,
      last_heartbeat_at     TEXT,
      last_pull_at          TEXT
    );
    INSERT OR IGNORE INTO local_sync_state (id) VALUES (1);

    -- Device config
    CREATE TABLE IF NOT EXISTS local_device_config (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}
