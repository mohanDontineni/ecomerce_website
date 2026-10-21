import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { platform, release } from 'node:os';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireBuild = process.argv.includes('--built');
const sourceBuildOnly = process.env.MDCART_SOURCE_BUILD_ONLY === '1';
const errors = [];
const warnings = [];

function versionParts(value) {
  return value
    .split('.')
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
}

function versionAtLeast(actual, minimum) {
  const left = versionParts(actual);
  const right = versionParts(minimum);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if ((left[index] ?? 0) > (right[index] ?? 0)) return true;
    if ((left[index] ?? 0) < (right[index] ?? 0)) return false;
  }
  return true;
}

function requireFile(relativePath, label = relativePath) {
  if (!existsSync(resolve(projectRoot, relativePath))) {
    errors.push(`Missing ${label}: ${relativePath}`);
  }
}

if (!versionAtLeast(process.versions.node, '22.13.0')) {
  errors.push(
    `Node.js ${process.versions.node} is unsupported; install Node.js 22.13.0 or newer.`,
  );
}

const operatingSystem = platform();
if (operatingSystem === 'linux') {
  const report = process.report?.getReport();
  const glibc = report?.header?.glibcVersionRuntime;
  if (typeof glibc === 'string' && !versionAtLeast(glibc, '2.35')) {
    errors.push(
      `glibc ${glibc} is unsupported by the bundled Wrangler runtime; use glibc 2.35 or newer.`,
    );
  } else if (!glibc) {
    const message =
      'glibc was not detected. Direct Wrangler deployment requires a Linux distribution with glibc 2.35 or newer; musl-only distributions are unsupported.';
    if (sourceBuildOnly) warnings.push(message);
    else errors.push(message);
  }
} else if (operatingSystem === 'win32') {
  const windowsBuild = Number.parseInt(release().split('.')[2] ?? '0', 10);
  let installationType = '';
  try {
    installationType = execFileSync(
      'reg.exe',
      [
        'query',
        'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion',
        '/v',
        'InstallationType',
      ],
      { encoding: 'utf8', windowsHide: true },
    );
  } catch {
    // The explicit unsupported-host message below covers failed detection.
  }
  const isWindows11Client =
    Number.isFinite(windowsBuild) &&
    windowsBuild >= 22_000 &&
    /InstallationType\s+REG_SZ\s+Client\b/i.test(installationType);
  if (!isWindows11Client) {
    const message = `Windows host ${release()} is not a detected Windows 11 client. Direct Wrangler deployment is supported from Windows 11; use Windows 11 or a supported Linux/WSL2 environment.`;
    if (sourceBuildOnly)
      warnings.push(`${message} Source-build validation will continue.`);
    else errors.push(message);
  }
} else if (operatingSystem !== 'darwin') {
  warnings.push(
    `The ${operatingSystem} operator platform is not covered by the MDCart deployment guides.`,
  );
}

for (const path of [
  'package.json',
  'pnpm-lock.yaml',
  '.env.example',
  '.openai/hosting.json',
  'wrangler.local.jsonc',
  'wrangler.deploy.example.jsonc',
  'drizzle',
]) {
  requireFile(path);
}

try {
  const hosting = JSON.parse(
    readFileSync(resolve(projectRoot, '.openai/hosting.json'), 'utf8'),
  );
  if (hosting.d1 !== 'DB') {
    errors.push(".openai/hosting.json must bind D1 as 'DB'.");
  }
  if (hosting.r2 !== 'FILES') {
    errors.push(".openai/hosting.json must bind R2 as 'FILES'.");
  }
  if (
    typeof hosting.project_id !== 'string' ||
    hosting.project_id.trim().length === 0
  ) {
    errors.push('.openai/hosting.json must contain a non-empty project_id.');
  }
} catch (error) {
  errors.push(
    `.openai/hosting.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
  );
}

try {
  const migrations = readdirSync(resolve(projectRoot, 'drizzle')).filter(
    (name) => name.endsWith('.sql'),
  );
  if (migrations.length === 0) {
    errors.push('No checked-in D1 SQL migrations were found in drizzle/.');
  }
} catch {
  // The missing directory is already reported above.
}

const deploymentConfig = resolve(projectRoot, 'wrangler.deploy.jsonc');
if (existsSync(deploymentConfig)) {
  const text = readFileSync(deploymentConfig, 'utf8');
  if (/REPLACE_WITH_|(?:^|[.])example\.com\b/i.test(text)) {
    errors.push(
      'wrangler.deploy.jsonc still contains a placeholder database ID or example.com hostname.',
    );
  }
  const environmentNames = ['staging', 'production'];
  const starts = environmentNames
    .map((name) => ({
      name,
      index: text.search(new RegExp(`"${name}"\\s*:\\s*\\{`)),
    }))
    .sort((left, right) => left.index - right.index);
  for (let index = 0; index < starts.length; index += 1) {
    const environment = starts[index];
    if (environment.index < 0) {
      errors.push(
        `wrangler.deploy.jsonc is missing the ${environment.name} environment.`,
      );
      continue;
    }
    const nextStart = starts
      .slice(index + 1)
      .find((candidate) => candidate.index > environment.index);
    const block = text.slice(
      environment.index,
      nextStart?.index ?? text.length,
    );
    for (const binding of ['DB', 'FILES']) {
      const pattern = new RegExp(`["']binding["']\\s*:\\s*["']${binding}["']`);
      if (!pattern.test(block)) {
        errors.push(
          `wrangler.deploy.jsonc ${environment.name} is missing the ${binding} binding.`,
        );
      }
    }
  }
} else {
  warnings.push(
    'wrangler.deploy.jsonc is not present. Copy the example before a direct Cloudflare deployment.',
  );
}

if (!existsSync(resolve(projectRoot, 'node_modules/.bin/wrangler'))) {
  warnings.push(
    'Dependencies are not installed; run pnpm install --frozen-lockfile.',
  );
}

if (requireBuild) {
  requireFile('dist/server/index.js', 'compiled Worker entrypoint');
  requireFile('dist/client', 'compiled client assets');
  requireFile('dist/.openai/hosting.json', 'packaged Sites manifest');
}

for (const warning of warnings) console.warn(`WARN: ${warning}`);
for (const error of errors) console.error(`ERROR: ${error}`);

if (errors.length > 0) {
  console.error(`Deployment readiness failed with ${errors.length} error(s).`);
  process.exitCode = 1;
} else {
  const readiness = sourceBuildOnly
    ? 'Source/build prerequisites'
    : 'Deployment prerequisites';
  console.log(
    `${readiness} are ready on ${operatingSystem} with Node.js ${process.versions.node}.`,
  );
}
