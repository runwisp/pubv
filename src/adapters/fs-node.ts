import { access, readFile, writeFile } from 'node:fs/promises';
import type { Fs } from '../ports/fs.js';

export const nodeFs: Fs = {
  async read(path) {
    return await readFile(path, 'utf8');
  },
  async write(path, contents) {
    await writeFile(path, contents, 'utf8');
  },
  async exists(path) {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  },
};
