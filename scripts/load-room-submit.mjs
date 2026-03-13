#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

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
  const roomCookie = String(args.cookie || '');
  const payloadPath = String(args.payload || 'payload.json');
  const concurrency = Math.max(1, Number(args.concurrency || 10));
  const requests = Math.max(concurrency, Number(args.requests || 50));

  if (!baseUrl || !roomCookie) {
    console.error('Usage: node scripts/load-room-submit.mjs --base https://example.com --cookie "training_room_session_v1_...=..." [--payload payload.json] [--concurrency 10] [--requests 50]');
    process.exit(1);
  }
  if (/REDACTED|ВСТАВЬ|COOKIE_УЧАСТНИКА/i.test(roomCookie)) {
    console.error('The --cookie argument still looks like a placeholder.');
    process.exit(1);
  }

  const payloadRaw = await readFile(payloadPath, 'utf8');
  const payload = JSON.parse(payloadRaw);
  const target = `${baseUrl}/api/training/attempts/submit`;
  console.log(`Target: ${target}`);
  console.log(`Concurrency: ${concurrency}, requests: ${requests}`);
  console.log(`Payload: ${payloadPath}`);

  let started = 0;
  let completed = 0;
  const latencies = [];
  const statusCounts = {};
  const bodyCounts = {};

  async function runOne() {
    const startedAt = Date.now();
    try {
      const res = await fetch(target, {
        method: 'POST',
        headers: {
          cookie: roomCookie,
          'content-type': 'application/json',
          'cache-control': 'no-store',
        },
        body: JSON.stringify(payload),
      });
      const elapsed = Date.now() - startedAt;
      latencies.push(elapsed);
      statusCounts[res.status] = (statusCounts[res.status] || 0) + 1;
      const json = await res.json().catch(() => ({}));
      const key = json?.duplicate ? 'duplicate' : json?.ok ? 'ok' : (json?.error || 'unknown');
      bodyCounts[key] = (bodyCounts[key] || 0) + 1;
    } catch (err) {
      const elapsed = Date.now() - startedAt;
      latencies.push(elapsed);
      statusCounts['network_error'] = (statusCounts['network_error'] || 0) + 1;
      const msg = String(err?.message || 'network_error');
      bodyCounts[msg] = (bodyCounts[msg] || 0) + 1;
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
      await runOne();
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const summary = {
    statuses: statusCounts,
    bodies: bodyCounts,
    latency_ms: {
      avg: Number(avg(latencies).toFixed(1)),
      p50: Number(pct(latencies, 50).toFixed(1)),
      p95: Number(pct(latencies, 95).toFixed(1)),
      max: Number(Math.max(...latencies, 0).toFixed(1)),
    },
  };

  console.log('\nSummary:');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
