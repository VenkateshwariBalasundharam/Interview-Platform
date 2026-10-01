// Private file storage (server only). Files live outside public/, under names nobody can guess, and are only ever
// served through admin-checked API routes. This driver writes to local disk; the same three functions can later be
// backed by Supabase Storage or Vercel Blob (needed for hosts without a persistent disk, such as Vercel).
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const KEY_PATTERN = /^[a-z0-9-]{1,32}\/[a-f0-9]{48}\.[a-z0-9]{1,8}$/;

function baseDir(override?: string): string {
  return path.resolve(process.cwd(), override ?? process.env.STORAGE_DIR ?? '.private-storage');
}

/** Non-guessable key: 192 random bits, so it cannot be enumerated. */
export function newStorageKey(bucket: string, ext: string): string {
  const key = `${bucket}/${randomBytes(24).toString('hex')}.${ext}`;
  if (!KEY_PATTERN.test(key)) throw new Error('Invalid storage bucket or extension');
  return key;
}

function resolveKey(key: string, dir?: string): string {
  if (!KEY_PATTERN.test(key)) throw new Error('Invalid storage key');
  const root = baseDir(dir);
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error('Invalid storage key');
  return full;
}

export async function putPrivate(bucket: string, data: Buffer, ext: string, dir?: string): Promise<string> {
  const key = newStorageKey(bucket, ext);
  const full = resolveKey(key, dir);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data, { mode: 0o600, flag: 'wx' });
  return key;
}

export async function getPrivate(key: string, dir?: string): Promise<Buffer> {
  return readFile(resolveKey(key, dir));
}

/** Deleting a file that is already gone is not an error. */
export async function deletePrivate(key: string, dir?: string): Promise<void> {
  await rm(resolveKey(key, dir), { force: true });
}
