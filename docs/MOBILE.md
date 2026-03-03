# Мобильное приложение (APK) из этого проекта — вариант A (Capacitor, remote URL)

Идея: нативное приложение = WebView, который открывает ваш продакшен‑домен.

## Что уже добавлено в проект

- `capacitor.config.ts` (шаблон конфигурации)
- `www/error.html` (локальная страница на случай ошибок загрузки)
- `/api/health` (health‑check)
- В приложении (web) добавлены:
  - обработка Android Back (назад → history.back, иначе выход)
  - отслеживание сети + “Оффлайн / Сервер недоступен” оверлей
  - внешние ссылки открываются во внешнем браузере
  - в шапке в нативной оболочке появляется кнопка ↻ (обновить)

> Важно: Capacitor официально пишет, что `server.url` предназначен скорее для live‑reload/dev,
> но технически это работает и используется как “remote web app”.
> Чтобы избежать белого экрана при проблемах сети, включён `server.errorPath`.

## 1) Подготовь домен

Сайт должен быть задеплоен и открываться по HTTPS:
- например Vercel
- `https://ВАШ-ДОМЕН`

## 2) Поставь зависимости

В корне проекта:

```bash
npm i
```

## 3) Настрой `capacitor.config.ts`

Открой `capacitor.config.ts` и замени:

- `server.url: 'https://YOUR-DOMAIN.TLD'` → на твой прод‑домен
- (по желанию) `appId` / `appName`

⚠️ Если меняешь `appId`/`appName` — делай это **до** `npx cap add android`.

## 4) Добавь Android платформу

```bash
npx cap add android
npx cap sync android
npx cap open android
```

## 5) Собери APK в Android Studio

- Build → Build Bundle(s) / APK(s) → **Build APK(s)**

Обычно файл появляется тут:

`android/app/build/outputs/apk/debug/app-debug.apk`

## Релиз (для нормальной раздачи/Google Play)

1) Подпись (keystore)
2) Собирай AAB:

```bash
cd android
./gradlew bundleRelease
```

Файл:

`android/app/build/outputs/bundle/release/app-release.aab`

## Опционально

### Запрет скриншотов (Android)

В `android/app/src/main/java/.../MainActivity.java`:

```java
import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    getWindow().setFlags(
      WindowManager.LayoutParams.FLAG_SECURE,
      WindowManager.LayoutParams.FLAG_SECURE
    );
  }
}
```

### Кастомизировать Splash

Документация: https://capacitorjs.com/docs/apis/splash-screen

Параметры уже заданы в `capacitor.config.ts` (plugins.SplashScreen).
