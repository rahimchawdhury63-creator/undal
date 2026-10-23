/**
 * @file apps/admin_web/src/App.tsx
 * @description Token- & i18n-wired foundation shell for UNDAL Super Admin Web (`Build Response 1`).
 * Full TOTP 2FA guard, RBAC command palette, and all 132 capabilities (`C1–C132`) land in `Build 25–28`.
 */

import { useEffect, useState } from 'react';
import { UNDAL_PLATFORM_SETTINGS, t, type UndalLocale } from '@undal/shared-ts';

export interface AdminWebShellProps {
  readonly initialLocale?: UndalLocale;
  readonly initialTheme?: 'light' | 'dark';
}

export function App({
  initialLocale = 'en',
  initialTheme = 'light',
}: AdminWebShellProps) {
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
          maxWidth: '1120px',
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
              {t(locale, 'app.admin_title')}
            </h1>
            <p style={{ margin: '4px 0 0', color: 'var(--undal-slate)' }}>
              {t(locale, 'app.status_ready')} · {Object.keys(UNDAL_PLATFORM_SETTINGS).length} settings keys registered
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
      </section>
    </main>
  );
}
