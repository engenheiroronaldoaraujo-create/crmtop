-- 022_fix_13digit_lids.sql
-- v2 phone validation: a phone that fails the semantic BR check (invalid DDD,
-- or structurally impossible subscriber) most likely slipped through the v1
-- length-only rule as a LID. Re-point its conversations/messages to the real
-- twin (a contact whose lid = 'lid:' || phone) and drop the empty shell; if no
-- twin exists, move the value to the lid column. Purely-numeric names (12+
-- digits) are cleared. Idempotent: re-running finds no invalid phones.

-- Same logic as the app's normalizePhoneStrict (plano de numeração ANATEL).
CREATE OR REPLACE FUNCTION is_valid_br_phone(p text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  digits  text := regexp_replace(p, '\D', '', 'g');
  ddd     int;
  body    text;
  valid_ddds int[] := ARRAY[
    11,12,13,14,15,16,17,18,19,
    21,22,24,27,28,
    31,32,33,34,35,37,38,
    41,42,43,44,45,46,47,48,49,
    51,53,54,55,
    61,62,63,64,65,66,67,68,69,
    71,73,74,75,77,79,
    81,82,83,84,85,86,87,88,89,
    91,92,93,94,95,96,97,98,99
  ];
BEGIN
  IF length(digits) = 10 OR length(digits) = 11 THEN
    ddd := substring(digits from 1 for 2)::int;
    body := substring(digits from 3);
    IF NOT (ddd = ANY(valid_ddds)) THEN RETURN false; END IF;
    IF length(digits) = 11 THEN
      RETURN left(body, 1) = '9';        -- mobile
    ELSE
      RETURN body ~ '^[2-9]';            -- landline / legacy mobile
    END IF;
  ELSIF length(digits) = 12 THEN
    IF left(digits, 2) <> '55' THEN RETURN false; END IF;
    ddd := substring(digits from 3 for 2)::int;
    IF NOT (ddd = ANY(valid_ddds)) THEN RETURN false; END IF;
    RETURN substring(digits from 5) ~ '^[2-9]\d{7}$';
  ELSIF length(digits) = 13 THEN
    IF left(digits, 2) <> '55' THEN RETURN false; END IF;
    ddd := substring(digits from 3 for 2)::int;
    IF NOT (ddd = ANY(valid_ddds)) THEN RETURN false; END IF;
    RETURN substring(digits from 5) ~ '^9\d{8}$';
  ELSE
    RETURN false;
  END IF;
END;
$$;

DO $$
DECLARE
  wrong    RECORD;
  twin_id  uuid;
  migrated int := 0;
  merged   int := 0;
BEGIN
  -- Step A: phones that are NOT valid BR phones AND have >= 12 digits (the
  -- minimum observed LID length). 10/11-digit invalid numbers are left as junk
  -- (the app discards them, never as a phone or a LID), matching the v2 rule.
  FOR wrong IN
    SELECT id, phone, name, push_name FROM contacts
    WHERE phone IS NOT NULL
      AND NOT is_valid_br_phone(phone)
      AND length(regexp_replace(phone, '\D', '', 'g')) >= 12
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
      -- No twin: the value is a LID (>= 12 digits) -> move it to the lid column.
      UPDATE contacts
      SET lid = 'lid:' || phone, phone = NULL
      WHERE id = wrong.id;
      migrated := migrated + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'fix_13digit_lids_022: migrated=%, merged=%', migrated, merged;
END $$;

-- Step B: purely-numeric names (12+ digits) are not names.
UPDATE contacts SET push_name = NULL WHERE push_name ~ '^\d{12,}$';
UPDATE contacts SET name = NULL WHERE name ~ '^\d{12,}$';

-- Verification: must return ZERO rows (no 12+ digit invalid phones remain).
SELECT *
FROM public.contacts
WHERE phone IS NOT NULL
  AND NOT is_valid_br_phone(phone)
  AND length(regexp_replace(phone, '\D', '', 'g')) >= 12;
