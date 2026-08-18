DROP POLICY IF EXISTS "whatsapp_media_select_auth" ON storage.objects;
CREATE POLICY "whatsapp_media_select_auth"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'whatsapp-media');

DROP POLICY IF EXISTS "whatsapp_media_insert_service" ON storage.objects;
CREATE POLICY "whatsapp_media_insert_service"
ON storage.objects FOR INSERT TO service_role
WITH CHECK (bucket_id = 'whatsapp-media');

DROP POLICY IF EXISTS "whatsapp_media_delete_auth" ON storage.objects;
CREATE POLICY "whatsapp_media_delete_auth"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'whatsapp-media');
