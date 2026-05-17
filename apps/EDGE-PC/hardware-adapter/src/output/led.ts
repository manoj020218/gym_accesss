/**
 * Dual-LED indicator (green = allow, red = deny).
 *
 * Wiring (each LED):
 *   GPIO pin → 330Ω resistor → LED anode (+)
 *   LED cathode (−) → GND
 */

type GpioOut = { writeSync(v: 0 | 1): void; unexport(): void };

async function tryGpioOut(pin: number): Promise<GpioOut | null> {
  if (pin === undefined || pin < 0) return null;
  try {
    const { Gpio } = await import('onoff') as { Gpio: new (p: number, d: string) => GpioOut };
    const g = new Gpio(pin, 'out');
    g.writeSync(0);
    return g;
  } catch {
    return null;
  }
}

async function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

export class Led {
  private green: GpioOut | null = null;
  private red:   GpioOut | null = null;

  constructor(
    private readonly greenPin: number | undefined,
    private readonly redPin:   number | undefined,
  ) {}

  async init(): Promise<void> {
    if (this.greenPin !== undefined) this.green = await tryGpioOut(this.greenPin);
    if (this.redPin   !== undefined) this.red   = await tryGpioOut(this.redPin);
  }

  async allow(durationMs = 1500): Promise<void> {
    this.red?.writeSync(0);
    this.green?.writeSync(1);
    await sleep(durationMs);
    this.green?.writeSync(0);
  }

  async deny(durationMs = 1500): Promise<void> {
    this.green?.writeSync(0);
    this.red?.writeSync(1);
    await sleep(durationMs);
    this.red?.writeSync(0);
  }

  destroy(): void {
    this.green?.writeSync(0);
    this.green?.unexport();
    this.red?.writeSync(0);
    this.red?.unexport();
  }
}
