/**
 * GPIO relay controller.
 *
 * Wiring (active-HIGH relay module → RPi):
 *   IN1  → GPIO pin (e.g. GPIO 22, physical pin 15)
 *   VCC  → 5V  (physical pin 2)
 *   GND  → GND (physical pin 6)
 *
 * For active-LOW relay modules: set ACTIVE_LOW=true in options.
 *
 * The relay is pulsed HIGH for `pulseMs` ms, then returned to LOW.
 * A second pulse is ignored while the first is still active (guard timer).
 */

type GpioOut = {
  writeSync(value: 0 | 1): void;
  unexport(): void;
};

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

export class Relay {
  private gpio:   GpioOut | null = null;
  private active  = false;

  constructor(
    private readonly pin:       number,
    private readonly pulseMs:   number,
    private readonly activeLow: boolean = false,
  ) {}

  async init(): Promise<void> {
    this.gpio = await tryGpioOut(this.pin);
  }

  async pulse(): Promise<void> {
    if (this.active) return;    // already open; don't extend
    this.active = true;

    if (this.gpio) {
      this.gpio.writeSync(this.activeLow ? 0 : 1);
    } else {
      // No GPIO available — mock: just log
      console.info(`[relay] pin=${this.pin} → OPEN (mock)`);
    }

    await new Promise<void>((r) => setTimeout(r, this.pulseMs));

    if (this.gpio) {
      this.gpio.writeSync(this.activeLow ? 1 : 0);
    } else {
      console.info(`[relay] pin=${this.pin} → CLOSED (mock)`);
    }

    this.active = false;
  }

  destroy(): void {
    if (this.gpio) {
      this.gpio.writeSync(this.activeLow ? 1 : 0);
      this.gpio.unexport();
    }
  }
}
