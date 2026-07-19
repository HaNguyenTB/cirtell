import { spawn } from 'node:child_process';
import { access, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const sourceDir = path.join(repoRoot, 'latex', 'diagrams', 'mermaid');
const renderedDir = path.join(repoRoot, 'latex', 'diagrams', 'rendered');
const checkDir = path.join(repoRoot, 'latex', 'diagrams', '.check');
const configPath = path.join(sourceDir, 'mermaid.config.json');

const args = new Set(process.argv.slice(2));
const shouldClean = args.has('--clean');
const shouldCheck = args.has('--check');

const outputWidths = new Map([
  ['02-to-be-process', 1500],
  ['03-usecase-overview', 1600],
  ['03-architecture', 1650],
  ['03-erd-overview', 1700],
  ['03-erd-tenant-auth', 1500],
  ['03-erd-parts-transactions', 1600],
  ['03-erd-warehouse-inventory', 1500],
  ['03-erd-project-core', 1500],
  ['03-erd-project-evidence-lookup', 1600],
  ['03-erd-carbon-control', 1400],
  ['04-transaction-flow', 1700],
  ['04-deployment-cloudflare', 1600],
]);

async function listMermaidFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listMermaidFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.mmd')) {
      files.push(fullPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function runMermaid(inputPath, outputPath, width) {
  const executable = path.join(
    repoRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'mmdc.cmd' : 'mmdc',
  );
  const cliArgs = [
    '--input',
    inputPath,
    '--output',
    outputPath,
    '--configFile',
    configPath,
    '--backgroundColor',
    'white',
    '--width',
    String(width),
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(executable, cliArgs, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error([
        `Mermaid render failed for ${path.relative(repoRoot, inputPath)}`,
        stderr.trim(),
        stdout.trim(),
      ].filter(Boolean).join('\n')));
    });
  });
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cleanDir(dir, { allowBusyFallback = false } = {}) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      return;
    } catch (err) {
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(err?.code) || attempt === 3) {
        if (allowBusyFallback && ['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(err?.code)) {
          console.warn(`Warning: could not clean ${path.relative(repoRoot, dir)} (${err.code}); rendering into existing directory.`);
          await mkdir(dir, { recursive: true });
          return;
        }
        throw err;
      }
      await wait(500 * attempt);
    }
  }
  await mkdir(dir, { recursive: true });
}

if (shouldClean) {
  await cleanDir(renderedDir);
  console.log(`Cleaned ${path.relative(repoRoot, renderedDir)}`);
  process.exit(0);
}

const outputDir = shouldCheck ? checkDir : renderedDir;
await cleanDir(outputDir, { allowBusyFallback: !shouldCheck });

const files = await listMermaidFiles(sourceDir);
if (files.length === 0) {
  throw new Error(`No Mermaid files found in ${path.relative(repoRoot, sourceDir)}`);
}

for (const file of files) {
  const basename = path.basename(file, '.mmd');
  const outputPath = path.join(outputDir, `${basename}.pdf`);
  const width = outputWidths.get(basename) ?? 1300;
  try {
    await runMermaid(file, outputPath, width);
    console.log(`${path.relative(repoRoot, file)} -> ${path.relative(repoRoot, outputPath)}`);
  } catch (err) {
    if (
      !shouldCheck
      && /EBUSY|EPERM/.test(err?.message || '')
      && await fileExists(outputPath)
    ) {
      console.warn(`Warning: kept locked output ${path.relative(repoRoot, outputPath)}.`);
      continue;
    }
    throw err;
  }
}

if (shouldCheck) {
  await rm(checkDir, { recursive: true, force: true });
  console.log(`Checked ${files.length} Mermaid diagram(s).`);
} else {
  console.log(`Rendered ${files.length} Mermaid diagram(s).`);
}
