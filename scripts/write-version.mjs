import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const output = resolve(args.get('--output') ?? 'www/version.json');
const build = args.get('--build');

if (!build) throw new Error('Missing required --build value');

const version = {
  build,
  versionCode: Number.parseInt(args.get('--version-code') ?? '0', 10) || null,
  versionName: args.get('--version-name') ?? null,
};

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(version)}\n`);
