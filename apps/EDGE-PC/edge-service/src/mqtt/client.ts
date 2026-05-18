/**
 * MQTT Live-Access Listener
 *
 * Connects to a local Mosquitto broker and subscribes to the U5 machine's
 * info topic. When a face-scan event arrives (type:"note"), it is immediately
 * written to the SQLite event queue so the push worker can forward it to VPS.
 *
 * The U5 machine publishes to:  info_topic + token + device_sn
 * e.g.  "info/mytoken/ZY20240703003"
 *
 * Attendance record fields (MQTT, from official 3.0 API doc):
 *   employeeId  — ID we enrolled the person with (= memberCode, since id_number === employeeId)
 *   employeeName
 *   noteTime    — "yyyy-MM-dd HH:mm:ss"
 *   noteImg     — base64 JPEG captured at scan moment
 *   notePass    — 0:failed 1:pass 2:no-permission 4:expired 5:count-exhausted
 *   noteWay     — 0:face 1:card
 *   notePity    — match similarity (0-1)
 *   humTemp     — body temperature
 */

import mqtt, { type MqttClient } from 'mqtt';
import type { EdgeDB } from '../db/sqlite.js';
import type { BaseLogger } from 'pino';
import { config as edgeConfig } from '../config.js';

export interface MqttLiveConfig {
  brokerUrl: string;   // mqtt://localhost:1883
  infoTopic: string;   // info/TOKEN/ZY20240703003
  username?: string;
  password?: string;
}

type NotePayload = {
  type: 'note';
  data: {
    deviceId?:    string;
    employeeId?:  string;
    employeeName?: string;
    noteTime?:    string;
    noteImg?:     string;
    notePass?:    number;
    noteWay?:     number;
    notePity?:    number;
    humTemp?:     number;
  };
};

export class MqttAttendanceListener {
  private client: MqttClient | null = null;
  private currentTopic = '';
  private db: EdgeDB | null = null;
  private log: BaseLogger | null = null;

  /** Start or restart with new config. Safe to call multiple times. */
  apply(cfg: MqttLiveConfig, db: EdgeDB, log: BaseLogger): void {
    this.db  = db;
    this.log = log;

    // No-op if nothing changed
    if (
      this.client?.connected &&
      this.currentTopic === cfg.infoTopic
    ) return;

    // Disconnect existing client gracefully
    if (this.client) {
      this.client.end(true);
      this.client = null;
    }

    this.currentTopic = cfg.infoTopic;

    const client = mqtt.connect(cfg.brokerUrl, {
      clientId:        `edge_${edgeConfig.EDGE_DEVICE_ID}_${Date.now()}`,
      username:        cfg.username || undefined,
      password:        cfg.password || undefined,
      reconnectPeriod: 10_000,
      connectTimeout:  15_000,
      clean:           true,
    });

    client.on('connect', () => {
      log.info({ topic: cfg.infoTopic }, '[mqtt] Connected — subscribing to live-access topic');
      client.subscribe(cfg.infoTopic, { qos: 1 }, (err) => {
        if (err) log.error({ err }, '[mqtt] Subscribe failed');
      });
    });

    client.on('message', (_topic, payload) => {
      this.handleMessage(payload.toString());
    });

    client.on('error',       (err) => log.warn({ err }, '[mqtt] Broker error'));
    client.on('reconnect',   ()    => log.debug('[mqtt] Reconnecting…'));
    client.on('disconnect',  ()    => log.debug('[mqtt] Disconnected'));
    client.on('offline',     ()    => log.warn('[mqtt] Client offline'));

    this.client = client;
  }

  get isConnected(): boolean {
    return this.client?.connected ?? false;
  }

  private handleMessage(raw: string): void {
    const db  = this.db!;
    const log = this.log!;

    let msg: NotePayload;
    try {
      msg = JSON.parse(raw) as NotePayload;
    } catch {
      log.warn({ raw }, '[mqtt] Unparseable message');
      return;
    }

    if (msg.type !== 'note') return;

    const data = msg.data ?? {};
    log.info(
      { employeeId: data.employeeId, noteTime: data.noteTime, notePass: data.notePass, notePity: data.notePity },
      '[mqtt] Face-scan event received',
    );

    const noteTime   = data.noteTime ?? '';
    const eventTime  = new Date(noteTime);
    if (isNaN(eventTime.getTime())) {
      log.warn({ noteTime }, '[mqtt] Invalid noteTime — skipping');
      return;
    }

    const employeeId = data.employeeId?.trim() ?? '';

    if (!employeeId) {
      // Stranger — unregistered face. Log only; no AccessEvent created.
      log.info({ noteTime, notePass: data.notePass }, '[mqtt] Stranger scan — no employeeId');
      return;
    }

    // employeeId === memberCode (id_number and employeeId are the same field on this machine)
    const member = db.getMemberByCode(employeeId);
    if (!member) {
      log.warn({ employeeId }, '[mqtt] No local member found for employeeId — re-enrollment may be needed after next pull');
      return;
    }

    const decision       = data.notePass === 1 ? 'ALLOW' : 'DENY';
    const identifierUsed = data.noteWay  === 1 ? 'rfid'  : 'face';

    // Deterministic eventId prevents duplicates if the message is replayed
    const eventId = `mqtt_${edgeConfig.EDGE_DEVICE_ID}_${employeeId}_${eventTime.getTime()}`;

    try {
      db.appendEvent({
        eventId,
        deviceId:       edgeConfig.EDGE_DEVICE_ID,
        branchId:       edgeConfig.EDGE_BRANCH_ID,
        zone:           'main_entry',
        subjectType:    'member',
        subjectId:      member.memberId,
        subjectName:    `${member.memberCode}`,
        decision,
        identifierUsed,
        eventTime:      eventTime.toISOString(),
      });
      log.info({ employeeId, decision, eventTime: eventTime.toISOString() }, '[mqtt] Event queued');
    } catch {
      // UNIQUE constraint → already queued (MQTT QoS-1 can redeliver)
      log.debug({ eventId }, '[mqtt] Duplicate event ignored');
    }
  }
}

// Singleton — the sync worker imports this instance
export const mqttListener = new MqttAttendanceListener();

// ── Bridge Hardware MQTT Listener ─────────────────────────────────────────────
//
// Edge-Bridge-Mini-C3 (Wiegand → MQTT) publishes to:
//   {topicBase}/attendance   → card swipes
//   {topicBase}/status       → device status
//   {topicBase}/heartbeat    → keepalive
//
// Attendance payload:
//   { type:"attendance", card_id:"8-12345", epoch:1234567890, bits:26, source:"wiegand26" }
//
// card_id is "facilityCode-cardNumber" from Wiegand26/34.
// We try exact match first; if not found, try just the card number part.
// This handles both storage formats (stored as "8-12345" or just "12345").
//
// Access decision is evaluated locally (blocklist, plan, time windows).
// Result queued to SQLite → pushed to VPS by sync worker.

import { decide } from '../access/decision.js';
import type { Zone } from '@edge-gym/shared-types';

type BridgeAttendancePayload = {
  type:     'attendance';
  card_id:  string;
  epoch?:   number;
  timestamp?: number;
  bits?:    number;
  source?:  string;
};

export class BridgeMqttListener {
  private client: MqttClient | null = null;
  private db:  EdgeDB | null = null;
  private log: BaseLogger | null = null;

  start(cfg: MqttLiveConfig, db: EdgeDB, log: BaseLogger): void {
    this.db  = db;
    this.log = log;

    if (this.client?.connected) return;
    if (this.client) { this.client.end(true); this.client = null; }

    const attendanceTopic = `${cfg.infoTopic}/attendance`;

    const client = mqtt.connect(cfg.brokerUrl, {
      clientId:        `edge_bridge_${edgeConfig.EDGE_DEVICE_ID}_${Date.now()}`,
      username:        cfg.username || undefined,
      password:        cfg.password || undefined,
      reconnectPeriod: 15_000,
      connectTimeout:  15_000,
      clean:           true,
    });

    client.on('connect', () => {
      log.info({ topic: attendanceTopic }, '[bridge-mqtt] Connected — subscribing to Wiegand attendance');
      client.subscribe(attendanceTopic, { qos: 1 }, (err) => {
        if (err) log.error({ err }, '[bridge-mqtt] Subscribe failed');
      });
    });

    client.on('message', (_topic, payload) => this.handleMessage(payload.toString()));
    client.on('error',     (err) => log.warn({ err }, '[bridge-mqtt] Broker error'));
    client.on('reconnect', ()    => log.debug('[bridge-mqtt] Reconnecting…'));
    client.on('offline',   ()    => log.warn('[bridge-mqtt] Client offline'));

    this.client = client;
  }

  get isConnected(): boolean { return this.client?.connected ?? false; }

  private handleMessage(raw: string): void {
    const db  = this.db!;
    const log = this.log!;

    let msg: BridgeAttendancePayload;
    try { msg = JSON.parse(raw) as BridgeAttendancePayload; } catch { return; }
    if (msg.type !== 'attendance' || !msg.card_id) return;

    const rawCardId = msg.card_id.trim();
    // Try exact match, then fall back to just the number after the last '-'
    const lookupKey = this.resolveCardId(rawCardId, db);

    const eventTime = msg.epoch
      ? new Date(msg.epoch * 1000)
      : new Date();

    const eventId = `bridge_${edgeConfig.EDGE_DEVICE_ID}_${rawCardId.replace(/-/g, '')}_${eventTime.getTime()}`;

    if (!lookupKey) {
      log.info({ rawCardId }, '[bridge-mqtt] Unknown card — no member match (enroll RFID card in member profile)');
      return;
    }

    // Run the full access decision (blocklist, plan status, time windows, anti-passback)
    const result = decide(db, { identifierValue: lookupKey, identifierType: 'rfid', zone: 'main_entry' as Zone });

    try {
      db.appendEvent({
        eventId,
        deviceId:       edgeConfig.EDGE_DEVICE_ID,
        branchId:       edgeConfig.EDGE_BRANCH_ID,
        zone:           'main_entry',
        subjectType:    result.subjectType,
        subjectId:      result.subjectId,
        subjectName:    result.subjectName,
        decision:       result.decision,
        denyReason:     result.denyReason,
        identifierUsed: 'rfid',
        eventTime:      eventTime.toISOString(),
      });
      log.info({ rawCardId, decision: result.decision }, '[bridge-mqtt] Wiegand card event queued');
    } catch {
      log.debug({ eventId }, '[bridge-mqtt] Duplicate event ignored');
    }
  }

  private resolveCardId(raw: string, db: EdgeDB): string | null {
    if (db.getMemberByRfid(raw)) return raw;
    const numOnly = raw.includes('-') ? raw.split('-').pop()! : null;
    if (numOnly && db.getMemberByRfid(numOnly)) return numOnly;
    return null;
  }
}

export const bridgeListener = new BridgeMqttListener();
