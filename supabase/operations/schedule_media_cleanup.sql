-- Run only after the schema and Edge function have been verified. No existing
-- objects are enrolled. Do not print the secret or copy it into app configuration.
create extension if not exists pg_cron;
create extension if not exists pg_net;
do $$
declare token text;
begin
 select decrypted_secret into token from vault.decrypted_secrets where name='flatquest_media_cleanup_token';
 if token is null then
   token:=encode(extensions.gen_random_bytes(32),'hex');
   perform vault.create_secret(token,'flatquest_media_cleanup_token','Phase 5 scheduled media cleanup');
 end if;
 insert into private.media_worker_settings(id,token_hash) values(true,encode(extensions.digest(token,'sha256'),'hex'))
 on conflict(id) do update set token_hash=excluded.token_hash;
end $$;
select cron.schedule('flatquest-media-cleanup','17 * * * *', $job$
 select net.http_post(
   url:='https://ivnovvdpkxrqsmsiqhid.supabase.co/functions/v1/media-cleanup',
   headers:=jsonb_build_object('Content-Type','application/json','x-cleanup-token',(select decrypted_secret from vault.decrypted_secrets where name='flatquest_media_cleanup_token')),
   body:='{"dry_run":false}'::jsonb, timeout_milliseconds:=30000
 );
$job$);

