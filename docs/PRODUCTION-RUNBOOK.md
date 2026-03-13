# Production Runbook

## Перед запуском

1. Применить SQL в таком порядке:
   - `supabase/training_room_sessions.sql`
   - `supabase/training_rooms_personal_data_consent.sql`
   - `supabase/training_rooms_hardening.sql`
   - `supabase/PREPRODUCTION-APPLY-ORDER.sql`
2. Убедиться, что `.env.local` заполнен.
3. Выполнить `npm run build` без ошибок.
4. Пройти smoke-checklist из `docs/SMOKE-TEST-RUNBOOK.md`.

## Минимальный smoke перед боем

### Participant flow
- вход в комнату
- возврат назад по браузеру
- открытие комнаты без повторного ввода в пределах активной сессии
- прохождение теста
- завершение теста
- повторный вход после завершения

### Specialist flow
- открыть комнату специалиста
- убедиться, что `Тесты комнаты` видны сразу
- поменять порядок тестов и убедиться, что черновик не стирается фоновым обновлением
- открыть цифровой результат по участнику
- экспортировать Excel
- собрать полный AI-портрет

## Что считать тревожным симптомом
- shell комнаты специалиста стабильно > 1500 ms
- results комнаты специалиста стабильно > 2500 ms
- `/api/training/rooms/bootstrap` стабильно > 2000 ms
- повторные submit плодят дубли попыток
- возврат назад снова требует пароль в пределах 3 часов

## Где смотреть тайминги

### Комната специалиста
В dev-режиме на странице комнаты показываются `_timings` для:
- `shell`
- `results`

### Network
В запросах `/api/training/rooms/dashboard` смотреть header `Server-Timing`.

## Что делать, если стало медленно
1. Снять `shell` и `results` тайминги.
2. Проверить, что медленно: `auth`, `member_check`, `room_tests`, `members`, `attempts`.
3. Проверить, есть ли только dev-замедление или то же в production build.
4. Проверить, не идёт ли heavy operation параллельно (Excel/AI).
