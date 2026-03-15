import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { retryTransientApi } from '@/lib/apiHardening';

export type ParticipantAccessRow = {
  room_id: string;
  user_id: string;
  display_name?: string | null;
  access_code: string;
  access_token_hash: string;
  created_at?: string | null;
  updated_at?: string | null;
  last_used_at?: string | null;
};

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function generateParticipantAccessCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

export function generateParticipantAccessToken() {
  return `${randomUUID()}-${randomBytes(12).toString('hex')}`;
}

function isMissingAccessTableError(message: string) {
  return /training_room_participant_access/i.test(message || '') && /(does not exist|not exist|relation|schema cache|column)/i.test(message || '');
}

export async function ensureParticipantAccess(
  supabaseAdmin: SupabaseClient,
  args: { roomId: string; userId: string; displayName?: string | null }
): Promise<{ ok: true; row: ParticipantAccessRow; accessToken: string } | { ok: false; tableMissing: true } | { ok: false; error: string }> {
  const existing = await retryTransientApi<any>(
    () => (supabaseAdmin as any)
      .from('training_room_participant_access')
      .select('room_id,user_id,display_name,access_code,access_token_hash,created_at,updated_at,last_used_at')
      .eq('room_id', args.roomId)
      .eq('user_id', args.userId)
      .maybeSingle(),
    { attempts: 2, delayMs: 120 }
  );
  if (existing.error) {
    if (isMissingAccessTableError(String(existing.error.message || ''))) return { ok: false, tableMissing: true };
    return { ok: false, error: existing.error.message || 'Не удалось подготовить доступ участника' };
  }
  if (existing.data) {
    // cannot recover raw token from hash, so rotate token but keep same code
    const accessToken = generateParticipantAccessToken();
    const row = {
      ...(existing.data as ParticipantAccessRow),
      display_name: args.displayName ?? (existing.data as any)?.display_name ?? '',
      access_token_hash: hashToken(accessToken),
      updated_at: new Date().toISOString(),
    } as ParticipantAccessRow;
    const update = await retryTransientApi<any>(
      () => (supabaseAdmin as any)
        .from('training_room_participant_access')
        .update({ display_name: row.display_name, access_token_hash: row.access_token_hash, updated_at: row.updated_at })
        .eq('room_id', args.roomId)
        .eq('user_id', args.userId),
      { attempts: 2, delayMs: 120 }
    );
    if (update.error) return { ok: false, error: update.error.message || 'Не удалось обновить доступ участника' };
    return { ok: true, row, accessToken };
  }

  let accessCode = generateParticipantAccessCode();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const accessToken = generateParticipantAccessToken();
    const payload = {
      room_id: args.roomId,
      user_id: args.userId,
      display_name: args.displayName || '',
      access_code: accessCode,
      access_token_hash: hashToken(accessToken),
      updated_at: new Date().toISOString(),
    };
    const insert = await retryTransientApi<any>(
      () => (supabaseAdmin as any)
        .from('training_room_participant_access')
        .insert(payload)
        .select('room_id,user_id,display_name,access_code,access_token_hash,created_at,updated_at,last_used_at')
        .single(),
      { attempts: 2, delayMs: 120 }
    );
    if (!insert.error && insert.data) {
      return { ok: true, row: insert.data as ParticipantAccessRow, accessToken };
    }
    const msg = String(insert.error?.message || '');
    if (/duplicate key|unique/i.test(msg)) {
      accessCode = generateParticipantAccessCode();
      continue;
    }
    if (isMissingAccessTableError(msg)) return { ok: false, tableMissing: true };
    return { ok: false, error: msg || 'Не удалось создать доступ участника' };
  }
  return { ok: false, error: 'Не удалось сгенерировать уникальный код доступа' };
}

export async function getParticipantAccessByToken(supabaseAdmin: SupabaseClient, roomId: string, token: string) {
  const { data, error } = await retryTransientApi<any>(
    () => (supabaseAdmin as any)
      .from('training_room_participant_access')
      .select('room_id,user_id,display_name,access_code,access_token_hash,created_at,updated_at,last_used_at')
      .eq('room_id', roomId)
      .eq('access_token_hash', hashToken(token))
      .maybeSingle(),
    { attempts: 2, delayMs: 120 }
  );
  if (error) {
    if (isMissingAccessTableError(String(error.message || ''))) return { row: null, tableMissing: true, error: '' };
    return { row: null, error: error.message || 'Не удалось найти доступ участника' };
  }
  return { row: data as ParticipantAccessRow | null };
}

export async function getParticipantAccessByCode(supabaseAdmin: SupabaseClient, roomId: string, accessCode: string) {
  const normalized = String(accessCode || '').trim().toUpperCase();
  const { data, error } = await retryTransientApi<any>(
    () => (supabaseAdmin as any)
      .from('training_room_participant_access')
      .select('room_id,user_id,display_name,access_code,access_token_hash,created_at,updated_at,last_used_at')
      .eq('room_id', roomId)
      .eq('access_code', normalized)
      .maybeSingle(),
    { attempts: 2, delayMs: 120 }
  );
  if (error) {
    if (isMissingAccessTableError(String(error.message || ''))) return { row: null, tableMissing: true, error: '' };
    return { row: null, error: error.message || 'Не удалось найти код доступа' };
  }
  return { row: data as ParticipantAccessRow | null };
}

export async function touchParticipantAccess(supabaseAdmin: SupabaseClient, roomId: string, userId: string) {
  return await retryTransientApi<any>(
    () => (supabaseAdmin as any)
      .from('training_room_participant_access')
      .update({ last_used_at: new Date().toISOString() })
      .eq('room_id', roomId)
      .eq('user_id', userId),
    { attempts: 1, delayMs: 50 }
  );
}
