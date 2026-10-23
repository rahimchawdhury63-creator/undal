import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Customer Web shell SSR renders full HTML in both English and Bengali via Vite', async () => {
  const vite = await createServer({
    root: APP_ROOT,
    logLevel: 'silent',
    server: { middlewareMode: true },
    appType: 'custom',
  });
  try {
    const { App } = await vite.ssrLoadModule('/src/App.tsx');
    const htmlEn = renderToStaticMarkup(createElement(App, { initialLocale: 'en' }));
    assert.match(htmlEn, /Real food\. Real-time\. No games\./);
    assert.match(htmlEn, /৳437\.80/);

    const htmlBn = renderToStaticMarkup(createElement(App, { initialLocale: 'bn' }));
    assert.match(htmlBn, /আসল খাবার। সত্যিকারের দ্রুত।/);
    assert.match(htmlBn, /৳৪৩৭\.৮০/);
  } finally {
    await vite.close();
  }
});
