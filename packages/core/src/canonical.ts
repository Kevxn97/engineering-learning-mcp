import { createHash, timingSafeEqual } from 'node:crypto';
import { fail } from './errors.js';
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (typeof value === 'object' && value && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  }
  return fail('INVALID_INPUT');
}
export const hash = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex');
export const hashText = (value: string): string => createHash('sha256').update(value).digest('hex');
export function constantEqual(a: string, b: string): boolean {
  const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y);
}
export function assertHash(body: unknown, expected: string): void { if (!constantEqual(hash(body), expected)) fail('INTEGRITY_ERROR'); }
export function assertSize(value: unknown, bytes: number): void { if (Buffer.byteLength(JSON.stringify(value), 'utf8') > bytes) fail('INVALID_INPUT', 'size'); }
export function assertJsonShape(value: unknown, depth = 0): void {
  if (depth > 12) fail('INVALID_INPUT', 'depth');
  if (typeof value === 'string') {
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)) fail('INVALID_INPUT', 'control_characters');
    return;
  }
  if (Array.isArray(value)) { if (value.length > 100) fail('INVALID_INPUT', 'array_size'); for (const x of value) assertJsonShape(x, depth + 1); return; }
  if (value && typeof value === 'object') {
    if (Object.keys(value).length > 64) fail('INVALID_INPUT');
    for (const [k, v] of Object.entries(value)) { if (['__proto__', 'prototype', 'constructor'].includes(k)) fail('INVALID_INPUT'); assertJsonShape(k, depth + 1); assertJsonShape(v, depth + 1); }
  }
}
