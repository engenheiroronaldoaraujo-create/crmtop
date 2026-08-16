-- 015_merge_lid_contacts.sql
-- WhatsApp creates TWO contact records for the same person: one with a LID
-- JID (lid:xxx) and one with a real phone (@s.whatsapp.net). Same pushName.
-- Merge LID contacts into their phone-based counterpart.

-- Step 1: Temp table of LID contacts that have a matching phone contact.
CREATE TEMP TABLE _lm AS
SELECT l.id AS lid_id, p.id AS phone_id
FROM contacts l
JOIN contacts p ON l.push_name = p.push_name
WHERE l.push_name IS NOT NULL
  AND l.source = 'whatsapp' AND p.source = 'whatsapp'
  AND l.phone LIKE 'lid:%'
  AND p.phone NOT LIKE 'lid:%'
  AND p.phone ~ '^\d{10,15}$'
  AND EXISTS (SELECT 1 FROM conversations cv WHERE cv.contact_id = l.id);

-- Step 2: Re-point conversations from LID to phone (where phone has none).
UPDATE conversations
SET contact_id = m.phone_id
FROM _lm m
WHERE conversations.contact_id = m.lid_id
  AND NOT EXISTS (
    SELECT 1 FROM conversations cv2
    WHERE cv2.contact_id = m.phone_id AND cv2.instance_id = conversations.instance_id
  );

-- Step 3: Move messages from remaining LID convs to phone convs.
UPDATE messages SET conversation_id = pc.id
FROM _lm m, conversations lc, conversations pc
WHERE m.lid_id = lc.contact_id
  AND m.phone_id = pc.contact_id
  AND lc.instance_id = pc.instance_id
  AND messages.conversation_id = lc.id
  AND messages.conversation_id <> pc.id;

-- Step 4: Delete empty LID conversations.
DELETE FROM conversations
WHERE contact_id IN (SELECT lid_id FROM _lm)
  AND NOT EXISTS (SELECT 1 FROM messages WHERE messages.conversation_id = conversations.id);

-- Step 5: Delete LID contact duplicates.
DELETE FROM contacts WHERE id IN (SELECT lid_id FROM _lm);

-- Step 6: Refresh previews.
SELECT public.refresh_conversation_previews(
  (SELECT id FROM public.whatsapp_instances LIMIT 1)
);