/**
 * U5 Access Control Machine — HTTP Adapter
 *
 * Self-contained module. No imports from the rest of the edge service.
 * Copy this folder into any project; inject config via constructor.
 *
 * Tested against firmware serving /insertEmployee and /deleteEmployee
 * on port 80 (the machine's built-in web UI).
 */

export interface U5Config {
  ip: string;
  port?: number;       // default 80
  password?: string;   // default '123456'
  timeoutMs?: number;  // default 15 000
}

export type U5Result =
  | { success: true }
  | { success: false; code: number; message: string };

const U5_CODE_OK         = 200;
const U5_CODE_DUPLICATE  = 12;  // face too similar to an existing person

export class U5Adapter {
  private readonly base: string;
  private readonly password: string;
  private readonly timeout: number;

  constructor(cfg: U5Config) {
    this.base     = `http://${cfg.ip}:${cfg.port ?? 80}`;
    this.password = cfg.password  ?? '123456';
    this.timeout  = cfg.timeoutMs ?? 15_000;
  }

  /**
   * Enroll a face on the U5 machine from a JPEG data URL.
   *
   * @param idNumber  Unique ID stored on the machine (use memberCode).
   * @param name      Display name on the machine — max 10 chars.
   * @param picLarge  Full data URL: "data:image/jpeg;base64,..."
   * @param cardNumber Optional RFID card number to bind.
   */
  async enrollFace(opts: {
    idNumber:    string;
    name:        string;
    picLarge:    string;
    cardNumber?: string;
  }): Promise<U5Result> {
    const body = {
      password:           this.password,
      name:               opts.name.slice(0, 10),
      id_number:          opts.idNumber,
      access_card_number: opts.cardNumber ?? '',
      pass_date:          '0',
      pass_time:          '0',
      pic_large:          opts.picLarge,
    };

    let res: Response;
    try {
      res = await fetch(`${this.base}/insertEmployee`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  AbortSignal.timeout(this.timeout),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error reaching U5';
      return { success: false, code: 0, message: msg };
    }

    if (!res.ok) {
      return { success: false, code: res.status, message: `U5 HTTP ${res.status}` };
    }

    const data = await res.json() as { code: number };

    if (data.code === U5_CODE_OK)        return { success: true };
    if (data.code === U5_CODE_DUPLICATE) {
      return { success: false, code: 12, message: 'Face already enrolled or too similar to an existing member — use a clearer/different photo' };
    }
    return { success: false, code: data.code, message: `U5 enrollment rejected (code ${data.code})` };
  }

  /**
   * Fetch all enrolled employees from the U5 machine.
   * Returns userId (machine-generated), name, id_number, and pic_large (raw base64, no data: prefix).
   */
  async getEmployeeList(): Promise<{
    success: true;
    data: Array<{ userId: string; name: string; id_number?: string; pic_large?: string }>;
  } | { success: false; code: number; message: string }> {
    let res: Response;
    try {
      res = await fetch(`${this.base}/getEmployeeList`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ password: this.password }),
        signal:  AbortSignal.timeout(this.timeout),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error reaching U5';
      return { success: false, code: 0, message: msg };
    }

    if (!res.ok) return { success: false, code: res.status, message: `U5 HTTP ${res.status}` };
    const data = await res.json() as { code?: number; data?: Array<{ userId: string; name: string; id_number?: string; pic_large?: string }> };
    if (data.code !== undefined && data.code !== U5_CODE_OK) {
      return { success: false, code: data.code, message: `U5 list failed (code ${data.code})` };
    }
    return { success: true, data: data.data ?? [] };
  }

  /**
   * Delete a person from the U5 machine by their machine-assigned userId.
   * To delete by id_number (our memberCode), call getEmployeeList first to resolve userId.
   */
  async deleteEmployee(userId: string): Promise<U5Result> {
    let res: Response;
    try {
      res = await fetch(`${this.base}/deleteEmployee`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ password: this.password, userId }),
        signal:  AbortSignal.timeout(this.timeout),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Network error reaching U5';
      return { success: false, code: 0, message: msg };
    }

    if (!res.ok) return { success: false, code: res.status, message: `U5 HTTP ${res.status}` };
    const data = await res.json() as { code: number };
    return data.code === U5_CODE_OK
      ? { success: true }
      : { success: false, code: data.code, message: `U5 delete failed (code ${data.code})` };
  }

  /** Quick reachability check — returns true if U5 web UI responds. */
  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.base}/`, { signal: AbortSignal.timeout(3_000) });
      return res.ok || res.status < 500;
    } catch {
      return false;
    }
  }
}
