# Авторские тесты — Supabase + paywall + кошелёк (99 ₽)

Минимальный проект на Next.js (Pages Router) + Tailwind, который:
- показывает каталог тестов и страницу теста
- даёт пройти forced-choice тест (1 из 2 утверждений)
- считает результат (A–E) и рисует график
- берёт тесты из Supabase (в проде это единственный источник; локальные JSON — только если Supabase не настроен)
- расшифровку результата хранит отдельно и **открывает за 99 ₽** из внутреннего баланса
- баланс пополняется через **ЮKassa → СБП (QR)**

---

## Быстрый старт

```bash
npm i
npm run dev
```

Открой: http://localhost:3000

---

## Подключение Supabase

### 1) Переменные окружения

Скопируй `.env.example` → `.env.local` и заполни:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (или `NEXT_PUBLIC_SUPABASE_ANON_KEY`)

Серверные (нужны для ЮKassa вебхука и админ-ручек):
- `SUPABASE_SERVICE_ROLE_KEY`

### 2) Создай таблицы

Supabase → SQL Editor → выполнить **по очереди**, копипастой:

1) `supabase/schema.sql`
2) `supabase/paywall.sql`
3) `supabase/yookassa.sql`

### Очистить демо-тесты (если уже сеял раньше)

Если ты уже заливал демо-тесты и хочешь пустой каталог — выполни:

- `supabase/reset_tests.sql`

---

## Подключение ЮKassa (СБП / QR)

### 1) ENV

В `.env.local`:

- `YOOKASSA_SHOP_ID=...`
- `YOOKASSA_SECRET_KEY=...`
- `APP_BASE_URL=https://твой-домен.ру` (без `/` в конце желательно)

### 2) Webhook

В кабинете ЮKassa настрой уведомления на URL:

- `https://твой-домен.ру/api/yookassa/webhook`

События достаточно:
- `payment.succeeded`

> Локально webhook на `localhost` не прилетит. Для теста можно поднять временный публичный URL (или сразу задеплоить проект).

### 3) Как работает пополнение

- `/wallet` → кнопка **Пополнить** → создаётся платёж SBP
- ЮKassa отдаёт `confirmation_url` (там показывается QR)
- после успешной оплаты ЮKassa присылает webhook
- webhook проверяет статус платежа по API и вызывает `credit_wallet(...)` в Supabase

---

## Импорт нового теста

Открой `/admin/import`.

Доступ есть только у email, указанного в:

- `NEXT_PUBLIC_ADMIN_EMAIL` (по умолчанию: `storyguild9@gmail.com`)

Для загрузки теста нужен серверный ключ:

- `SUPABASE_SERVICE_ROLE_KEY` (server-only)

Маршрут: `POST /api/admin/upsert-test` (требует `Authorization: Bearer <access_token>`).

---

## Paywall / 99 ₽

- Публичная часть теста (вопросы/подсчёт) хранится в `public.tests.json`.
- Расшифровка хранится в `public.test_interpretations` и защищена RLS:
  доступ есть только если пользователь купил доступ (`public.test_unlocks`).
- Покупка делается через RPC: `public.unlock_test(test_slug, price_kopeks)`.

