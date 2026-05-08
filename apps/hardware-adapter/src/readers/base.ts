import { EventEmitter } from 'node:events';

export interface CardReadEvent {
  rawValue:       string;
  identifierType: 'rfid' | 'qr';
  readerName:     string;
  timestamp:      Date;
}

export abstract class BaseReader extends EventEmitter {
  constructor(readonly name: string) {
    super();
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;

  // typed overloads so callers get proper inference
  emit(event: 'card',  data:  CardReadEvent): boolean;
  emit(event: 'error', error: Error):         boolean;
  emit(event: string, ...args: unknown[]):    boolean {
    return super.emit(event, ...args);
  }

  on(event: 'card',  listener: (data: CardReadEvent) => void): this;
  on(event: 'error', listener: (error: Error)         => void): this;
  on(event: string,  listener: (...args: unknown[])   => void): this {
    return super.on(event, listener);
  }
}
