import type { ReaderConfig } from '../config.js';
import { BaseReader } from './base.js';
import { WiegandReader } from './wiegand.js';
import { SerialReader }  from './serial.js';
import { TcpReader }     from './tcp.js';
import { MockReader }    from './mock.js';

export function createReader(cfg: ReaderConfig): BaseReader {
  switch (cfg.type) {
    case 'wiegand': return new WiegandReader(cfg.name, cfg.options as Parameters<typeof WiegandReader>[1]);
    case 'serial':  return new SerialReader(cfg.name,  cfg.options as Parameters<typeof SerialReader>[1]);
    case 'tcp':     return new TcpReader(cfg.name,     cfg.options as Parameters<typeof TcpReader>[1]);
    case 'mock':    return new MockReader(cfg.name,     cfg.options as Parameters<typeof MockReader>[1]);
  }
}

export { BaseReader } from './base.js';
export type { CardReadEvent } from './base.js';
