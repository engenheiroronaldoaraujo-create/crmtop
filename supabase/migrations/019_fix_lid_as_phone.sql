-- 019_fix_lid_as_phone.sql
-- Definite fix for LIDs being stored as phone numbers. LIDs have 14–16 digits;
-- the canonical phone rule only accepts 10–13 digits. This migration repairs
-- already-polluted rows:
--
--   1. contacts.phone with 14+ digits is a disguised LID:
--      a. if a twin contact already has lid = 'lid:' || phone -> merge (move
--         conversations/messages, copy name/push_name, delete the wrong row);
--      b. otherwise -> move the value into the lid column (phone = NULL).
--   2. name / push_name that are purely 14+ digits are LID digits used as a
--      display name -> cleared.
--
-- Keeps the existing convention: the `lid` column stores values WITH the
-- `lid:` prefix.

DO $$
DECLARE
  wrong RECORD;
  twin_id uuid;
  migrated int := 0;
  merged   int := 0;
  cleaned  int := 0;
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

      -- Remove the wrong contact.
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

  -- Step B: names that are purely LID digits are not names.
  UPDATE contacts SET push_name = NULL WHERE push_name ~ '^\d{14,}$';
  cleaned := cleaned + 1;
  UPDATE contacts SET name = NULL WHERE name ~ '^\d{14,}$';
  cleaned := cleaned + 1;

  RAISE NOTICE 'lid_as_phone: migrated=%, merged=%, name_cleanup_steps=%', migrated, merged, cleaned;
END $$;

-- Verification: must return ZERO rows.
SELECT *
FROM public.contacts
WHERE phone ~ '^\d{14,}$';
