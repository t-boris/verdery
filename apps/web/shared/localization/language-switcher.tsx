'use client';

import { useRouter } from 'next/navigation';

import { LOCALE_COOKIE_NAME, SUPPORTED_LOCALES, type Locale } from './locales';
import { useLocalization } from './localization-provider';
import styles from './language-switcher.module.css';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Persistent English/Russian interface-language control. */
export function LanguageSwitcher() {
  const { locale, t } = useLocalization();
  const router = useRouter();

  const selectLocale = (nextLocale: Locale) => {
    if (nextLocale === locale) {
      return;
    }
    document.cookie = `${LOCALE_COOKIE_NAME}=${nextLocale}; Path=/; Max-Age=${String(ONE_YEAR_SECONDS)}; SameSite=Lax`;
    router.refresh();
  };

  return (
    <div className={styles['switcher']} role="group" aria-label={t('shell.languageLabel')}>
      {SUPPORTED_LOCALES.map((supportedLocale) => (
        <button
          key={supportedLocale}
          type="button"
          className={styles['option']}
          aria-pressed={supportedLocale === locale}
          aria-label={t(
            supportedLocale === 'en' ? 'shell.languageEnglish' : 'shell.languageRussian',
          )}
          onClick={() => selectLocale(supportedLocale)}
        >
          {supportedLocale.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
