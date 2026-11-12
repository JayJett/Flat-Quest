-- Disposable local Supabase only. Every fixture and reservation rolls back.
begin;
create function pg_temp.assert_true(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
do $$
declare
 u uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); h uuid; other_h uuid; r uuid; other_r uuid;
 a uuid; b uuid; idea uuid; pair uuid; reserved jsonb; path_a text; path_b text; abandoned text; candidates jsonb;
begin
 insert into auth.users(id,instance_id,aud,role,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at)
 values(u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',u||'@phase5.invalid','{}','{}',now(),now()),
 (outsider,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',outsider||'@phase5.invalid','{}','{}',now(),now());
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 perform set_config('role','authenticated',true);
 h:=public.create_household('Visual fixture','');
 insert into public.rooms(household_id,name) values(h,'Visual room') returning id into r;
 insert into public.rooms(household_id,name) values(h,'Second room') returning id into other_r;
 reserved:=public.reserve_media_upload(h,'visual','webp'); path_a:=reserved->>'path';
 insert into public.room_visuals(household_id,room_id,kind,photo_path,thumbnail_path)
 values(h,r,'photo',path_a,reserved->>'thumbnail_path') returning id into a;
 reserved:=public.reserve_media_upload(h,'visual','jpg'); path_b:=reserved->>'path';
 insert into public.room_visuals(household_id,room_id,kind,photo_path,thumbnail_path)
 values(h,r,'photo',path_b,reserved->>'thumbnail_path') returning id into b;
 insert into public.room_visuals(household_id,room_id,kind,source_url) values(h,r,'inspiration','https://example.com') returning id into idea;
 perform pg_temp.assert_true((select count(*)=3 from public.room_visuals where room_id=r),'member can create title-free photos and source-only inspiration');
 update public.room_visuals set title='Optional title',sort_order=1024 where id=a;
 perform pg_temp.assert_true((select title='Optional title' from public.room_visuals where id=a),'member can edit and reorder');
 insert into public.room_transformations(household_id,room_id,before_id,after_id) values(h,r,a,b) returning id into pair;
 perform pg_temp.assert_true(pair is not null,'member can pair photos without administrative fields');
 begin
  update public.room_visuals set room_id=other_r where id=a;
  raise exception 'FAIL: visual reparenting allowed';
 exception when insufficient_privilege then raise notice 'PASS: visual room is immutable'; end;
 begin
  insert into public.room_transformations(household_id,room_id,before_id,after_id) values(h,r,a,idea);
  raise exception 'FAIL: inspiration used as flat photo';
 exception when check_violation then raise notice 'PASS: transformations require flat photos'; end;
 begin
  insert into public.room_transformations(household_id,room_id,before_id,after_id) values(h,other_r,a,b);
  raise exception 'FAIL: cross-room pairing allowed';
 exception when foreign_key_violation then raise notice 'PASS: pair belongs to same room'; end;
 begin
  perform public.claim_media_cleanup(false);
  raise exception 'FAIL: member can run cleanup';
 exception when insufficient_privilege then raise notice 'PASS: worker RPC denied to members'; end;
 begin
  perform 1 from private.media_uploads;
  raise exception 'FAIL: private registry exposed';
 exception when insufficient_privilege then raise notice 'PASS: registry inaccessible'; end;
 perform pg_temp.assert_true(not has_table_privilege('authenticated','public.items','TRUNCATE'),'legacy truncate revoked');
 perform pg_temp.assert_true(not has_table_privilege('authenticated','public.rooms','TRIGGER'),'legacy trigger revoked');
 abandoned:=public.reserve_media_upload(h,'products','jpg')->>'path';
 perform set_config('role','none',true);
 update private.media_uploads set created_at=now()-interval '25 hours' where household_id=h;
 perform set_config('role','service_role',true);
 candidates:=public.claim_media_cleanup(true);
 perform pg_temp.assert_true(jsonb_array_length(candidates)=1 and candidates->0->>'path'=abandoned,'dry run only reports unreferenced uploads');
 perform set_config('role','none',true);
 perform pg_temp.assert_true((select state='available' from private.media_uploads where path=abandoned),'dry run does not mutate candidates');
 perform set_config('role','service_role',true);
 candidates:=public.claim_media_cleanup(false);
 perform pg_temp.assert_true(jsonb_array_length(candidates)=1,'worker claims eligible upload');
 perform public.finish_media_cleanup(abandoned,'Temporary storage failure');
 perform set_config('role','none',true);
 perform pg_temp.assert_true((select state='deleting' and last_error is not null from private.media_uploads where path=abandoned),'failed deletion remains retryable');
 perform set_config('role','service_role',true);
 candidates:=public.claim_media_cleanup(false);
 perform pg_temp.assert_true(jsonb_array_length(candidates)=1,'retry returns failed object');
 perform public.finish_media_cleanup(abandoned,null);
 perform set_config('role','none',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider,'role','authenticated')::text,true);
 perform set_config('role','authenticated',true);
 other_h:=public.create_household('Other visual fixture','');
 perform pg_temp.assert_true((select count(*)=0 from public.room_visuals where household_id=h),'outsider cannot read gallery');
 perform pg_temp.assert_true((select count(*)=0 from public.room_transformations where household_id=h),'outsider cannot read comparisons');
 begin
  perform public.reserve_media_upload(h,'visual','webp');
  raise exception 'FAIL: outsider reserves upload';
 exception when insufficient_privilege then raise notice 'PASS: outsider cannot reserve'; end;
 begin
  insert into public.room_visuals(household_id,room_id,kind,source_url) values(h,r,'inspiration','https://example.com');
  raise exception 'FAIL: outsider writes gallery';
 exception when insufficient_privilege then raise notice 'PASS: outsider cannot write'; end;
 perform set_config('role','none',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 perform set_config('role','authenticated',true);
 delete from public.room_visuals where id=a;
 perform pg_temp.assert_true((select count(*)=0 from public.room_transformations where id=pair),'photo deletion removes dependent comparison');
 perform pg_temp.assert_true((select count(*)=1 from public.room_visuals where id=b),'other photo retained');
 perform set_config('role','none',true);
 perform set_config('role','service_role',true);
 candidates:=public.claim_media_cleanup(false);
 perform pg_temp.assert_true(jsonb_array_length(candidates)=1 and candidates->0->>'path'=path_a,'deleted photo queued and referenced photo retained');
 perform set_config('role','none',true);
 perform set_config('role','authenticated',true);
 begin
  insert into public.room_visuals(household_id,room_id,kind,photo_path,thumbnail_path)
  values(h,r,'photo',path_a,regexp_replace(path_a,'\.(webp|jpg)$','-thumb.\1'));
  raise exception 'FAIL: deleting upload reattached';
 exception when check_violation then raise notice 'PASS: cleanup claim prevents reattachment'; end;
 delete from public.rooms where id=r;
 perform pg_temp.assert_true((select count(*)=0 from public.room_visuals where room_id=r),'room deletion cascades visual metadata');
 perform set_config('role','none',true);
 perform pg_temp.assert_true((select count(*)=3 from private.media_uploads where household_id=h),'cleanup records survive room deletion');
 raise notice 'Phase 5 access and lifecycle checks complete';
end $$;
rollback;

