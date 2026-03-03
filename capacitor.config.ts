import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Вариант A: нативная обёртка (WebView), которая открывает ваш продакшен‑домен.
 *
 * 1) Поменяй URL на свой домен (https://...).
 * 2) Если меняешь appId/appName — делай это ДО `npx cap add android`, иначе придётся пересоздавать платформы.
 */
const config: CapacitorConfig = {
  appId: 'com.krost.tests',
  appName: 'Krost Tests',
  webDir: 'www',

  server: {
    // TODO: поставь свой домен
    url: 'https://YOUR-DOMAIN.TLD',

    // Для продакшена лучше держать false. Включают только если домен на http.
    cleartext: false,

    // Если WebView не смог загрузить url (или есть другая ошибка), покажет локальную страницу.
    // Важно: на Android эта страница не имеет доступа к Capacitor plugins.
    // Документация: https://capacitorjs.com/docs/config
    errorPath: 'error.html',

    // Открываем сразу в «Комнаты» (если Capacitor версии поддерживает эту опцию)
    // @since 7.3.0
    appStartPath: '/training',
  },

  plugins: {
    SplashScreen: {
      // Оставляем автоскрытие включённым, чтобы не залипать на Splash, если сеть умерла
      launchShowDuration: 800,
      launchAutoHide: true,
      showSpinner: true,
      backgroundColor: '#eef2ff',
    },
  },
};

export default config;
