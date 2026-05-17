/**
 * TCP socket reader — connects to a networked RFID terminal (ZKTeco, Anviz, etc.).
 *
 * ZKTeco devices (F18, MA300, etc.) stream ASCII card events over TCP port 4370:
 *   "Card Number: 1234567890\r\n"
 *
 * Generic "raw" mode: expects newline-delimited hex strings:
 *   "AABBCCDD\n"
 *
 * Auto-reconnects after connection loss with exponential back-off.
 */

import net from 'node:net';
import { BaseReader, type CardReadEvent } from './base.js';
import type { TcpOptions } from '../config.js';

const MAX_RECONNECT_MS = 60_000;

export class TcpReader extends BaseReader {
  private socket:       net.Socket | null = null;
  private stopped       = false;
  private reconnectMs:  number;
  private buffer        = '';

  constructor(
    name: string,
    private readonly opts: TcpOptions,
  ) {
    super(name);
    this.reconnectMs = opts.reconnectMs;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.socket?.destroy();
    this.socket = null;
  }

  private connect(): void {
    if (this.stopped) return;

    this.socket = new net.Socket();
    this.buffer  = '';

    this.socket.connect(this.opts.port, this.opts.host, () => {
      this.reconnectMs = this.opts.reconnectMs;  // reset back-off
    });

    this.socket.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf-8');
      const lines = this.buffer.split(/\r?\n/);
      this.buffer = lines.pop() ?? '';          // last element may be incomplete
      for (const line of lines) this.parseLine(line.trim());
    });

    this.socket.on('error', (err) => {
      this.emit('error', err);
    });

    this.socket.on('close', () => {
      if (!this.stopped) this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    setTimeout(() => this.connect(), this.reconnectMs);
    this.reconnectMs = Math.min(this.reconnectMs * 2, MAX_RECONNECT_MS);
  }

  private parseLine(line: string): void {
    if (!line) return;
    const value = this.opts.protocol === 'zkteco'
      ? this.parseZkTeco(line)
      : this.parseRaw(line);
    if (!value) return;

    const ev: CardReadEvent = {
      rawValue:       value,
      identifierType: 'rfid',
      readerName:     this.name,
      timestamp:      new Date(),
    };
    this.emit('card', ev);
  }

  // ZKTeco ASCII: "Card Number: 1234567890" or "Verified: 1234567890"
  private parseZkTeco(line: string): string | null {
    const match = line.match(/(?:Card Number|Verified|Card):\s*([0-9A-Fa-f]+)/i);
    if (!match?.[1]) return null;
    const n = parseInt(match[1], 10);
    return isNaN(n)
      ? match[1].toUpperCase()
      : n.toString(16).toUpperCase().padStart(8, '0');
  }

  // Raw: bare hex string on each line
  private parseRaw(line: string): string | null {
    const clean = line.replace(/\s/g, '');
    return /^[0-9A-Fa-f]{4,}$/.test(clean) ? clean.toUpperCase() : null;
  }
}
