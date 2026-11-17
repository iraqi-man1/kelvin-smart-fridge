export type User = {
  id: string; email: string; createdAt: number; avatar: string | null; hasLockCode: boolean;
  otpEmail: boolean; emailReady: boolean; prefs: Prefs; role: Role;
  name: string; studentId: string; university: string; faculty: string; phone: string; bio: string;
  /** Admin list only: whether the admin set this password (and can see it) or the user chose it. */
  password?: { known: boolean; self: boolean; by: string | null; at: number | null };
};

/** A code was emailed: `challenge` names it, `email` is the masked address, `resendIn` in seconds. */
import type { Lang, Reading, Settings } from './types';

/** What the account keeps on the server, so it follows the user to any browser. */
export type Prefs = {
  settings?: Partial<Settings>; lock?: { hidden: string; idle: number };
  lang?: Lang; theme?: 'light' | 'dark'; mode?: 'demo' | 'live';
};

export type Role = 'admin' | 'member' | 'viewer';
export const canManage = (u: User) => u.role === 'admin';
export const canControl = (u: User) => u.role === 'admin' || u.role === 'member';

export type Invite = { id: string; role: Role; email: string; name: string; expires: number; createdAt: number; by: string };
export type InvitePreview = { email: string; name: string; role: Role; by: string; expires: number };
export type DeviceKey = { id: string; label: string; hint: string; createdAt: number; by: string; lastUsed: number | null; retireAt?: number; replaces?: string };
/** One line of the security log (admin only). */
export type AuditEntry = {
  id: string; at: number; action: string; ip: string; browser: string; detail: string;
  actor: { id?: string; name: string; email?: string } | null; target: { id?: string; name: string; email?: string } | null;
};
export type Command = { id: string; type: 'beep' | 'led' | 'message' | 'interval' | 'reboot'; value: unknown; by: string; createdAt: number; status: 'pending' | 'sent' | 'done' | 'cancelled' };
export type DeviceStatus = { protected: boolean; keys: DeviceKey[]; lastSeen: number | null; commands: Command[] };

export type Otp = { challenge: string; email: string; resendIn: number };

/** Usage numbers for the badges (counted on the server). */
export type Activity = { memberDays: number; activeDays: number; streak: number; bestStreak: number; logins: number; exports: number; commands: number; reports: number; firstDay: string | null };

export type SupportCategory = 'fault' | 'problem' | 'account' | 'question';
export type Ticket = { id: string; userId: string; name: string; email?: string; role: Role; category: SupportCategory; message: string; at: number };
export type SupportConfig = { enabled: boolean; configured: boolean; chatId: string; fromEnv: boolean; lang: 'ar' | 'en' | 'ms' };

export type Profile = Pick<User, 'name' | 'studentId' | 'university' | 'faculty' | 'phone' | 'bio'>;

/** Throws an Error whose message is the server's stable code (e.g. "email-taken"). */
async function call<T>(path: string, method = 'GET', data?: unknown, raw?: Blob): Promise<T> {
  const res = await fetch(path, {
    method, credentials: 'same-origin',
    headers: raw ? { 'Content-Type': raw.type } : data !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: raw ?? (data !== undefined ? JSON.stringify(data) : undefined),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'request-failed');
  return body as T;
}

export const api = {
  me: () => call<{ user: User; locked: boolean }>('/api/me'),
  lock: () => call('/api/auth/lock', 'POST', {}),
  unlock: (method: 'code' | 'password', secret: string) => call('/api/auth/unlock', 'POST', { method, secret }),
  lockCode: (password: string, code: string | null) => call<{ user: User }>('/api/me/lock-code', 'PUT', { password, code }).then(b => b.user),
  register: (name: string, email: string, password: string) => call<{ user: User }>('/api/auth/register', 'POST', { name, email, password }).then(b => b.user),
  signupInfo: () => call<{ firstAccount: boolean }>('/api/auth/signup-info'),
  // An emailed invitation: what it is for, then accept it with the password the admin chose.
  previewInvite: (code: string) => call<InvitePreview>(`/api/auth/invite?code=${encodeURIComponent(code)}`),
  acceptInvite: (invite: string, password: string) => call<{ user: User }>('/api/auth/invite', 'POST', { invite, password }).then(b => b.user),
  // With two-step sign-in on, the answer is { otp } and no session yet.
  login: (email: string, password: string, lang: string) => call<{ user?: User; otp?: Otp }>('/api/auth/login', 'POST', { email, password, lang }),
  verifyOtp: (challenge: string, code: string) => call<{ user: User }>('/api/auth/otp/verify', 'POST', { challenge, code }).then(b => b.user),
  resendOtp: (challenge: string) => call<{ otp: Otp }>('/api/auth/otp/resend', 'POST', { challenge }).then(b => b.otp),
  // Admin
  adminUsers: () => call<{ users: User[]; invites: Invite[] }>('/api/admin/users'),
  setRole: (id: string, role: Role) => call<{ user: User }>(`/api/admin/users/${id}`, 'PUT', { role }).then(b => b.user),
  removeUser: (id: string) => call(`/api/admin/users/${id}`, 'DELETE'),
  invite: (input: { name: string; email: string; role: Role; password: string; lang: string }) => call<{ invite: Invite; link: string }>('/api/admin/invites', 'POST', input),
  resendInvite: (id: string, lang: string) => call<{ invite: Invite; link: string }>(`/api/admin/invites/${id}/resend`, 'POST', { lang }),
  revealPassword: (id: string) => call<{ password: string | null; self: boolean; at: number | null }>(`/api/admin/users/${id}/password`),
  setPassword: (id: string, password: string) => call(`/api/admin/users/${id}/password`, 'PUT', { password }),
  revokeInvite: (id: string) => call(`/api/admin/invites/${id}`, 'DELETE'),
  // Badges
  activity: () => call<{ stats: Activity }>('/api/me/activity').then(b => b.stats),
  noteExport: () => call<{ stats: Activity }>('/api/me/activity', 'POST', { event: 'export' }).then(b => b.stats),
  // IT support
  support: () => call<{ config: SupportConfig; tickets: Ticket[] }>('/api/support'),
  report: (category: SupportCategory, message: string) => call<{ ticket: Ticket }>('/api/support', 'POST', { category, message }).then(b => b.ticket),
  supportConfig: (input: { enabled?: boolean; token?: string; chatId?: string; lang?: string }) => call<{ config: SupportConfig }>('/api/support/config', 'PUT', input).then(b => b.config),
  supportTest: () => call('/api/support/test', 'POST', {}),
  // Device
  device: () => call<DeviceStatus>('/api/device'),
  command: (type: Command['type'], value?: unknown) => call<{ command: Command }>('/api/device/commands', 'POST', { type, value }).then(b => b.command),
  cancelCommand: (id: string) => call<DeviceStatus>(`/api/device/commands/${id}`, 'DELETE'),
  createKey: (label: string) => call<{ key: string; entry: DeviceKey }>('/api/device/keys', 'POST', { label }),
  revokeKey: (id: string) => call<DeviceStatus>(`/api/device/keys/${id}`, 'DELETE'),
  rotateKey: (id: string) => call<{ key: string; entry: DeviceKey; old: DeviceKey }>(`/api/device/keys/${id}/rotate`, 'POST', {}),
  audit: () => call<{ entries: AuditEntry[] }>('/api/admin/audit').then(b => b.entries),
  /** Readings of an earlier period, averaged into at most `points` slices (for comparison). */
  readingsRange: (from: number, to: number, points = 300) => call<{ readings: Reading[] }>(`/api/readings/range?from=${Math.round(from)}&to=${Math.round(to)}&points=${points}`).then(b => b.readings),
  savePrefs: (patch: Prefs) => call<{ user: User }>('/api/me/prefs', 'PUT', patch).then(b => b.user),
  resetRequest: (email: string, lang: string) => call<{ otp: Otp }>('/api/auth/reset/request', 'POST', { email, lang }).then(b => b.otp),
  resetConfirm: (challenge: string, code: string, password: string) => call<{ user: User }>('/api/auth/reset/confirm', 'POST', { challenge, code, password }).then(b => b.user),
  otpStart: (lang: string) => call<{ otp: Otp }>('/api/me/otp/start', 'POST', { lang }).then(b => b.otp),
  otpEnable: (challenge: string, code: string) => call<{ user: User }>('/api/me/otp/enable', 'POST', { challenge, code }).then(b => b.user),
  otpDisable: (password: string) => call<{ user: User }>('/api/me/otp/disable', 'POST', { password }).then(b => b.user),
  logout: () => call('/api/auth/logout', 'POST', {}),
  update: (profile: Partial<Profile>) => call<{ user: User }>('/api/me', 'PUT', profile).then(b => b.user),
  password: (current: string, next: string) => call('/api/me/password', 'PUT', { current, next }),
  avatar: (image: Blob) => call<{ user: User }>('/api/me/avatar', 'POST', undefined, image).then(b => b.user),
  removeAvatar: () => call<{ user: User }>('/api/me/avatar', 'DELETE').then(b => b.user),
  remove: (password: string) => call('/api/me', 'DELETE', { password }),
};

export const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(w => [...w][0] ?? '').join('').toUpperCase() || '?';
