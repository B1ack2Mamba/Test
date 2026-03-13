#!/usr/bin/env node

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const part = argv[i];
    if (!part.startsWith('--')) continue;
    const key = part.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = 'true';
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function parseServerTiming(value) {
  if (!value) return {};
  const out = {};
  for (const chunk of String(value).split(',')) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const [namePart, ...rest] = trimmed.split(';');
    const name = String(namePart || '').trim();
    let dur = null;
    for (const piece of rest) {
      const p = String(piece).trim();
      if (p.startsWith('dur=')) {
        const raw = Number(p.slice(4).replace(/^"|"$/g, ''));
        if (Number.isFinite(raw)) dur = raw;
      }
    }
    if (name) out[name] = dur;
  }
  return out;
}

function avg(nums) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function pct(nums, p) {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

async function main() {
  const args = parseArgs(process.argv);
  const baseUrl = String(args.base || '').replace(/\/$/, '');
  const token = String(args.token || '');
  const roomId = String(args.room || '');
  const mode = String(args.mode || 'results');
  const concurrency = Math.max(1, Number(args.concurrency || 10));
  const requests = Math.max(concurrency, Number(args.requests || 50));
  const debug = String(args.debug || '1') !== '0';

  if (!baseUrl || !token || !roomId) {
    console.error('Usage: node scripts/load-room-dashboard.mjs --base http://localhost:3000 --token <JWT> --room <ROOM_ID> [--mode shell|results] [--concurrency 10] [--requests 50]');
    process.exit(1);
  }

  const path = `${baseUrl}/api/training/rooms/dashboard?room_id=${encodeURIComponent(roomId)}&mode=${encodeURIComponent(mode)}${debug ? '&debug=1' : ''}`;
  console.log(`Target: ${path}`);
  console.log(`Concurrency: ${concurrency}, requests: ${requests}`);

  let started = 0;
  let completed = 0;
  let ok = 0;
  let failed = 0;
  const latencies = [];
  const totals = [];
  const stages = {};

  async function runOne(index) {
    const startedAt = Date.now();
    try {
      const res = await fetch(path, {
        headers: {
          authorization: `Bearer ${token}`,
          'cache-control': 'no-store',
        },
      });
      const elapsed = Date.now() - startedAt;
      latencies.push(elapsed);
      const serverTiming = parseServerTiming(res.headers.get('server-timing'));
      if (Number.isFinite(serverTiming.total)) totals.push(serverTiming.total);
      for (const [k, v] of Object.entries(serverTiming)) {
        if (!Number.isFinite(v)) continue;
        if (!stages[k]) stages[k] = [];
        stages[k].push(v);
      }
      const json = await res.json().catch(() => ({}));
      if (res.ok && json?.ok) ok += 1;
      else failed += 1;
    } catch {
      failed += 1;
      latencies.push(Date.now() - startedAt);
    } finally {
      completed += 1;
      if (completed % Math.max(1, Math.floor(requests / 10)) === 0 || completed === requests) {
        console.log(`Progress: ${completed}/${requests}`);
      }
    }
  }

  async function worker() {
    while (started < requests) {
      started += 1;
      const index = started;
      await runOne(index);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const summary = {
    ok,
    failed,
    latency_ms: {
      avg: Number(avg(latencies).toFixed(1)),
      p50: Number(pct(latencies, 50).toFixed(1)),
      p95: Number(pct(latencies, 95).toFixed(1)),
      max: Number(Math.max(...latencies, 0).toFixed(1)),
    },
    server_total_ms: {
      avg: Number(avg(totals).toFixed(1)),
      p50: Number(pct(totals, 50).toFixed(1)),
      p95: Number(pct(totals, 95).toFixed(1)),
      max: Number(Math.max(...totals, 0).toFixed(1)),
    },
    stages: Object.fromEntries(
      Object.entries(stages)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, nums]) => [k, {
          avg: Number(avg(nums).toFixed(1)),
          p95: Number(pct(nums, 95).toFixed(1)),
          max: Number(Math.max(...nums, 0).toFixed(1)),
        }])
    ),
  };

  console.log('\nSummary:');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
