import { api } from './client';

export interface VersionInfo {
  version:     string;
  releasesUrl: string;
}

export interface UpdateCheckResult {
  current:     string;
  latest:      string;
  hasUpdate:   boolean;
  changelog:   string;
  releaseDate: string;
}

export interface BackupSchedule {
  enabled:   boolean;
  interval:  'daily' | 'weekly' | 'manual';
  hour:      number;
  minute:    number;
  dayOfWeek: number;
}


export const adminApi = {
  version: () =>
    api.get<VersionInfo>('/admin/version').then((r) => r.data),

  checkUpdate: () =>
    api.get<UpdateCheckResult>('/admin/update/check').then((r) => r.data),

  applyUpdate: () =>
    api.post<{ status: string; message: string }>('/admin/update/apply').then((r) => r.data),

  backupNow: () => {
    // Trigger browser download via anchor element
    const a = document.createElement('a');
    a.href  = `${api.defaults.baseURL}/admin/backup`;
    a.click();
  },

  getSchedule: () =>
    api.get<BackupSchedule>('/admin/backup/schedule').then((r) => r.data),

  saveSchedule: (body: BackupSchedule) =>
    api.put<BackupSchedule>('/admin/backup/schedule', body).then((r) => r.data),
};
