import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Admin Web shell SSR renders full HTML in both English and Bengali via Vite', async () => {
  const vite = await createServer({
    root: APP_ROOT,
    logLevel: 'silent',
    server: { middlewareMode: true },
    appType: 'custom',
  });
  try {
    const { App } = await vite.ssrLoadModule('/src/App.tsx');
    const htmlEn = renderToStaticMarkup(createElement(App, { initialLocale: 'en' }));
    assert.match(htmlEn, /Undal Super Admin/);
    assert.match(htmlEn, /72 settings keys registered/);

    const htmlBn = renderToStaticMarkup(createElement(App, { initialLocale: 'bn' }));
    assert.match(htmlBn, /উন্দাল সুপার অ্যাডমিন/);
  } finally {
    await vite.close();
  }
});
