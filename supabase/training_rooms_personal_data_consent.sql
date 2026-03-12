-- Optional consent fields for participant join flow
alter table if exists public.training_room_members
  add column if not exists personal_data_consent boolean not null default false;

alter table if exists public.training_room_members
  add column if not exists personal_data_consent_at timestamptz;

comment on column public.training_room_members.personal_data_consent is
  'Participant accepted personal data processing consent when joining the assessment room.';

comment on column public.training_room_members.personal_data_consent_at is
  'Timestamp when participant accepted personal data processing consent.';
