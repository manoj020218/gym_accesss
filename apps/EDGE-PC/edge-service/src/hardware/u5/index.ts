/**
 * U5 Access Control Machine — HTTP Adapter
 *
 * Self-contained module. No imports from the rest of the edge service.
 * Copy this folder into any project; inject config via constructor.
 *
 * Confirmed against firmware V3.0-20240912 (device n7v5_alcor2, SN ZY20241227014).
 * Device uses Mongoose/6.18 — single-connection HTTP server, call endpoints serially.
 * Response format: {"result": 0, "message": "...", "data": ...}  (result=0 means OK)
 * Exception: /insertEmployee returns {"code": 200} — kept as-is.
 */

export interface U5Config {
  ip: string;
  port?: number;       // default 80
  password?: string;   // default '123456'
  username?: string;   // default 'admin'  — required for deviceLogin
  timeoutMs?: number;  // default 15 000
}

export interface U5DeviceInfo {
  sn:                    string;
  deviceName:            string;
  firmwareVersion:       string;
  faceAlgVersion:        string;
  mac:                   string;
}

export interface U5ServerSettings {
  cloudServerAddress:    string;   // HTTP cloud server URL (polling mode)
  cloudServerPollingSec: number;   // polling interval in seconds
  protocolType:          number;   // 0 = HTTP polling, 1 = MQTT push
  mqttAppAddress:        string;   // MQTT OAuth/auth endpoint
  mqttRegisterAddress:   string;   // MQTT device register endpoint
  thirdPartyAddress:     string;   // third-party HTTP push URL (empty = disabled)
  thirdPartyEnabled:     boolean;  // true = device pushes events via HTTP to thirdPartyAddress
}

export type U5Result =
  | { success: true }
  | { success: false; code: number; message: string };

const U5_CODE_OK         = 200;
const U5_CODE_DUPLICATE  = 12;  // face too similar to an existing person

export class U5Adapter {
  private readonly base: string;
  private readonly password: string;
  private readonly username: string;
  private readonly timeout: number;

  constructor(cfg: U5Config) {
    this.base     = `http://${cfg.ip}:${cfg.port ?? 80}`;
    this.password = cfg.password  ?? '123456';
    this.username = cfg.username  ?? 'admin';
    this.timeout  = cfg.timeoutMs ?? 15_000;
  }

  private async post<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.base}${endpoint}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(this.timeout),
    });
    if (!res.ok) throw new Error(`U5 HTTP ${res.status} from ${endpoint}`);
    return res.json() as Promise<T>;
  }

  /**
   * Verify device is reachable and get firmware/hardware info.
   * Confirmed working: POST /getDeviceVersion {"password":"123456"}
   * Response: {"result":0,"data":{"sn","firmware_version","device_name","face_recg_alg_version","mac"}}
   */
  async getDeviceVersion(): Promise<{ success: true; info: U5DeviceInfo } | { success: false; message: string }> {
    try {
      const data = await this.post<{
        result: number;
        data?: { sn: string; firmware_version: string; device_name: string; face_recg_alg_version: string; mac: string };
      }>('/getDeviceVersion', { password: this.password });

      if (data.result !== 0 || !data.data) {
        return { success: false, message: `Device returned result ${data.result}` };
      }
      return {
        success: true,
        info: {
          sn:              data.data.sn,
          deviceName:      data.data.device_name,
          firmwareVersion: data.data.firmware_version,
          faceAlgVersion:  data.data.face_recg_alg_version,
          mac:             data.data.mac,
        },
      };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Network error' };
    }
  }

  /**
   * Login to the device web UI.
   * Confirmed working: POST /deviceLogin {"username":"admin","password":"123456"}
   * Response: {"result":0,"message":"Login success"}
   * Use this as the first step when onboarding a new machine — verifies credentials.
   */
  async deviceLogin(): Promise<U5Result> {
    try {
      const data = await this.post<{ result: number; message?: string }>(
        '/deviceLogin',
        { username: this.username, password: this.password },
      );
      return data.result === 0
        ? { success: true }
        : { success: false, code: data.result, message: data.message ?? `Login failed (result ${data.result})` };
    } catch (err) {
      return { success: false, code: 0, message: err instanceof Error ? err.message : 'Network error' };
    }
  }

  /**
   * Read current cloud server / MQTT settings from the device.
   * POST /serverSetting {"password":"123456","set":0}  — set:0 means READ
   */
  async getServerSettings(): Promise<{ success: true; settings: U5ServerSettings } | { success: false; message: string }> {
    try {
      const data = await this.post<{
        result?: number;
        cloudserver_address?: string;
        cloudserver_pollingtime?: number;
        protocol_type?: number;
        mqtt_app_address?: string;
        mqtt_register_address?: string;
        third_ip_ddr?: string;
        third_ip?: number;
      }>('/serverSetting', { password: this.password, set: 0 });

      return {
        success: true,
        settings: {
          cloudServerAddress:    data.cloudserver_address     ?? '',
          cloudServerPollingSec: data.cloudserver_pollingtime ?? 10,
          protocolType:          data.protocol_type           ?? 0,
          mqttAppAddress:        data.mqtt_app_address        ?? '',
          mqttRegisterAddress:   data.mqtt_register_address   ?? '',
          thirdPartyAddress:     data.third_ip_ddr            ?? '',
          thirdPartyEnabled:     (data.third_ip ?? 0) === 1,
        },
      };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : 'Network error' };
    }
  }

  /**
   * Point the device at our cloud/MQTT server.
   * POST /serverSetting {"password":"123456","set":1,"cloudserver_address":"http://our-server",...}
   * Call this during onboarding to redirect device from manufacturer cloud to our server.
   */
  async setServerSettings(settings: Partial<U5ServerSettings>): Promise<U5Result> {
    try {
      const current = await this.getServerSettings();
      const merged  = current.success ? current.settings : {} as U5ServerSettings;
      const data    = await this.post<{ result: number; message?: string }>('/serverSetting', {
        password:                this.password,
        set:                     1,
        cloudserver_address:     settings.cloudServerAddress    ?? merged.cloudServerAddress    ?? 'http://',
        cloudserver_pollingtime: settings.cloudServerPollingSec ?? merged.cloudServerPollingSec ?? 10,
        protocol_type:           settings.protocolType          ?? merged.protocolType          ?? 0,
        mqtt_app_address:        settings.mqttAppAddress        ?? merged.mqttAppAddress        ?? '',
        mqtt_register_address:   settings.mqttRegisterAddress   ?? merged.mqttRegisterAddress   ?? '',
        third_ip_ddr:            settings.thirdPartyAddress     ?? merged.thirdPartyAddress     ?? '',
        third_ip:                settings.thirdPartyEnabled     ?? merged.thirdPartyEnabled     ? 1 : 0,
      });
      return data.result === 0
        ? { success: true }
        : { success: false, code: data.result, message: data.message ?? `serverSetting failed (result ${data.result})` };
    } catch (err) {
      return { success: false, code: 0, message: err instanceof Error ? err.message : 'Network error' };
    }
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
    try {
      const data = await this.post<{ code: number }>('/insertEmployee', {
        password:           this.password,
        name:               opts.name.slice(0, 10),
        id_number:          opts.idNumber,
        access_card_number: opts.cardNumber ?? '',
        pass_date:          '0',
        pass_time:          '0',
        pic_large:          opts.picLarge,
      });
      if (data.code === U5_CODE_OK)        return { success: true };
      if (data.code === U5_CODE_DUPLICATE) {
        return { success: false, code: 12, message: 'Face already enrolled or too similar to an existing member — use a clearer/different photo' };
      }
      return { success: false, code: data.code, message: `U5 enrollment rejected (code ${data.code})` };
    } catch (err) {
      return { success: false, code: 0, message: err instanceof Error ? err.message : 'Network error reaching U5' };
    }
  }

  /**
   * Fetch all enrolled employees from the U5 machine.
   * Returns userId (machine-generated), name, id_number, and pic_large (raw base64, no data: prefix).
   */
  async getEmployeeList(): Promise<{
    success: true;
    data: Array<{ userId: string; name: string; id_number?: string; pic_large?: string }>;
  } | { success: false; code: number; message: string }> {
    try {
      const data = await this.post<{
        result?: number; code?: number;
        data?: Array<{ userid: string; name: string; id_number?: string; pic_large?: string }>;
      }>('/getEmployeeList', { password: this.password });

      const ok = data.result === 0 || data.code === U5_CODE_OK || (data.result === undefined && data.code === undefined);
      if (!ok) {
        return { success: false, code: data.result ?? data.code ?? -1, message: 'U5 list failed' };
      }
      return {
        success: true,
        data: (data.data ?? []).map(e => ({
          userId:                      e.userid,
          name:                        e.name,
          ...(e.id_number  !== undefined && { id_number:  e.id_number }),
          ...(e.pic_large  !== undefined && { pic_large:  e.pic_large }),
        })),
      };
    } catch (err) {
      return { success: false, code: 0, message: err instanceof Error ? err.message : 'Network error reaching U5' };
    }
  }

  /**
   * Delete a person from the U5 machine by their machine-assigned userId.
   * To delete by id_number (our memberCode), call getEmployeeList first to resolve userId.
   */
  async deleteEmployee(userId: string): Promise<U5Result> {
    try {
      const data = await this.post<{ result?: number; code?: number; message?: string }>(
        '/deleteEmployee',
        { password: this.password, userId },
      );
      const ok = data.result === 0 || data.code === U5_CODE_OK;
      return ok
        ? { success: true }
        : { success: false, code: data.result ?? data.code ?? -1, message: data.message ?? 'U5 delete failed' };
    } catch (err) {
      return { success: false, code: 0, message: err instanceof Error ? err.message : 'Network error reaching U5' };
    }
  }

  /**
   * Fetch punch records from the U5 machine page by page.
   *
   * Safety rules (Mongoose/6.18 single-connection embedded server):
   *  - pic_large is stripped from every row — attendance sync never needs face images,
   *    and the base64 payload per page can exceed 300KB, locking the device.
   *  - 600 ms delay between pages so the device has time to free its HTTP stack.
   *  - Hard cap of 200 pages (~2 000 records max per poll) to prevent runaway loops.
   *
   * @param afterTime  ISO string — skip records at or before this timestamp (incremental sync).
   */
  async getAttendanceLogs(afterTime?: string): Promise<{
    success: true;
    data: Array<{ userId: string; checkin_time: string; ispass?: number; id_number?: string }>;
  } | { success: false; code: number; message: string }> {
    type Row = { userid?: string; userId?: string; checkin_time: string; ispass?: number; pic_large?: string; id_number?: string };
    const all: Array<{ userId: string; checkin_time: string; ispass?: number; id_number?: string }> = [];
    const cutoff  = afterTime ? new Date(afterTime).getTime() : 0;
    const MAX_PAGES = 200;
    let pageIndex = 0;
    let pageSum   = 1;

    do {
      if (pageIndex > 0) {
        // Give the device 600 ms to release its single HTTP connection before next page
        await new Promise(r => setTimeout(r, 600));
      }

      try {
        const data = await this.post<{ result?: number; code?: number; page_sum?: number; data?: Row[] }>(
          '/getWorkNoteList',
          { password: this.password, type: 2, index: pageIndex },
        );
        const failed = (data.result !== undefined && data.result !== 0) ||
                       (data.code  !== undefined && data.code  !== U5_CODE_OK);
        if (failed) {
          return { success: false, code: data.result ?? data.code ?? -1, message: 'U5 attendance failed' };
        }
        pageSum = Math.min(data.page_sum ?? 1, MAX_PAGES);
        for (const row of data.data ?? []) {
          // pic_large intentionally dropped — can be hundreds of KB per record
          if (cutoff && new Date(row.checkin_time).getTime() <= cutoff) continue;
          all.push({
            userId:       row.userid ?? row.userId ?? '',
            checkin_time: row.checkin_time,
            ...(row.ispass    !== undefined && { ispass:    row.ispass }),
            ...(row.id_number !== undefined && { id_number: row.id_number }),
          });
        }
        pageIndex++;
      } catch (err) {
        return { success: false, code: 0, message: err instanceof Error ? err.message : 'Network error reaching U5' };
      }
    } while (pageIndex < pageSum);

    return { success: true, data: all };
  }

  /**
   * Quick reachability check — returns true if U5 web UI responds.
   * Prefers /getDeviceVersion over / for a more meaningful alive check.
   */
  async ping(): Promise<boolean> {
    try {
      const result = await this.getDeviceVersion();
      return result.success;
    } catch {
      return false;
    }
  }

  /**
   * Full onboarding sequence for a newly discovered device:
   *  1. deviceLogin  — confirm credentials work
   *  2. getDeviceVersion — read SN / firmware
   *  3. setServerSettings — point device at our MQTT server
   * Returns the device info on success.
   */
  async onboard(ourServerUrl: string): Promise<{ success: true; info: U5DeviceInfo } | { success: false; message: string }> {
    const login = await this.deviceLogin();
    if (!login.success) return { success: false, message: `Login failed: ${login.message}` };

    const version = await this.getDeviceVersion();
    if (!version.success) return { success: false, message: `getDeviceVersion failed: ${version.message}` };

    const cfg = await this.setServerSettings({ cloudServerAddress: ourServerUrl });
    if (!cfg.success) return { success: false, message: `serverSetting failed: ${cfg.message}` };

    return { success: true, info: version.info };
  }
}
