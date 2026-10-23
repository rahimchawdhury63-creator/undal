/**
 * @file apps/customer_web/src/App.tsx
 * @description Token- & i18n-wired foundation shell for UNDAL Customer Web (`Build Response 1`).
 * Full SSG storefront, zone/cuisine SEO pages, Leaflet map, cart & COD checkout ship in `Build 23–24`.
 */

import { useEffect, useState } from 'react';
import { formatBdt, t, type UndalLocale } from '@undal/shared-ts';

export interface CustomerWebShellProps {
  readonly initialLocale?: UndalLocale;
  readonly initialTheme?: 'light' | 'dark';
}

export function App({
  initialLocale = 'en',
  initialTheme = 'light',
}: CustomerWebShellProps) {
  const [locale, setLocale] = useState<UndalLocale>(initialLocale);
  const [theme, setTheme] = useState<'light' | 'dark'>(initialTheme);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
      document.documentElement.dataset.theme = theme;
    }
  }, [locale, theme]);

  return (
    <main
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--undal-cream)',
        color: 'var(--undal-ink)',
        fontFamily: 'var(--undal-font-body)',
        lineHeight: 'var(--undal-leading-body)',
        padding: 'var(--undal-space-lg)',
      }}
    >
      <section
        style={{
          maxWidth: '960px',
          margin: '0 auto',
          backgroundColor: 'var(--undal-card)',
          border: '1px solid var(--undal-border)',
          borderRadius: 'var(--undal-radius-card)',
          boxShadow: 'var(--undal-shadow-card)',
          padding: 'var(--undal-space-xl)',
        }}
      >
        <header
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--undal-space-md)',
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                fontFamily: 'var(--undal-font-display)',
                fontSize: 'var(--undal-text-xl)',
                color: 'var(--undal-green)',
              }}
            >
              {t(locale, 'app.name')}
            </h1>
            <p style={{ margin: '4px 0 0', color: 'var(--undal-slate)' }}>
              {t(locale, 'app.tagline')}
            </p>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--undal-space-sm)' }}>
            <button
              type="button"
              onClick={() => setLocale((prev) => (prev === 'en' ? 'bn' : 'en'))}
              style={{
                minHeight: '44px',
                padding: '0 var(--undal-space-lg)',
                borderRadius: 'var(--undal-radius-pill)',
                border: '1px solid var(--undal-border)',
                backgroundColor: 'var(--undal-surface-subtle)',
                color: 'var(--undal-ink)',
                fontFamily: 'var(--undal-font-body)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {t(locale, 'app.switch_language')}
            </button>
            <button
              type="button"
              onClick={() => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))}
              style={{
                minHeight: '44px',
                padding: '0 var(--undal-space-lg)',
                borderRadius: 'var(--undal-radius-pill)',
                border: 'none',
                backgroundColor: 'var(--undal-green)',
                color: 'var(--undal-on-green)',
                fontFamily: 'var(--undal-font-body)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {theme === 'light' ? t(locale, 'app.theme_dark') : t(locale, 'app.theme_light')}
            </button>
          </div>
        </header>

        <hr style={{ border: 0, borderTop: '1px solid var(--undal-border)', margin: 'var(--undal-space-lg) 0' }} />

        <p style={{ margin: '0 0 var(--undal-space-sm)' }}>
          {t(locale, 'app.zone_active', { zone: 'Sylhet Sadar' })}
        </p>
        <p className="undal-tabular-nums" style={{ margin: 0, color: 'var(--undal-slate)' }}>
          {t(locale, 'checkout.cod')} · {formatBdt(43780, locale)}
        </p>
      </section>
    </main>
  );
}
