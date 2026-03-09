-- Patch existing DB row for test learning-typology.
-- Fix Q20 ("Ваш девиз по жизни") mapping:
-- A -> PRA, B -> OBS, C -> THE, D -> EXP

update public.tests
set json = jsonb_set(
  jsonb_set(
    json,
    '{questions,19,options,0,tags}',
    '["PRA"]'::jsonb,
    true
  ),
  '{questions,19,options,3,tags}',
  '["EXP"]'::jsonb,
  true
)
where slug = 'learning-typology';
