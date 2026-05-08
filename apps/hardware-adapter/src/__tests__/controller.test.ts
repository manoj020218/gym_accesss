import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createController } from '../controller.js';
import type { ControllerOptions } from '../controller.js';
import type { ReaderConfig }      from '../config.js';
import type { CardReadEvent }     from '../readers/index.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function mockConfig(overrides: Partial<ReaderConfig> = {}): ReaderConfig {
  return {
    name: 'test-reader',
    type: 'mock',
    zone: 'MAIN_FLOOR',
    relayPin: -1,
    options: { intervalMs: 99999, cards: [] },
    ...overrides,
  };
}

function mockEvent(overrides: Partial<CardReadEvent> = {}): CardReadEvent {
  return {
    rawValue:       'AABBCCDD',
    identifierType: 'rfid',
    readerName:     'test-reader',
    timestamp:      new Date(),
    ...overrides,
  };
}

// ── mock output ───────────────────────────────────────────────────────────────

function makeOutputMock() {
  return {
    relay:  { pulse: vi.fn().mockResolvedValue(undefined), destroy: vi.fn(), init: vi.fn() },
    buzzer: { allow: vi.fn().mockResolvedValue(undefined), deny: vi.fn().mockResolvedValue(undefined), destroy: vi.fn() },
    led:    { allow: vi.fn().mockResolvedValue(undefined), deny: vi.fn().mockResolvedValue(undefined), destroy: vi.fn() },
    init:   vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
  };
}

// ── mock reader ───────────────────────────────────────────────────────────────

function makeReaderMock() {
  const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
  return {
    on(event: string, cb: (...a: unknown[]) => void) { (listeners[event] ??= []).push(cb); return this; },
    start: vi.fn().mockResolvedValue(undefined),
    stop:  vi.fn().mockResolvedValue(undefined),
    emit(event: string, ...args: unknown[]) { listeners[event]?.forEach((cb) => cb(...args)); },
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('controller', () => {
  let httpPost:    ReturnType<typeof vi.fn>;
  let loggerWarn:  ReturnType<typeof vi.fn>;
  let loggerError: ReturnType<typeof vi.fn>;
  let loggerInfo:  ReturnType<typeof vi.fn>;
  let opts:        ControllerOptions;
  let reader:      ReturnType<typeof makeReaderMock>;
  let output:      ReturnType<typeof makeOutputMock>;

  beforeEach(async () => {
    vi.useFakeTimers();

    httpPost    = vi.fn();
    loggerWarn  = vi.fn();
    loggerError = vi.fn();
    loggerInfo  = vi.fn();

    opts = {
      edgeServiceUrl: 'http://localhost:8091',
      pulseMs:        500,
      cooldownMs:     3000,
      logger: { info: loggerInfo, warn: loggerWarn, error: loggerError },
    };

    reader = makeReaderMock();
    output = makeOutputMock();

    // Patch createReader and createOutput via module mock
    vi.doMock('../readers/index.js', () => ({ createReader: () => reader }));
    vi.doMock('../output/index.js',  () => ({ createOutput: () => output }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
    vi.resetModules();
  });

  // Helper: trigger a card event through the controller
  async function triggerCard(ev: CardReadEvent, response: Partial<DecisionResponse> = { decision: 'ALLOW', triggerRelay: true, subjectId: 'member1' }) {
    httpPost.mockResolvedValueOnce({ data: response });

    // Dynamically import with mocked deps
    const { createController: cc } = await import('../controller.js');
    const axiosMod = await import('axios');
    vi.spyOn(axiosMod.default, 'create').mockReturnValue({ post: httpPost } as unknown as ReturnType<typeof axiosMod.default.create>);

    const ctrl   = cc(opts);
    const handle = ctrl.attachReader(mockConfig());

    await vi.runAllTimersAsync();
    reader.emit('card', ev);
    await vi.runAllTimersAsync();

    return handle;
  }

  it('pulses relay and green LED on ALLOW', async () => {
    const { createController: cc } = await import('../controller.js');
    const axiosMod = await import('axios');
    httpPost = vi.fn().mockResolvedValue({ data: { decision: 'ALLOW', triggerRelay: true, subjectId: 'M1' } });
    vi.spyOn(axiosMod.default, 'create').mockReturnValue({ post: httpPost } as unknown as ReturnType<typeof axiosMod.default.create>);

    const ctrl = cc(opts);
    ctrl.attachReader(mockConfig());
    await vi.runAllTimersAsync();

    reader.emit('card', mockEvent());
    await vi.runAllTimersAsync();

    expect(httpPost).toHaveBeenCalledWith('/access/decide', {
      identifierValue: 'AABBCCDD',
      identifierType:  'rfid',
      zone:            'MAIN_FLOOR',
    });
    expect(output.relay.pulse).toHaveBeenCalled();
    expect(output.led.allow).toHaveBeenCalled();
    expect(output.buzzer.allow).toHaveBeenCalled();
    expect(output.led.deny).not.toHaveBeenCalled();
  });

  it('triggers red LED and buzzer deny on DENY', async () => {
    const { createController: cc } = await import('../controller.js');
    const axiosMod = await import('axios');
    httpPost = vi.fn().mockResolvedValue({ data: { decision: 'DENY', triggerRelay: false, subjectId: 'M1', reason: 'DENY_MEMBER_EXPIRED' } });
    vi.spyOn(axiosMod.default, 'create').mockReturnValue({ post: httpPost } as unknown as ReturnType<typeof axiosMod.default.create>);

    const ctrl = cc(opts);
    ctrl.attachReader(mockConfig());
    await vi.runAllTimersAsync();

    reader.emit('card', mockEvent());
    await vi.runAllTimersAsync();

    expect(output.relay.pulse).not.toHaveBeenCalled();
    expect(output.led.deny).toHaveBeenCalled();
    expect(output.buzzer.deny).toHaveBeenCalled();
    expect(loggerWarn).toHaveBeenCalledWith(expect.stringContaining('DENY'), undefined);
  });

  it('debounces rapid re-reads of the same card within cooldown', async () => {
    const { createController: cc } = await import('../controller.js');
    const axiosMod = await import('axios');
    httpPost = vi.fn().mockResolvedValue({ data: { decision: 'ALLOW', triggerRelay: true, subjectId: 'M1' } });
    vi.spyOn(axiosMod.default, 'create').mockReturnValue({ post: httpPost } as unknown as ReturnType<typeof axiosMod.default.create>);

    const ctrl = cc(opts);
    ctrl.attachReader(mockConfig());
    await vi.runAllTimersAsync();

    const ev = mockEvent();
    reader.emit('card', ev);
    reader.emit('card', ev);    // same card, should be ignored
    reader.emit('card', ev);    // same card, should be ignored
    await vi.runAllTimersAsync();

    expect(httpPost).toHaveBeenCalledTimes(1);
  });

  it('allows same card after cooldown expires', async () => {
    const { createController: cc } = await import('../controller.js');
    const axiosMod = await import('axios');
    httpPost = vi.fn().mockResolvedValue({ data: { decision: 'ALLOW', triggerRelay: true, subjectId: 'M1' } });
    vi.spyOn(axiosMod.default, 'create').mockReturnValue({ post: httpPost } as unknown as ReturnType<typeof axiosMod.default.create>);

    const ctrl = cc({ ...opts, cooldownMs: 1000 });
    ctrl.attachReader(mockConfig());
    await vi.runAllTimersAsync();

    const ev = mockEvent();
    reader.emit('card', ev);
    await vi.runAllTimersAsync();

    vi.advanceTimersByTime(1100);
    reader.emit('card', ev);
    await vi.runAllTimersAsync();

    expect(httpPost).toHaveBeenCalledTimes(2);
  });

  it('logs error and denies on edge service network failure', async () => {
    const { createController: cc } = await import('../controller.js');
    const axiosMod = await import('axios');
    httpPost = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    vi.spyOn(axiosMod.default, 'create').mockReturnValue({ post: httpPost } as unknown as ReturnType<typeof axiosMod.default.create>);

    const ctrl = cc(opts);
    ctrl.attachReader(mockConfig());
    await vi.runAllTimersAsync();

    reader.emit('card', mockEvent());
    await vi.runAllTimersAsync();

    expect(output.relay.pulse).not.toHaveBeenCalled();
    expect(output.led.deny).toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalledWith(expect.stringContaining('edge service error'), undefined);
  });

  it('two different cards are not debounced against each other', async () => {
    const { createController: cc } = await import('../controller.js');
    const axiosMod = await import('axios');
    httpPost = vi.fn().mockResolvedValue({ data: { decision: 'ALLOW', triggerRelay: true, subjectId: 'M1' } });
    vi.spyOn(axiosMod.default, 'create').mockReturnValue({ post: httpPost } as unknown as ReturnType<typeof axiosMod.default.create>);

    const ctrl = cc(opts);
    ctrl.attachReader(mockConfig());
    await vi.runAllTimersAsync();

    reader.emit('card', mockEvent({ rawValue: 'CARD0001' }));
    reader.emit('card', mockEvent({ rawValue: 'CARD0002' }));
    await vi.runAllTimersAsync();

    expect(httpPost).toHaveBeenCalledTimes(2);
  });
});

// local type to avoid importing axios types
interface DecisionResponse {
  decision:     'ALLOW' | 'DENY';
  triggerRelay: boolean;
  subjectId:    string;
  reason?:      string;
}
