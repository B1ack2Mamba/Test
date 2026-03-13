# Load Test Runbook

## Быстрый локальный прогон dashboard

Нужны:
- `ROOM_ID`
- bearer token специалиста

### Пример для `results`

```bash
node scripts/load-room-dashboard.mjs \
  --base http://localhost:3000 \
  --token "YOUR_SPECIALIST_JWT" \
  --room "ROOM_ID" \
  --mode results \
  --concurrency 10 \
  --requests 50
```

### Пример для `shell`

```bash
node scripts/load-room-dashboard.mjs \
  --base http://localhost:3000 \
  --token "YOUR_SPECIALIST_JWT" \
  --room "ROOM_ID" \
  --mode shell \
  --concurrency 10 \
  --requests 50
```

## На что смотреть
- `latency_ms.p95`
- `server_total_ms.p95`
- всплески по стадиям: `auth`, `member_check`, `members`, `attempts`

## Базовые ориентиры

### Хорошо
- `shell p95 <= 1500 ms`
- `results p95 <= 2500 ms`
- ошибок `failed = 0`

### Терпимо
- `shell p95 <= 2500 ms`
- `results p95 <= 4000 ms`
- редкие сетевые fail при dev-режиме

### Плохо
- `shell p95 > 2500 ms`
- `results p95 > 4000 ms`
- рост `failed`
- один этап стабильно сильно тяжелее остальных

## Важно
Локальный `next dev` всегда медленнее, чем `npm run build && npm run start`.
Для реальной оценки лучше сравнить оба режима.
