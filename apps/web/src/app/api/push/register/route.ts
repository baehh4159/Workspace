/**
 * apps/web/src/app/api/push/register/route.ts
 * Registers or removes Expo Push Tokens for the authenticated user.
 * Uses adminClient upsert on expo_push_token so switching accounts on the same device
 * cleanly rebinds the token to the currently authenticated user.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedContext } from '@/lib/supabase-server';

const ExpoTokenSchema = z
  .string()
  .trim()
  .min(16)
  .max(256)
  .regex(/^Expo(nent)?PushToken\[[^\]]+\]$/, 'Invalid Expo push token format');

const RegisterPushSchema = z.object({
  expoPushToken: ExpoTokenSchema,
  platform: z.enum(['ios', 'android', 'web']),
  deviceName: z.string().trim().max(120).optional(),
});

const UnregisterPushSchema = z.object({
  expoPushToken: ExpoTokenSchema,
});

export async function POST(req: Request) {
  const ctx = await getAuthenticatedContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const parsed = RegisterPushSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { expoPushToken, platform, deviceName } = parsed.data;
  const nowIso = new Date().toISOString();

  const { data, error } = await ctx.adminClient
    .from('user_push_tokens')
    .upsert(
      {
        user_id: ctx.user.id,
        expo_push_token: expoPushToken,
        platform,
        device_name: deviceName ?? null,
        last_seen_at: nowIso,
      },
      { onConflict: 'expo_push_token' }
    )
    .select('id, platform, last_seen_at')
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'PUSH_REGISTER_FAILED' }, { status: 500 });
  }

  return NextResponse.json({ registered: true, token: data }, { status: 200 });
}

export async function DELETE(req: Request) {
  const ctx = await getAuthenticatedContext(req);
  if (!ctx) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }

  const parsed = UnregisterPushSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const { error } = await ctx.adminClient
    .from('user_push_tokens')
    .delete()
    .eq('user_id', ctx.user.id)
    .eq('expo_push_token', parsed.data.expoPushToken);

  if (error) {
    return NextResponse.json({ error: 'PUSH_UNREGISTER_FAILED' }, { status: 500 });
  }

  return NextResponse.json({ unregistered: true }, { status: 200 });
}
