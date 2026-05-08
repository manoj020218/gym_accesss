/**
 * Mock reader — emits simulated card reads on a timer.
 * Used when MOCK_MODE=true or in unit tests.
 */

import { BaseReader, type CardReadEvent } from './base.js';
import type { MockOptions } from '../config.js';

export class MockReader extends BaseReader {
  private timer: ReturnType<typeof setInterval> | null = null;
  private cardIndex = 0;

  constructor(
    name: string,
    private readonly opts: MockOptions,
  ) {
    super(name);
  }

  async start(): Promise<void> {
    this.timer = setInterval(() => {
      const cards = this.opts.cards;
      if (cards.length === 0) return;
      const rawValue = cards[this.cardIndex % cards.length]!;
      this.cardIndex++;

      const ev: CardReadEvent = {
        rawValue,
        identifierType: 'rfid',
        readerName:     this.name,
        timestamp:      new Date(),
      };
      this.emit('card', ev);
    }, this.opts.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
  }

  // Trigger a single card read immediately (useful for testing)
  simulateScan(rawValue: string, identifierType: 'rfid' | 'qr' = 'rfid'): void {
    this.emit('card', { rawValue, identifierType, readerName: this.name, timestamp: new Date() });
  }
}
