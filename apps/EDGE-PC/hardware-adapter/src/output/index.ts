import type { ReaderConfig } from '../config.js';
import { Relay }  from './relay.js';
import { Buzzer } from './buzzer.js';
import { Led }    from './led.js';

export interface OutputGroup {
  relay:  Relay;
  buzzer: Buzzer | null;
  led:    Led | null;
  init(): Promise<void>;
  destroy(): void;
}

export function createOutput(cfg: ReaderConfig, pulseMs: number): OutputGroup {
  const relay  = new Relay(cfg.relayPin, pulseMs);
  const buzzer = cfg.buzzerPin  !== undefined ? new Buzzer(cfg.buzzerPin)                        : null;
  const led    = (cfg.ledGreenPin !== undefined || cfg.ledRedPin !== undefined)
    ? new Led(cfg.ledGreenPin, cfg.ledRedPin)
    : null;

  return {
    relay,
    buzzer,
    led,
    async init() {
      await relay.init();
      if (buzzer) await buzzer.init();
      if (led)    await led.init();
    },
    destroy() {
      relay.destroy();
      buzzer?.destroy();
      led?.destroy();
    },
  };
}
