// esbuild Build-Skript fuer den Production-Packaging-Schritt.
//
// Zweck: Reduziert die VSIX-Groesse drastisch, indem der gesamte User-Code
// (src/**/*.ts) und alle JS-basierten Runtime-Dependencies in eine einzige
// Datei gebuendelt werden. Native Module (ssh2 transitiv) muessen extern
// bleiben, weil sie vorkompilierte .node-Binaries enthalten, die esbuild
// nicht verarbeiten kann.
//
// Architektur-Notiz (ADR-0004 / Schema-Layer 1 — Build-Pipeline):
//   src/extension.ts   --(tsc)-->  out/extension.js    (Dev + Tests)
//                         (esbuild)   dist/bundle.js     (Production-Packaging)
//
// Lokales Dev-Testing (npm run compile) nutzt tsc, weil mocha die
// out/test/unit/*.test.js-Dateien braucht. Beim Packaging laeuft der
// esbuild-Schritt zusaetzlich und ersetzt out/extension.js durch das
// fertige Bundle.

import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.argv.includes('--production');

const config = {
    entryPoints: [path.join(__dirname, 'src', 'extension.ts')],
    bundle: true,
    outfile: path.join(__dirname, 'out', 'extension.js'),
    platform: 'node',
    target: 'node16',
    format: 'cjs',
    sourcemap: false,
    minify: isProd,
    treeShaking: true,
    // Externe Module:
    // - `vscode` wird von der VS-Code-Runtime bereitgestellt.
    // - `ssh2` enthaelt native C++-Bindings (cpu-features), die esbuild
    //   nicht bundlen kann. Beim Packaging muss ssh2 in node_modules/
    //   verfuegbar sein (.vscodeignore whitelisted es).
    // - `ssh2-sftp-client` ist reines JS, wird gebuendelt — es holt sich
    //   ssh2 ueblicherweise via require() und faengt unsere extern-
    //   Deklaration korrekt ab.
    external: ['vscode', 'ssh2'],
    logLevel: 'info'
};

build(config).catch((err) => {
    console.error('[esbuild] Build failed:', err);
    process.exit(1);
});
