import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const require = createRequire(import.meta.url);
const { inject } = require('postject');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const distDir = path.join(rootDir, 'dist');
const buildDir = path.join(distDir, 'build');
const buildPublicDir = path.join(buildDir, 'public');

const NODE_SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
}

/**
 * Resolves @import url('/styles/...') directives in public/styles.css and minifies into one CSS asset.
 */
async function buildFrontendCss() {
  const entryCssPath = path.join(publicDir, 'styles.css');
  const entryCss = await fs.readFile(entryCssPath, 'utf8');
  const importRegex = /^@import\s+url\(['"]([^'"]+)['"]\);\s*$/gm;

  const chunks = [];
  let match;
  let lastIndex = 0;

  while ((match = importRegex.exec(entryCss)) !== null) {
    const before = entryCss.slice(lastIndex, match.index).trim();
    if (before) {
      chunks.push(before);
    }
    const importPath = match[1].replace(/^\/+/, '');
    const resolvedFile = path.join(publicDir, importPath);
    chunks.push(await fs.readFile(resolvedFile, 'utf8'));
    lastIndex = importRegex.lastIndex;
  }

  const tail = entryCss.slice(lastIndex).trim();
  if (tail) {
    chunks.push(tail);
  }

  const result = await esbuild.transform(chunks.join('\n\n'), {
    loader: 'css',
    minify: true,
  });

  const outPath = path.join(buildPublicDir, 'styles.css');
  await fs.writeFile(outPath, result.code, 'utf8');
  return outPath;
}

/**
 * Bundles and minifies public/js/main.js ES modules into one browser-ready IIFE script.
 */
async function buildFrontendJs() {
  const outPath = path.join(buildPublicDir, 'app.js');
  await esbuild.build({
    entryPoints: [path.join(publicDir, 'js', 'main.js')],
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['es2020'],
    outfile: outPath,
  });
  return outPath;
}

/**
 * Rewrites public/index.html to load the bundled /app.js script in production.
 */
async function buildFrontendHtml() {
  const htmlPath = path.join(publicDir, 'index.html');
  const html = await fs.readFile(htmlPath, 'utf8');
  const moduleScriptTag = '<script type="module" src="/js/main.js"></script>';

  if (!html.includes(moduleScriptTag)) {
    throw new Error(`Tag "${moduleScriptTag}" tidak ditemukan di public/index.html`);
  }

  const prodHtml = html.replace(moduleScriptTag, '<script defer src="/app.js"></script>');
  const outPath = path.join(buildPublicDir, 'index.html');
  await fs.writeFile(outPath, prodHtml, 'utf8');
  return outPath;
}

/**
 * Bundles server.js and all JS dependencies (including Express) into one CJS bundle.
 */
async function buildBackend() {
  const outPath = path.join(buildDir, 'server.cjs');
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'server.js')],
    bundle: true,
    minify: true,
    platform: 'node',
    format: 'cjs',
    target: ['node24'],
    outfile: outPath,
  });
  return outPath;
}

/**
 * Packages the bundled server and minified frontend assets into a standalone Node.js SEA binary.
 */
async function buildSeaExecutable() {
  const seaConfigPath = path.join(buildDir, 'sea-config.json');
  const blobPath = path.join(buildDir, 'sea-prep.blob');
  const binaryName = process.platform === 'win32' ? 'SimpleTaskList.exe' : 'SimpleTaskList';
  const outBinaryPath = path.join(distDir, binaryName);

  const seaConfig = {
    main: 'server.cjs',
    output: 'sea-prep.blob',
    disableExperimentalSEAWarning: true,
    useCodeCache: false,
    assets: {
      'public/index.html': 'public/index.html',
      'public/styles.css': 'public/styles.css',
      'public/app.js': 'public/app.js',
    },
  };

  await fs.writeFile(seaConfigPath, `${JSON.stringify(seaConfig, null, 2)}\n`, 'utf8');

  execFileSync(process.execPath, ['--experimental-sea-config', 'sea-config.json'], {
    cwd: buildDir,
    stdio: 'inherit',
  });

  await fs.copyFile(process.execPath, outBinaryPath);
  if (process.platform !== 'win32') {
    await fs.chmod(outBinaryPath, 0o755);
  }

  const blobBuffer = await fs.readFile(blobPath);
  await inject(outBinaryPath, 'NODE_SEA_BLOB', blobBuffer, {
    sentinelFuse: NODE_SEA_FUSE,
    machoSegmentName: 'NODE_SEA',
    overwrite: true,
  });

  return outBinaryPath;
}

async function main() {
  const bundleOnly = process.argv.includes('--bundle-only');

  console.log('1/4 Membersihkan direktori build...');
  await fs.rm(buildDir, { recursive: true, force: true });
  await fs.mkdir(buildPublicDir, { recursive: true });

  console.log('2/4 Mem-bundle & minify aset frontend...');
  const [cssOut, jsOut, htmlOut] = await Promise.all([
    buildFrontendCss(),
    buildFrontendJs(),
    buildFrontendHtml(),
  ]);

  console.log('3/4 Mem-bundle backend Node.js...');
  const serverOut = await buildBackend();

  const stats = await Promise.all([
    fs.stat(htmlOut),
    fs.stat(cssOut),
    fs.stat(jsOut),
    fs.stat(serverOut),
  ]);

  console.log(`   - index.html : ${formatBytes(stats[0].size)}`);
  console.log(`   - styles.css : ${formatBytes(stats[1].size)}`);
  console.log(`   - app.js     : ${formatBytes(stats[2].size)}`);
  console.log(`   - server.cjs : ${formatBytes(stats[3].size)}`);

  if (bundleOnly) {
    console.log('Selesai (--bundle-only). Output tersedia di dist/build/');
    return;
  }

  console.log('4/4 Mengemas standalone executable (Node.js SEA)...');
  const binaryOut = await buildSeaExecutable();
  const binaryStat = await fs.stat(binaryOut);
  console.log(`Build produksi selesai: ${binaryOut} (${formatBytes(binaryStat.size)})`);
}

main().catch((err) => {
  console.error('Build gagal:', err);
  process.exit(1);
});
