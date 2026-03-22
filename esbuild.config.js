// @ts-check
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isWatch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const extensionBuildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'es2020',
  sourcemap: true,
  minify: false,
};

/** @type {import('esbuild').BuildOptions} */
const webviewBuildOptions = {
  entryPoints: ['webview/src/main.ts'],
  bundle: true,
  outfile: 'dist/webview.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  minify: false,
};

async function main() {
  // Create dist directory if it doesn't exist
  if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist', { recursive: true });
  }

  // Copy CSS file
  const cssSource = path.join('webview', 'src', 'theme.css');
  const cssTarget = path.join('dist', 'webview.css');
  if (fs.existsSync(cssSource)) {
    fs.copyFileSync(cssSource, cssTarget);
    console.log('[esbuild] copied webview CSS');
  }

  if (isWatch) {
    const extensionCtx = await esbuild.context(extensionBuildOptions);
    const webviewCtx = await esbuild.context(webviewBuildOptions);
    
    await extensionCtx.watch();
    await webviewCtx.watch();
    
    console.log('[esbuild] watching for changes…');
  } else {
    await Promise.all([
      esbuild.build(extensionBuildOptions),
      esbuild.build(webviewBuildOptions)
    ]);
    console.log('[esbuild] build complete');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
