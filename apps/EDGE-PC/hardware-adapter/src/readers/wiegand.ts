/**
 * Wiegand 26/34-bit RFID reader via two GPIO interrupt pins (D0, D1).
 *
 * Wiring (RPi physical → reader terminal):
 *   GPIO 17 (pin 11) → D0 (data 0, green wire on most readers)
 *   GPIO 18 (pin 12) → D1 (data 1, white wire on most readers)
 *   5V (pin 2/4)     → VCC (red)
 *   GND (pin 6)      → GND (black)
 *   Add 1kΩ pull-up resistors on D0/D1 if the reader does not have its own.
 *
 * Protocol:
 *   Each bit is transmitted by pulsing D0 (→ 0) or D1 (→ 1) LOW for ~50µs.
 *   Bits arrive every ~1–2 ms; frame ends after ≥50 ms of silence.
 *   26-bit: [even-parity | 8-bit facility | 16-bit card# | odd-parity]
 *   34-bit: [even-parity | 16-bit facility | 16-bit card# | odd-parity]
 */

import { BaseReader, type CardReadEvent } from './base.js';
import type { WiegandOptions } from '../config.js';

const FRAME_TIMEOUT_MS = 80;  // emit card read after this many ms of silence

type GpioLike = {
  watch(callback: (err: Error | null, value: number) => void): void;
  unexport(): void;
};

// Attempt to load onoff; fall back to null on non-RPi hosts.
async function tryGpio(pin: number, direction: 'in', edge: 'falling'): Promise<GpioLike | null> {
  try {
    const { Gpio } = await import('onoff') as { Gpio: new (p: number, d: string, e: string) => GpioLike };
    return new Gpio(pin, direction, edge);
  } catch {
    return null;
  }
}

function parseBits(bits: number[], bitFormat: 26 | 34): string | null {
  if (bits.length !== bitFormat) return null;

  // Drop parity bits (first and last)
  const data = bits.slice(1, bitFormat - 1);

  const facilityBits = bitFormat === 26 ? 8 : 16;
  const cardBits     = 16;

  let facility = 0;
  for (let i = 0; i < facilityBits; i++) {
    facility = (facility << 1) | (data[i] ?? 0);
  }

  let card = 0;
  for (let i = facilityBits; i < facilityBits + cardBits; i++) {
    card = (card << 1) | (data[i] ?? 0);
  }

  // Encode as HEX string matching what the API stores as rfidCardId
  return Buffer.from([
    (facility >> 8) & 0xff,
    facility & 0xff,
    (card >> 8) & 0xff,
    card & 0xff,
  ]).toString('hex').toUpperCase();
}

export class WiegandReader extends BaseReader {
  private bits:      number[] = [];
  private frameTimer: ReturnType<typeof setTimeout> | null = null;
  private d0: GpioLike | null = null;
  private d1: GpioLike | null = null;

  constructor(
    name: string,
    private readonly opts: WiegandOptions,
  ) {
    super(name);
  }

  async start(): Promise<void> {
    this.d0 = await tryGpio(this.opts.d0Pin, 'in', 'falling');
    this.d1 = await tryGpio(this.opts.d1Pin, 'in', 'falling');

    if (!this.d0 || !this.d1) {
      throw new Error(
        `[${this.name}] GPIO not available. ` +
        `Install "onoff" on a Raspberry Pi, or set MOCK_MODE=true.`
      );
    }

    this.d0.watch((err) => {
      if (err) { this.emit('error', err); return; }
      this.pushBit(0);
    });

    this.d1.watch((err) => {
      if (err) { this.emit('error', err); return; }
      this.pushBit(1);
    });
  }

  async stop(): Promise<void> {
    if (this.frameTimer) clearTimeout(this.frameTimer);
    this.d0?.unexport();
    this.d1?.unexport();
  }

  private pushBit(bit: 0 | 1): void {
    this.bits.push(bit);
    if (this.frameTimer) clearTimeout(this.frameTimer);
    this.frameTimer = setTimeout(() => this.flushFrame(), FRAME_TIMEOUT_MS);
  }

  private flushFrame(): void {
    const bits = this.bits.splice(0);
    const value = parseBits(bits, this.opts.bitFormat);
    if (value) {
      const ev: CardReadEvent = {
        rawValue:       value,
        identifierType: 'rfid',
        readerName:     this.name,
        timestamp:      new Date(),
      };
      this.emit('card', ev);
    }
  }
}
