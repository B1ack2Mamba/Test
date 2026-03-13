#!/usr/bin/env node
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const part = argv[i];
    if (!part.startsWith('--')) continue;
    const key = part.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = 'true';
    else {
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

function parseSetCookie(setCookieHeader) {
  if (!setCookieHeader) return '';
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  return String(raw).split(';')[0] || '';
}

async function timedFetch(url, init) {
  const started = Date.now();
  const res = await fetch(url, init);
  const elapsed = Date.now() - started;
  return { res, elapsed };
}

async function main() {
  const args = parseArgs(process.argv);
  const baseUrl = String(args.base || '').replace(/\/$/, '');
  const roomId = String(args.room || '');
  const password = String(args.password || '');
  const count = Math.max(1, Number(args.count || 50));
  const joinConcurrency = Math.max(1, Number(args.joinConcurrency || 10));
  const flowConcurrency = Math.max(1, Number(args.flowConcurrency || 20));
  const testSlug = String(args.test || 'motivation-cards');
  const answersRaw = String(args.answers || '[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]');
  const outDir = String(args.out || '.load-room-participants');

  if (!baseUrl || !roomId || !password) {
    console.error('Usage: node scripts/load-room-participants.mjs --base https://example.com --room ROOM_ID --password 1234 [--count 50] [--joinConcurrency 10] [--flowConcurrency 20] [--test motivation-cards] [--answers "[0,0,...]"]');
    process.exit(1);
  }
  if (/ROOM_ID|PASSWORD|ВСТАВЬ/i.test(roomId) || /PASSWORD|ВСТАВЬ/i.test(password)) {
    console.error('One of the arguments still looks like a placeholder.');
    process.exit(1);
  }

  const answers = JSON.parse(answersRaw);
  if (!Array.isArray(answers)) {
    throw new Error('--answers must be a JSON array');
  }

  if (!existsSync(outDir)) await mkdir(outDir, { recursive: true });

  const joinTarget = `${baseUrl}/api/training/rooms/join`;
  const bootstrapTarget = `${baseUrl}/api/training/rooms/bootstrap?room_id=${encodeURIComponent(roomId)}`;
  const touchTarget = `${baseUrl}/api/training/rooms/touch`;
  const submitTarget = `${baseUrl}/api/training/attempts/submit`;

  console.log(`Base: ${baseUrl}`);
  console.log(`Room: ${roomId}`);
  console.log(`Count: ${count}`);
  console.log(`Join target: ${joinTarget}`);

  const cookies = [];
  const joinStatuses = {};
  const joinErrors = {};
  const joinLatencies = [];
  let started = 0;
  let completed = 0;

  async function runJoinOne(i) {
    const body = {
      room_id: roomId,
      display_name: `Load User ${i}`,
      password,
      personal_data_consent: true,
    };
    try {
      let finalElapsed = 0;
      for (let attempt = 1; attempt <= 12; attempt += 1) {
        const { res, elapsed } = await timedFetch(joinTarget, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'cache-control': 'no-store',
          },
          body: JSON.stringify(body),
        });
        finalElapsed += elapsed;
        const json = await res.json().catch(() => ({}));
        if (res.status === 202 && json?.queued) {
          const retryAfter = Math.max(300, Number(json?.retry_after_ms || 1200));
          await new Promise((resolve) => setTimeout(resolve, retryAfter));
          continue;
        }
        joinLatencies.push(finalElapsed);
        joinStatuses[res.status] = (joinStatuses[res.status] || 0) + 1;
        const cookie = parseSetCookie(res.headers.get('set-cookie'));
        if (res.ok && cookie) cookies.push(cookie);
        else {
          const key = json?.error || 'missing_set_cookie';
          joinErrors[key] = (joinErrors[key] || 0) + 1;
        }
        return;
      }
      joinLatencies.push(finalElapsed);
      joinStatuses[202] = (joinStatuses[202] || 0) + 1;
      joinErrors['join_queue_timeout'] = (joinErrors['join_queue_timeout'] || 0) + 1;
    } catch (err) {
      const key = String(err?.message || 'network_error');
      joinErrors[key] = (joinErrors[key] || 0) + 1;
    } finally {
      completed += 1;
      if (completed % Math.max(1, Math.floor(count / 10)) === 0 || completed === count) {
        console.log(`Join progress: ${completed}/${count}`);
      }
    }
  }

  async function joinWorker() {
    while (started < count) {
      started += 1;
      await runJoinOne(started);
    }
  }

  await Promise.all(Array.from({ length: joinConcurrency }, () => joinWorker()));

  await writeFile(path.join(outDir, 'cookies.json'), JSON.stringify(cookies, null, 2), 'utf8');

  console.log('\nJoin summary:');
  console.log(JSON.stringify({
    created_cookies: cookies.length,
    statuses: joinStatuses,
    errors: joinErrors,
    latency_ms: {
      avg: Number(avg(joinLatencies).toFixed(1)),
      p50: Number(pct(joinLatencies, 50).toFixed(1)),
      p95: Number(pct(joinLatencies, 95).toFixed(1)),
      max: Number(Math.max(...joinLatencies, 0).toFixed(1)),
    },
  }, null, 2));

  if (!cookies.length) {
    console.error('No participant cookies were created. Stopping.');
    process.exit(2);
  }

  async function runFlowStep(label, target, initFactory) {
    const statusCounts = {};
    const bodyCounts = {};
    const latencies = [];
    let flowStarted = 0;
    let flowCompleted = 0;

    async function runOne() {
      const idx = flowStarted++;
      const cookie = cookies[idx % cookies.length];
      const init = initFactory(cookie);
      const startedAt = Date.now();
      try {
        const res = await fetch(target, init);
        const elapsed = Date.now() - startedAt;
        latencies.push(elapsed);
        statusCounts[res.status] = (statusCounts[res.status] || 0) + 1;
        const json = await res.json().catch(() => ({}));
        const key = json?.duplicate ? 'duplicate' : json?.ok ? 'ok' : (json?.error || 'unknown');
        bodyCounts[key] = (bodyCounts[key] || 0) + 1;
      } catch (err) {
        const elapsed = Date.now() - startedAt;
        latencies.push(elapsed);
        statusCounts.network_error = (statusCounts.network_error || 0) + 1;
        const key = String(err?.message || 'network_error');
        bodyCounts[key] = (bodyCounts[key] || 0) + 1;
      } finally {
        flowCompleted += 1;
        if (flowCompleted % Math.max(1, Math.floor(cookies.length / 10)) === 0 || flowCompleted === cookies.length) {
          console.log(`${label} progress: ${flowCompleted}/${cookies.length}`);
        }
      }
    }

    async function worker() {
      while (flowStarted < cookies.length) {
        await runOne();
      }
    }

    await Promise.all(Array.from({ length: Math.min(flowConcurrency, cookies.length) }, () => worker()));

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
    await writeFile(path.join(outDir, `${label}.summary.json`), JSON.stringify(summary, null, 2), 'utf8');
    console.log(`\n${label} summary:`);
    console.log(JSON.stringify(summary, null, 2));
  }

  await runFlowStep('bootstrap', bootstrapTarget, (cookie) => ({
    method: 'GET',
    headers: {
      cookie,
      'cache-control': 'no-store',
    },
  }));

  await runFlowStep('touch', touchTarget, (cookie) => ({
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
    body: JSON.stringify({ room_id: roomId }),
  }));

  await runFlowStep('submit', submitTarget, (cookie) => ({
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
    body: JSON.stringify({ room_id: roomId, test_slug: testSlug, answers }),
  }));

  console.log(`\nArtifacts saved to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
