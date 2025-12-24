# Авторские тесты — Supabase + paywall + кошелёк (99 ₽)

Минимальный проект на Next.js (Pages Router) + Tailwind, который:
- показывает каталог тестов и страницу теста
- даёт пройти forced-choice тест (1 из 2 утверждений)
- считает результат (A–E) и рисует график
- умеет брать тесты из Supabase (и падать обратно на локальные JSON в `data/tests`)
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

### 3) Залей стартовый тест

В SQL Editor выполни:

- `supabase/seed_negotiation_style.sql`

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

Там два пути:

### A) Локально (fallback)

1) Вставь JSON → “Проверить”
2) “Скачать <slug>.json”
3) Положи в `data/tests/<slug>.json`
4) Перезапусти `npm run dev`

### B) В Supabase (прод)

1) Вставь JSON → “Проверить”
2) Включи серверный аплоад:
   - добавь в `.env.local`:
     - `ADMIN_UPLOAD_TOKEN=...` (любой секретный токен)
     - `SUPABASE_SERVICE_ROLE_KEY=...` (server-only)
3) На странице появится блок “Загрузить в Supabase” — вставь токен и нажми “Загрузить”.

Маршрут: `POST /api/admin/upsert-test` (требует `x-admin-token`).

---

## Paywall / 99 ₽

- Публичная часть теста (вопросы/подсчёт) хранится в `public.tests.json`.
- Расшифровка хранится в `public.test_interpretations` и защищена RLS:
  доступ есть только если пользователь купил доступ (`public.test_unlocks`).
- Покупка делается через RPC: `public.unlock_test(test_slug, price_kopeks)`.

# Test
