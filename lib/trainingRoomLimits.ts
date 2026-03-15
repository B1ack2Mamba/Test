export type TrainingRoomLimitState = {
  softLimit: number;
  hardLimit: number;
  isSoftExceeded: boolean;
  isHardExceeded: boolean;
  participantCount: number;
};

function readPositiveInt(value: string | undefined, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function getTrainingRoomSoftLimit() {
  return readPositiveInt(process.env.TRAINING_ROOM_PARTICIPANT_SOFT_LIMIT, 150);
}

export function getTrainingRoomHardLimit() {
  return readPositiveInt(process.env.TRAINING_ROOM_PARTICIPANT_HARD_LIMIT, 250);
}

export function buildTrainingRoomLimitState(participantCount: number): TrainingRoomLimitState {
  const softLimit = getTrainingRoomSoftLimit();
  const hardLimit = Math.max(getTrainingRoomHardLimit(), softLimit);
  return {
    softLimit,
    hardLimit,
    participantCount,
    isSoftExceeded: participantCount >= softLimit,
    isHardExceeded: participantCount >= hardLimit,
  };
}
