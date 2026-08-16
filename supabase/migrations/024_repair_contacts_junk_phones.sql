-- 024_repair_contacts_junk_phones.sql
-- Reparo one-shot (idempotente) de dados antigos/poluídos que ainda sobram do
-- período pré-LID ou de imports antigos:
--
--   A. contacts.phone com 14+ dígitos = LID disfarçado de telefone:
--      - se existe um gêmeo com lid = 'lid:' || phone → merge (move
--        conversas/mensagens, copia nome, remove a linha errada);
--      - senão → move o valor para a coluna lid (phone = NULL).
--   B. contacts.phone com 12–13 dígitos que NÃO passam na validação canônica
--      BR (is_valid_br_phone, criada na migration 022) = LID (14+ é raro, mas
--      o mínimo observado de LID é 12) → mesma regra de merge/lid do item A.
--   C. name / push_name que são apenas dígitos (12+) não são nomes → limpa.
--   D. lid sem o prefixo 'lid:' (dados antigos) → normaliza adicionando o
--      prefixo.
--
-- Segue exatamente a regra canônica do app (normalizePhoneStrict v2). Rodar
-- de novo não faz mal: após a primeira execução não sobram linhas inválidas.

DO $$
DECLARE
  wrong    RECORD;
  twin_id  uuid;
  merged   int := 0;
  migrated int := 0;
BEGIN
  -- Passo A+B: phones inválidos com >= 12 dígitos.
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
      -- Reaponta conversas do contato errado para o gêmeo, exceto onde o
      -- gêmeo já tem conversa para a mesma instância.
      UPDATE conversations cv
      SET contact_id = twin_id
      WHERE cv.contact_id = wrong.id
        AND NOT EXISTS (
          SELECT 1 FROM conversations cv2
          WHERE cv2.contact_id = twin_id AND cv2.instance_id = cv.instance_id
        );

      -- Move mensagens do contato errado para o gêmeo (por instância),
      -- pulando mensagens já presentes.
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

      -- Remove conversas do contato errado que ficaram vazias.
      DELETE FROM conversations
      WHERE contact_id = wrong.id
        AND NOT EXISTS (
          SELECT 1 FROM messages m WHERE m.conversation_id = conversations.id
        );

      -- Copia nome/push_name para o gêmeo quando faltam lá.
      UPDATE contacts c
      SET name = COALESCE(c.name, wrong.name),
          push_name = COALESCE(c.push_name, wrong.push_name)
      WHERE c.id = twin_id;

      DELETE FROM contacts WHERE id = wrong.id;
      merged := merged + 1;
    ELSE
      -- Sem gêmeo: o valor é LID -> move para a coluna lid.
      UPDATE contacts
      SET lid = 'lid:' || phone, phone = NULL
      WHERE id = wrong.id;
      migrated := migrated + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'repair_024: merged=%, migrated=%', merged, migrated;
END $$;

-- Passo C: nomes que são apenas dígitos (12+) não são nomes.
UPDATE contacts SET push_name = NULL WHERE push_name ~ '^\d{12,}$';
UPDATE contacts SET name = NULL WHERE name ~ '^\d{12,}$';

-- Passo D: normaliza LIDs sem o prefixo 'lid:'.
UPDATE contacts
SET lid = 'lid:' || lid
WHERE lid IS NOT NULL
  AND lid ~ '^\d+$'
  AND lid NOT LIKE 'lid:%';

-- Verificação: deve retornar ZERO linhas (nenhum phone inválido >= 12 dígitos).
SELECT *
FROM public.contacts
WHERE phone IS NOT NULL
  AND NOT is_valid_br_phone(phone)
  AND length(regexp_replace(phone, '\D', '', 'g')) >= 12;