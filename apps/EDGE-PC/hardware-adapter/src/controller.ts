/**
 * Controller — the core decision loop.
 *
 * For each reader the lifecycle is:
 *   1. CardReadEvent arrives from reader (debounced per card + reader)
 *   2. POST /access/decide to the local edge service
 *   3. On ALLOW: pulse relay, green LED, short beep
 *   4. On DENY:  red LED, triple beep, log reason
 *   5. Errors:   log + red LED; never crash the process
 */

import axios, { type AxiosInstance } from 'axios';
import type { ReaderConfig }       from './config.js';
import { createReader, type CardReadEvent } from './readers/index.js';
import { createOutput, type OutputGroup }  from './output/index.js';

interface DecisionResponse {
  decision:     'ALLOW' | 'DENY';
  triggerRelay: boolean;
  subjectId:    string;
  reason?:      string;
}

export interface ControllerOptions {
  edgeServiceUrl: string;
  pulseMs:        number;
  cooldownMs:     number;
  logger: {
    info(msg: string, obj?: object): void;
    warn(msg: string, obj?: object): void;
    error(msg: string, obj?: object): void;
  };
}

export interface ReaderHandle {
  stop(): Promise<void>;
  destroy(): void;
}

export function createController(opts: ControllerOptions) {
  const http: AxiosInstance = axios.create({
    baseURL: opts.edgeServiceUrl,
    timeout: 4000,
  });

  // cooldown map: "readerName:cardValue" → timestamp of last send
  const cooldownMap = new Map<string, number>();

  function isCoolingDown(readerName: string, rawValue: string): boolean {
    const key  = `${readerName}:${rawValue}`;
    const last = cooldownMap.get(key) ?? 0;
    if (Date.now() - last < opts.cooldownMs) return true;
    cooldownMap.set(key, Date.now());
    return false;
  }

  async function handleCard(
    ev: CardReadEvent,
    cfg: ReaderConfig,
    output: OutputGroup,
  ): Promise<void> {
    if (isCoolingDown(ev.readerName, ev.rawValue)) return;

    opts.logger.info(`[${ev.readerName}] card=${ev.rawValue} zone=${cfg.zone}`);

    let decision: DecisionResponse;
    try {
      const res = await http.post<DecisionResponse>('/access/decide', {
        identifierValue: ev.rawValue,
        identifierType:  ev.identifierType,
        zone:            cfg.zone,
      });
      decision = res.data;
    } catch (err) {
      // Edge service unreachable — fail CLOSED (do not open door)
      opts.logger.error(`[${ev.readerName}] edge service error: ${(err as Error).message}`);
      void output.led?.deny(2000);
      void output.buzzer?.deny();
      return;
    }

    if (decision.decision === 'ALLOW' && decision.triggerRelay) {
      opts.logger.info(`[${ev.readerName}] ALLOW subject=${decision.subjectId}`);
      // Run outputs in parallel — don't await LED/buzzer so relay fires immediately
      void output.relay.pulse();
      void output.led?.allow();
      void output.buzzer?.allow();
    } else {
      opts.logger.warn(`[${ev.readerName}] DENY subject=${decision.subjectId} reason=${decision.reason ?? 'unknown'}`);
      void output.led?.deny();
      void output.buzzer?.deny();
    }
  }

  function attachReader(cfg: ReaderConfig): ReaderHandle {
    const reader = createReader(cfg);
    const output = createOutput(cfg, opts.pulseMs);

    // Boot output hardware
    void output.init().then(() => {
      opts.logger.info(`[${cfg.name}] output initialized (relay=GPIO${cfg.relayPin})`);
    });

    reader.on('card', (ev) => {
      void handleCard(ev, cfg, output);
    });

    reader.on('error', (err) => {
      opts.logger.error(`[${cfg.name}] reader error: ${err.message}`);
    });

    reader.start().then(() => {
      opts.logger.info(`[${cfg.name}] reader started (type=${cfg.type} zone=${cfg.zone})`);
    }).catch((err: Error) => {
      opts.logger.error(`[${cfg.name}] reader failed to start: ${err.message}`);
    });

    return {
      stop:    () => reader.stop(),
      destroy: () => output.destroy(),
    };
  }

  return { attachReader };
}
