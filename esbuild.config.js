// @ts-check
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isWatch = process.argv.includes('--watch');

/** @type {import('esbuild').Plugin} */
const watchLogPlugin = {
  name: 'watch-log',
  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd((result) => {
      // Re-copy CSS on every rebuild so theme changes are picked up
      const src = path.join('webview', 'src', 'theme.css');
      const dst = path.join('dist', 'webview.css');
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dst);
      }
      const settSrc = path.join('webview', 'src', 'settings.css');
      const settDst = path.join('dist', 'settings.css');
      if (fs.existsSync(settSrc)) {
        fs.copyFileSync(settSrc, settDst);
      }
      if (result.errors.length) {
        console.log(`[watch] build finished with ${result.errors.length} error(s)`);
      } else {
        console.log('[watch] build finished');
      }
    });
  },
};

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
  entryPoints: ['webview/src/main.tsx'],
  bundle: true,
  outfile: 'dist/webview.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  minify: false,
  jsx: 'automatic',
  loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'text' },
};

/** @type {import('esbuild').BuildOptions} */
const settingsBuildOptions = {
  entryPoints: ['webview/src/settings-main.tsx'],
  bundle: true,
  outfile: 'dist/settings.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  minify: false,
  jsx: 'automatic',
  loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'text' },
};

async function main() {
  // Create dist directory if it doesn't exist
  if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist', { recursive: true });
  }

  // Copy CSS files
  const cssSource = path.join('webview', 'src', 'theme.css');
  const cssTarget = path.join('dist', 'webview.css');
  if (fs.existsSync(cssSource)) {
    fs.copyFileSync(cssSource, cssTarget);
    console.log('[esbuild] copied webview CSS');
  }
  const settingsCssSource = path.join('webview', 'src', 'settings.css');
  const settingsCssTarget = path.join('dist', 'settings.css');
  if (fs.existsSync(settingsCssSource)) {
    fs.copyFileSync(settingsCssSource, settingsCssTarget);
    console.log('[esbuild] copied settings CSS');
  }

  if (isWatch) {
    const extensionCtx = await esbuild.context({
      ...extensionBuildOptions,
      plugins: [watchLogPlugin],
    });
    const webviewCtx = await esbuild.context(webviewBuildOptions);
    const settingsCtx = await esbuild.context(settingsBuildOptions);
    
    await extensionCtx.watch();
    await webviewCtx.watch();
    await settingsCtx.watch();

    // Auto-copy CSS on changes so the webview picks it up via the file watcher
    if (fs.existsSync(cssSource)) {
      fs.watch(cssSource, { persistent: false }, (eventType) => {
        if (eventType === 'change') {
          try {
            fs.copyFileSync(cssSource, cssTarget);
            console.log('[esbuild] re-copied webview CSS');
          } catch { /* ignore race */ }
        }
      });
    }
    if (fs.existsSync(settingsCssSource)) {
      fs.watch(settingsCssSource, { persistent: false }, (eventType) => {
        if (eventType === 'change') {
          try {
            fs.copyFileSync(settingsCssSource, settingsCssTarget);
            console.log('[esbuild] re-copied settings CSS');
          } catch { /* ignore race */ }
        }
      });
    }
    
    console.log('[esbuild] watching for changes…');
  } else {
    await Promise.all([
      esbuild.build(extensionBuildOptions),
      esbuild.build(webviewBuildOptions),
      esbuild.build(settingsBuildOptions),
    ]);
    console.log('[esbuild] build complete');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
