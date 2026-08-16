-- 020_fix_contacts_post_lid_import.sql
-- One-shot cleanup for the LID-as-phone pollution that slipped through the
-- bulk sync-contacts path (actionSyncContacts used raw digits for `c.number`
-- instead of normalizePhoneStrict). Reapplies the same repairs as 019, but is
-- safe to run idempotently on already-clean data.

DO $$
DECLARE
  wrong RECORD;
  twin_id uuid;
  migrated int := 0;
  merged   int := 0;
BEGIN
  -- Step A: contacts whose phone is really a LID (14+ digits).
  FOR wrong IN
    SELECT id, phone, name, push_name FROM contacts
    WHERE phone ~ '^\d{14,}$'
  LOOP
    SELECT id INTO twin_id
    FROM contacts
    WHERE lid = 'lid:' || wrong.phone
    LIMIT 1;

    IF twin_id IS NOT NULL THEN
      -- Re-point conversations of the wrong contact to the twin, except where
      -- the twin already has a conversation for the same instance.
      UPDATE conversations cv
      SET contact_id = twin_id
      WHERE cv.contact_id = wrong.id
        AND NOT EXISTS (
          SELECT 1 FROM conversations cv2
          WHERE cv2.contact_id = twin_id AND cv2.instance_id = cv.instance_id
        );

      -- Move messages from the wrong contact's conversations to the twin's
      -- conversations (per instance), skipping already-present messages.
      UPDATE messages m
      SET conversation_id = pc.id
      FROM conversations lc
      JOIN conversations pc
        ON pc.contact_id = twin_id AND pc.instance_id = lc.instance_id
      WHERE m.conversation_id = lc.id
        AND lc.contact_id = wrong.id
        AND NOT EXISTS (
          SELECT 1 FROM messages m2
          WHERE m2.conversation_id = pc.id AND m2.evolution_message_id = m.evolution_message_id
        );

      -- Drop the wrong contact's conversations that ended up empty.
      DELETE FROM conversations
      WHERE contact_id = wrong.id
        AND NOT EXISTS (
          SELECT 1 FROM messages m WHERE m.conversation_id = conversations.id
        );

      -- Copy name/push_name to the twin when they are missing there.
      UPDATE contacts c
      SET name = COALESCE(c.name, wrong.name),
          push_name = COALESCE(c.push_name, wrong.push_name)
      WHERE c.id = twin_id;

      DELETE FROM contacts WHERE id = wrong.id;
      merged := merged + 1;
    ELSE
      -- No twin: the value is a LID -> move it to the lid column.
      UPDATE contacts
      SET lid = 'lid:' || phone, phone = NULL
      WHERE id = wrong.id;
      migrated := migrated + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'lid_as_phone_cleanup_020: migrated=%, merged=%', migrated, merged;
END $$;

-- Step B: phone stored with non-canonical length (e.g. 9 digits without country
-- code) — for whatsapp-sourced rows only, prepend the +55 country code.
UPDATE public.contacts
SET phone = '55' || phone
WHERE source = 'whatsapp'
  AND phone ~ '^[0-9]{10,11}$';

-- Step C: names that are purely LID digits (14+ digits) are not names.
UPDATE contacts SET push_name = NULL WHERE push_name ~ '^\d{14,}$';
UPDATE contacts SET name = NULL WHERE name ~ '^\d{14,}$';

-- Verification: must return ZERO rows.
SELECT *
FROM public.contacts
WHERE phone ~ '^\d{14,}$';
