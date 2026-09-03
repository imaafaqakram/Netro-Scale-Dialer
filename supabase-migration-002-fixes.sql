-- ============================================
-- Fixes: recording_type constraint mismatch + recording/voicemail defaults
-- Run this in Supabase SQL Editor AFTER supabase-migration.sql
-- ============================================

-- 1. The original migration's CHECK constraint only allowed
--    recording_type IN ('recording', 'voicemail'), but every write path in the
--    app (src/app/api/twilio/recording-status/route.ts,
--    src/app/api/user/recordings/route.ts) — and the frontend type in
--    src/app/recordings/page.tsx — has always used 'call' for a normal call
--    recording, never 'recording'. Every call-recording insert has therefore
--    been silently rejected by the CHECK constraint since day one (the error
--    was logged server-side but swallowed before it reached Twilio or the UI):
--    recordings were captured and billed by Twilio but never saved. Voicemails
--    were unaffected — that path already correctly wrote 'voicemail'.
--    Realign the constraint with what the app actually writes.
ALTER TABLE call_recordings DROP CONSTRAINT IF EXISTS call_recordings_recording_type_check;
ALTER TABLE call_recordings ADD CONSTRAINT call_recordings_recording_type_check
    CHECK (recording_type IN ('call', 'voicemail'));
ALTER TABLE call_recordings ALTER COLUMN recording_type SET DEFAULT 'call';

-- 2. call_recording_enabled / voicemail_enabled defaulted to false, making them
--    opt-in on a business line and easy to never discover. This only changes the
--    default applied to NEWLY inserted numbers — it deliberately does NOT touch
--    any existing row, since flipping an existing number's recording/voicemail
--    preference without the owner's action is a consent decision that isn't
--    ours to make silently.
ALTER TABLE user_phone_numbers ALTER COLUMN call_recording_enabled SET DEFAULT true;
ALTER TABLE user_phone_numbers ALTER COLUMN voicemail_enabled SET DEFAULT true;
