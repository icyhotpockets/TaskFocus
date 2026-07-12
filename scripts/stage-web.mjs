import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const source = resolve(args.get('--source') ?? 'www');
const output = resolve(args.get('--output') ?? 'dist/pages');
const build = args.get('--build');

if (!build) throw new Error('Missing required --build value');

const version = {
  build,
  versionCode: Number.parseInt(args.get('--version-code') ?? '0', 10) || null,
  versionName: args.get('--version-name') ?? null,
};
const pushConfig = {
  workerUrl: String(process.env.TASKFOCUS_PUSH_WORKER_URL || ""),
  vapidPublicKey: "BDbHQqC9eKYs8besRzUX3-30Q_UY2t9mi4xgvfwmN7VFAGQvQkHlhk2xbn2lAhrtILy1wicWICbvPRHpX0_tIOU",
};

rmSync(output, { force: true, recursive: true });
mkdirSync(output, { recursive: true });
cpSync(source, output, { recursive: true });
writeFileSync(resolve(output, '.nojekyll'), '');
writeFileSync(resolve(output, 'version.json'), `${JSON.stringify(version)}\n`);
writeFileSync(resolve(output, 'push-config.json'), `${JSON.stringify(pushConfig)}\n`);
