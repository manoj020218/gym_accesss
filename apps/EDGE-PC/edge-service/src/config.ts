import { z } from 'zod';

const Env = z.object({
  NODE_ENV:              z.enum(['development','production']).default('development'),
  LOG_LEVEL:             z.enum(['trace','debug','info','warn','error','fatal']).default('info'),
  EDGE_DEVICE_ID:        z.string().min(1),
  EDGE_BRANCH_ID:        z.string().min(1),
  EDGE_PORT:             z.coerce.number().default(8090),
  EDGE_SYNC_BASE_URL:    z.string().url(),
  EDGE_SHARED_SECRET:    z.string().min(16),
  EDGE_SQLITE_PATH:      z.string().default('./data/edge.db'),
  EDGE_SYNC_INTERVAL_MS: z.coerce.number().default(30_000),
  EDGE_HEARTBEAT_INTERVAL_MS: z.coerce.number().default(60_000),
  // U5 physical machine
  U5_MACHINE_IP:          z.string().optional(),
  U5_MACHINE_PORT:        z.coerce.number().default(80),
  U5_MACHINE_PASSWORD:    z.string().default('123456'),
  U5_MACHINE_USERNAME:    z.string().default('admin'),
  U5_POLL_INTERVAL_MS:    z.coerce.number().default(30_000),
  // Face image storage — edge PC only, never uploaded to VPS
  FACE_STORAGE_DIR:     z.string().default('./storage/faces'),
  // Employee JSON backup — full employee list snapshot per device
  EMPLOYEE_BACKUP_DIR:  z.string().default('./storage/employees'),
  // Bridge hardware MQTT (Wiegand → MQTT, e.g. Edge-Bridge-Mini-C3)
  // If not set, bridge integration is disabled — U5 RFID/face still works via polling/U5 MQTT
  BRIDGE_MQTT_BROKER_URL:  z.string().optional(),   // mqtt://192.168.1.100:1883
  BRIDGE_MQTT_TOPIC_BASE:  z.string().optional(),   // e.g. "gym/door1"  → subscribes to gym/door1/attendance
  BRIDGE_MQTT_USERNAME:    z.string().optional(),
  BRIDGE_MQTT_PASSWORD:    z.string().optional(),
  // FRPC tunnel — lets VPS reach this edge PC for enrollment requests
  // Leave unset if VPS is not used or if a static IP / port-forward is available
  FRPC_BINARY:       z.string().optional(),         // full path to frpc.exe or frpc
  FRPC_SERVER_ADDR:  z.string().optional(),         // VPS IP or domain
  FRPC_SERVER_PORT:  z.coerce.number().default(7000),
  FRPC_TOKEN:        z.string().optional(),
  FRPC_SUBDOMAIN:    z.string().optional(),         // subdomain on VPS frps vhost
  // Local admin UI JWT secret — defaults to EDGE_SHARED_SECRET if not set
  LOCAL_JWT_SECRET:  z.string().optional(),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error('❌  Invalid edge environment:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
