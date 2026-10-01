import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deletePrivate, getPrivate, newStorageKey, putPrivate } from '@/lib/storage';

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'private-storage-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('private storage', () => {
  it('makes long, random, never repeating keys', () => {
    const keys = new Set(Array.from({ length: 200 }, () => newStorageKey('resumes', 'pdf')));
    expect(keys.size).toBe(200);
    for (const key of keys) expect(key).toMatch(/^resumes\/[a-f0-9]{48}\.pdf$/);
  });

  it('stores, reads back and deletes a file', async () => {
    const key = await putPrivate('resumes', Buffer.from('hello'), 'pdf', dir);
    expect((await getPrivate(key, dir)).toString()).toBe('hello');
    await deletePrivate(key, dir);
    await expect(getPrivate(key, dir)).rejects.toThrow();
    await expect(deletePrivate(key, dir)).resolves.toBeUndefined();
  });

  it('refuses keys that could escape the folder', async () => {
    for (const bad of ['../secret.txt', 'resumes/../../etc/passwd', '/etc/passwd', 'resumes/abc.pdf', 'resumes\\x.pdf', '']) {
      await expect(getPrivate(bad, dir)).rejects.toThrow('Invalid storage key');
      await expect(deletePrivate(bad, dir)).rejects.toThrow('Invalid storage key');
    }
    expect(() => newStorageKey('../x', 'pdf')).toThrow();
    expect(() => newStorageKey('resumes', 'p/df')).toThrow();
  });

  it('keeps files inside the storage folder', async () => {
    await putPrivate('resumes', Buffer.from('x'), 'docx', dir);
    expect((await readdir(path.join(dir, 'resumes'))).length).toBeGreaterThan(0);
    expect((await stat(dir)).isDirectory()).toBe(true);
  });
});
