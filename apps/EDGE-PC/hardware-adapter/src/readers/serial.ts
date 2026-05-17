/**
 * Serial / RS-485 RFID reader adapter.
 *
 * Wiring (USB-to-RS485 dongle → reader):
 *   A (TX+) → A terminal on reader
 *   B (TX-) → B terminal on reader
 *   Common readers: RFID-RC522 via UART, EM4100 module, YHY502CPU
 *
 * Supported output formats from reader:
 *   "hex"     – raw bytes as hex string, e.g.  "AABBCCDD\n"
 *   "decimal" – decimal card number,  e.g.  "1234567890\n"
 *   "ascii"   – tagged line,          e.g.  "CARD:AABBCCDD\n" or just "AABBCCDD\n"
 *
 * USB HID barcode / QR scanners also work when configured to emulate serial.
 */

import { BaseReader, type CardReadEvent } from './base.js';
import type { SerialOptions } from '../config.js';

export class SerialReader extends BaseReader {
  private port:   unknown = null;  // SerialPort instance (dynamic import)
  private parser: unknown = null;

  constructor(
    name: string,
    private readonly opts: SerialOptions,
  ) {
    super(name);
  }

  async start(): Promise<void> {
    // Dynamic import so the module loads without serialport installed (e.g. in tests)
    const { SerialPort }       = await import('serialport') as { SerialPort: new (o: object) => unknown & { pipe: (p: unknown) => unknown; on: (e: string, cb: (...a: unknown[]) => void) => void; } };
    const { DelimiterParser }  = await import('@serialport/parser-delimiter') as { DelimiterParser: new (o: object) => { on: (e: string, cb: (d: Buffer) => void) => void; } };

    const delimiter = this.opts.delimiter === '\\n' ? '\n'
                    : this.opts.delimiter === '\\r' ? '\r'
                    : this.opts.delimiter;

    this.port = new SerialPort({
      path:     this.opts.path,
      baudRate: this.opts.baudRate,
      autoOpen: true,
    });

    const sp = this.port as { pipe: (p: unknown) => unknown; on: (e: string, cb: (...a: unknown[]) => void) => void };
    this.parser = sp.pipe(new DelimiterParser({ delimiter }));

    sp.on('error', (err: Error) => this.emit('error', err));

    const parser = this.parser as { on: (e: string, cb: (d: Buffer) => void) => void };
    parser.on('data', (chunk: Buffer) => {
      const raw = chunk.toString('utf-8').trim();
      const value = this.parseCardValue(raw);
      if (!value) return;

      const isQr = this.opts.format === 'ascii' && raw.length > 8;
      const ev: CardReadEvent = {
        rawValue:       value,
        identifierType: isQr ? 'qr' : 'rfid',
        readerName:     this.name,
        timestamp:      new Date(),
      };
      this.emit('card', ev);
    });
  }

  async stop(): Promise<void> {
    const sp = this.port as { close?: () => void } | null;
    sp?.close?.();
  }

  private parseCardValue(raw: string): string | null {
    if (!raw) return null;

    switch (this.opts.format) {
      case 'hex':
        // Validate hex string; strip spaces
        return /^[0-9A-Fa-f\s]+$/.test(raw)
          ? raw.replace(/\s/g, '').toUpperCase()
          : null;

      case 'decimal': {
        const n = parseInt(raw, 10);
        if (isNaN(n)) return null;
        return n.toString(16).toUpperCase().padStart(8, '0');
      }

      case 'ascii':
      default: {
        // Strip common prefixes: "CARD:", "UID:", "ID:", etc.
        const stripped = raw.replace(/^(CARD|UID|ID|TAG):/i, '').trim();
        if (!stripped) return null;

        // If it looks like hex, return it; otherwise return as-is (QR string)
        return /^[0-9A-Fa-f]+$/.test(stripped)
          ? stripped.toUpperCase()
          : stripped;
      }
    }
  }
}
