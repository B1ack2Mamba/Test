# Авторские тесты — Supabase + кошелёк (99 ₽ + 49 ₽)

Минимальный проект на Next.js (Pages Router) + Tailwind, который:
- показывает каталог тестов и страницу теста
- даёт пройти forced-choice тест (1 из 2 утверждений)
- считает результат (A–E) и рисует график
- берёт тесты из Supabase (в проде это единственный источник; локальные JSON — только если Supabase не настроен)
- авторскую расшифровку результата хранит отдельно и **открывает за 99 ₽** из внутреннего баланса
- Подробная расшифровка результатов **открывается за 49 ₽** из внутреннего баланса
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
4) `supabase/wallet_debit.sql`  (нужно для списания 99/49 ₽)
4) `supabase/wallet_debit.sql`  (платные действия по кошельку: 99/49)

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

Для подробной расшифровки:
- `DEEPSEEK_API_KEY=...`
- `DEEPSEEK_BASE_URL=https://api.deepseek.com`
- `DEEPSEEK_MODEL=deepseek-chat`

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

## Расшифровки (99 ₽ + 49 ₽)

- Публичная часть теста (вопросы/подсчёт) хранится в `public.tests.json`.
- Авторская расшифровка хранится в `public.test_interpretations`.
- Каждое открытие списывает деньги ("pay-per-use"):
  - **99 ₽** — `/api/purchases/author`
  - **49 ₽** — `/api/purchases/ai` (использует `DEEPSEEK_API_KEY`)
- Для списания используется RPC из `supabase/wallet_debit.sql`: `public.debit_wallet(...)`.

