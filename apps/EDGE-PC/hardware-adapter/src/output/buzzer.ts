/**
 * Buzzer controller — drives a passive buzzer via GPIO.
 *
 * Wiring: GPIO pin → NPN transistor base (via 1kΩ) → buzzer+ / GND.
 * Or: GPIO pin → active buzzer directly (no transistor needed for 3.3V buzzers).
 */

type GpioOut = { writeSync(v: 0 | 1): void; unexport(): void };

async function tryGpioOut(pin: number): Promise<GpioOut | null> {
  if (pin < 0) return null;
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

export class Buzzer {
  private gpio: GpioOut | null = null;

  constructor(private readonly pin: number) {}

  async init(): Promise<void> {
    this.gpio = await tryGpioOut(this.pin);
  }

  async beep(onMs: number, offMs = 0): Promise<void> {
    if (this.gpio) {
      this.gpio.writeSync(1);
      await sleep(onMs);
      this.gpio.writeSync(0);
      if (offMs) await sleep(offMs);
    }
  }

  async allow(): Promise<void> {
    // Single short beep: 100 ms
    await this.beep(100);
  }

  async deny(): Promise<void> {
    // Three quick beeps: 80 ms on / 60 ms off
    for (let i = 0; i < 3; i++) await this.beep(80, 60);
  }

  destroy(): void {
    this.gpio?.writeSync(0);
    this.gpio?.unexport();
  }
}
