const PREFIX = 'training_room_session_v1_';
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

export type TrainingRoomLocalSession = {
  roomId: string;
  displayName: string;
  consent: boolean;
  expiresAt: number;
};

function getKey(roomId: string) {
  return `${PREFIX}${roomId}`;
}

export function getTrainingRoomSession(roomId: string): TrainingRoomLocalSession | null {
  if (typeof window === 'undefined' || !roomId) return null;
  try {
    const raw = localStorage.getItem(getKey(roomId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TrainingRoomLocalSession>;
    if (!parsed || typeof parsed !== 'object') return null;
    const expiresAt = Number(parsed.expiresAt || 0);
    if (!expiresAt || Date.now() > expiresAt) {
      localStorage.removeItem(getKey(roomId));
      return null;
    }
    return {
      roomId,
      displayName: String(parsed.displayName || '').trim(),
      consent: Boolean(parsed.consent),
      expiresAt,
    };
  } catch {
    return null;
  }
}

export function saveTrainingRoomSession(roomId: string, displayName: string, consent = true, ttlMs = DEFAULT_TTL_MS) {
  if (typeof window === 'undefined' || !roomId) return;
  try {
    const payload: TrainingRoomLocalSession = {
      roomId,
      displayName: String(displayName || '').trim(),
      consent: Boolean(consent),
      expiresAt: Date.now() + ttlMs,
    };
    localStorage.setItem(getKey(roomId), JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export function clearTrainingRoomSession(roomId: string) {
  if (typeof window === 'undefined' || !roomId) return;
  try {
    localStorage.removeItem(getKey(roomId));
  } catch {
    // ignore
  }
}

export function hasActiveTrainingRoomSession(roomId: string) {
  return !!getTrainingRoomSession(roomId);
}

export const TRAINING_ROOM_SESSION_TTL_MS = DEFAULT_TTL_MS;
