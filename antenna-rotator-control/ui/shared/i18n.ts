import enLocale from '../../src/locales/en.json';
import zhLocale from '../../src/locales/zh.json';

type LocaleMessages = Record<string, string>;

const MESSAGES: Record<string, LocaleMessages> = {
  en: enLocale,
  zh: zhLocale,
};

function currentLanguage(): string {
  const locale = window.tx5dr?.locale ?? new URLSearchParams(window.location.search).get('_locale') ?? 'en';
  return locale.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function t(key: string, fallback?: string, values?: Record<string, string | number>): string {
  const language = currentLanguage();
  const template = MESSAGES[language]?.[key] ?? MESSAGES.en?.[key] ?? fallback ?? key;
  if (!values) {
    return template;
  }
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, token: string) => {
    const value = values[token];
    return value === undefined ? match : String(value);
  });
}
