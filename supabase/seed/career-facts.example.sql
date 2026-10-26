-- Example career facts row. Placeholder structure only: replace every line with
-- your own facts before running, and never commit real personal data.
--
-- Run in the Supabase SQL editor with your user id:
--   replace 00000000-0000-0000-0000-000000000000 with auth.users.id for your account.
--
-- Agents use only what is written here. If something is not listed, scoring
-- reports it as a gap rather than guessing.

insert into public.career_facts (user_id, credentials, experience, other)
values (
  '00000000-0000-0000-0000-000000000000',
  $facts$
<Degree, field, school, year>
<Certification, issuing body, year>
<License, state, status>
$facts$,
  $facts$
<Title, employer, setting, start year to end year>
<Scope: teams led, sites, volume, as you would state it>
<Key result, in your own words>
$facts$,
  $facts$
<Systems or instruments you know>
<Location or relocation preferences>
$facts$
)
on conflict (user_id) do update
  set credentials = excluded.credentials,
      experience  = excluded.experience,
      other       = excluded.other;
