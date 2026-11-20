import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isQuietHourKst, planReminder, reminderWindows } from './reminders.ts';
import { EXPO_PUSH_URL, sendExpoPush, type ExpoPushMessage } from './push.ts';

// Saturday 2026-11-21 10:00 KST
const NOW = new Date('2026-11-21T01:00:00Z');
const task = (dueAt: string) => ({ id: 't1', title: '전기요금 납부', dueAt, userId: 'u1' });

test('quiet hours are 22:00–08:00 KST', () => {
  assert.equal(isQuietHourKst(new Date('2026-11-21T13:00:00Z')), true, '22:00 KST');
  assert.equal(isQuietHourKst(new Date('2026-11-20T22:59:00Z')), true, '07:59 KST');
  assert.equal(isQuietHourKst(new Date('2026-11-20T23:00:00Z')), false, '08:00 KST');
  assert.equal(isQuietHourKst(NOW), false, '10:00 KST');
});

test('due_soon says 오늘 or 내일 by KST calendar day', () => {
  const today = planReminder(task('2026-11-21T09:00:00Z'), 'due_soon', NOW); // 18:00 KST today
  assert.equal(today.title, '오늘 마감');
  assert.equal(today.body, '전기요금 납부 · 11/21 (토) 18:00');
  const tomorrow = planReminder(task('2026-11-22T00:30:00Z'), 'due_soon', NOW); // 09:30 KST tomorrow
  assert.equal(tomorrow.title, '내일 마감');
  assert.equal(tomorrow.body, '전기요금 납부 · 11/22 (일) 09:30');
});

test('overdue reminder', () => {
  const r = planReminder(task('2026-11-20T09:00:00Z'), 'overdue', NOW);
  assert.equal(r.title, '마감이 지났어요');
  assert.equal(r.body, '전기요금 납부 · 11/20 (금) 18:00 마감');
});

test('reminder windows', () => {
  const w = reminderWindows(NOW);
  assert.equal(w.dueSoonFromIso, '2026-11-21T01:00:00.000Z');
  assert.equal(w.dueSoonToIso, '2026-11-22T01:00:00.000Z');
  assert.equal(w.overdueFromIso, '2026-11-14T01:00:00.000Z');
  assert.equal(w.overdueToIso, '2026-11-21T01:00:00.000Z');
});

test('sendExpoPush: chunks of 100, maps tickets, reports DeviceNotRegistered', async () => {
  const bodies: ExpoPushMessage[][] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    assert.equal(url, EXPO_PUSH_URL);
    assert.equal((init.headers as Record<string, string>).Authorization, 'Bearer expo-token');
    const chunk = JSON.parse(String(init.body)) as ExpoPushMessage[];
    bodies.push(chunk);
    const data = chunk.map((m) =>
      m.to === 'ExponentPushToken[gone]'
        ? { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } }
        : { status: 'ok', id: 'ticket' }
    );
    return new Response(JSON.stringify({ data }), { status: 200 });
  }) as unknown as typeof fetch;

  const messages: ExpoPushMessage[] = Array.from({ length: 150 }, (_, i) => ({
    to: i === 120 ? 'ExponentPushToken[gone]' : `ExponentPushToken[${i}]`,
    title: '내일 마감',
    body: 'x',
  }));
  const results = await sendExpoPush(messages, { accessToken: 'expo-token', fetchImpl: fakeFetch });

  assert.deepEqual(bodies.map((b) => b.length), [100, 50]);
  assert.equal(results.length, 150);
  assert.equal(results.filter((r) => r.ok).length, 149);
  assert.deepEqual(results[120], { to: 'ExponentPushToken[gone]', ok: false, error: 'DeviceNotRegistered' });
});

test('sendExpoPush: HTTP and network failures mark the whole chunk failed', async () => {
  const http500 = (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch;
  const r1 = await sendExpoPush([{ to: 'a', title: 't', body: 'b' }], { fetchImpl: http500 });
  assert.deepEqual(r1, [{ to: 'a', ok: false, error: 'HTTP_500' }]);

  const offline = (async () => {
    throw new TypeError('fetch failed');
  }) as unknown as typeof fetch;
  const r2 = await sendExpoPush([{ to: 'a', title: 't', body: 'b' }], { fetchImpl: offline });
  assert.deepEqual(r2, [{ to: 'a', ok: false, error: 'NETWORK_ERROR' }]);
});
