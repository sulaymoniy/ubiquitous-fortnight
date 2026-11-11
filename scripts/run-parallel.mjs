// Runs one npm script in every workspace that defines it, in parallel, with prefixed output.
// Used by `npm run dev`, because `npm run <script> --workspaces` runs workspaces one after another
// and a dev server never exits. Picks up new workspaces (for example src/web) without changes here.
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = process.argv[2];
if (!script) {
  console.error('usage: node scripts/run-parallel.mjs <script>');
  process.exit(2);
}

const srcDir = fileURLToPath(new URL('../src', import.meta.url));
const workspaces = readdirSync(srcDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(srcDir, d.name, 'package.json')))
  .map((d) => JSON.parse(readFileSync(join(srcDir, d.name, 'package.json'), 'utf8')))
  .filter((pkg) => pkg.scripts && pkg.scripts[script]);

if (workspaces.length === 0) {
  console.error(`no workspace defines "${script}"`);
  process.exit(1);
}

const children = workspaces.map((pkg) => {
  const label = `[${pkg.name.replace('@fortnight/', '')}]`;
  const child = spawn('npm', ['run', script, '-w', pkg.name], {
    shell: true,
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  const prefix = (stream, out) =>
    stream.on('data', (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) if (line) out.write(`${label} ${line}\n`);
    });
  prefix(child.stdout, process.stdout);
  prefix(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${label} exited with code ${code}`);
    for (const other of children) if (other !== child) other.kill();
    process.exitCode = code ?? 1;
  });
  return child;
});

const stopAll = () => children.forEach((c) => c.kill());
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
