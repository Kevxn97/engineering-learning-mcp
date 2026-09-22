SET ROLE elm_owner;
-- Registry operations are unavailable to the MCP database role.
CREATE FUNCTION elm.registry_snapshot() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,elm AS $$
BEGIN
 IF NOT elm.is_admin() THEN RAISE EXCEPTION 'not available' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object(
 'principals',(SELECT coalesce(jsonb_agg(x),'[]') FROM (SELECT id,display_name,active FROM elm.principals WHERE organization_id=elm.org() ORDER BY id LIMIT 100) x),
 'projects',(SELECT coalesce(jsonb_agg(x),'[]') FROM (SELECT id,name,team_id,active FROM elm.projects WHERE organization_id=elm.org() ORDER BY id LIMIT 100) x),
 'teams',(SELECT coalesce(jsonb_agg(x),'[]') FROM (SELECT id,name,active FROM elm.teams WHERE organization_id=elm.org() ORDER BY id LIMIT 100) x));
END $$;
CREATE FUNCTION elm.registry_change(action text, data jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,elm AS $$
DECLARE target uuid; person uuid; role_value text;
BEGIN
 IF NOT elm.is_admin() THEN RAISE EXCEPTION 'not available' USING ERRCODE='42501'; END IF;
 target:=coalesce((data->>'id')::uuid,gen_random_uuid());
 CASE action
 WHEN 'create_principal' THEN
  INSERT INTO elm.principals(id,organization_id,issuer,subject,display_name) VALUES(target,elm.org(),data->>'issuer',data->>'subject',data->>'name');
 WHEN 'create_team' THEN INSERT INTO elm.teams(id,organization_id,name) VALUES(target,elm.org(),data->>'name');
 WHEN 'create_project' THEN
  IF data->>'team_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM elm.teams WHERE id=(data->>'team_id')::uuid AND organization_id=elm.org()) THEN RAISE EXCEPTION 'not available'; END IF;
  INSERT INTO elm.projects(id,organization_id,name,team_id) VALUES(target,elm.org(),data->>'name',(data->>'team_id')::uuid);
 WHEN 'set_active' THEN
  UPDATE elm.principals SET active=(data->>'active')::boolean WHERE id=target AND organization_id=elm.org();
  IF NOT FOUND THEN RAISE EXCEPTION 'not available'; END IF;
 WHEN 'project_membership','team_membership' THEN
  person:=(data->>'principal_id')::uuid; role_value:=data->>'role';
  IF NOT EXISTS(SELECT 1 FROM elm.principals WHERE id=person AND organization_id=elm.org()) THEN RAISE EXCEPTION 'not available'; END IF;
  IF role_value NOT IN('reader','contributor','curator','remove') THEN RAISE EXCEPTION 'invalid role'; END IF;
  IF action='project_membership' THEN
   IF NOT EXISTS(SELECT 1 FROM elm.projects WHERE id=target AND organization_id=elm.org()) THEN RAISE EXCEPTION 'not available'; END IF;
   IF role_value='remove' THEN DELETE FROM elm.project_memberships WHERE principal_id=person AND project_id=target;
   ELSE INSERT INTO elm.project_memberships(principal_id,project_id,role) VALUES(person,target,role_value) ON CONFLICT(principal_id,project_id) DO UPDATE SET role=EXCLUDED.role; END IF;
  ELSE
   IF NOT EXISTS(SELECT 1 FROM elm.teams WHERE id=target AND organization_id=elm.org()) THEN RAISE EXCEPTION 'not available'; END IF;
   IF role_value='remove' THEN DELETE FROM elm.team_memberships WHERE principal_id=person AND team_id=target;
   ELSE INSERT INTO elm.team_memberships(principal_id,team_id,role) VALUES(person,target,role_value) ON CONFLICT(principal_id,team_id) DO UPDATE SET role=EXCLUDED.role; END IF;
  END IF;
 WHEN 'repository_alias' THEN
  IF NOT EXISTS(SELECT 1 FROM elm.projects WHERE id=(data->>'project_id')::uuid AND organization_id=elm.org()) THEN RAISE EXCEPTION 'not available'; END IF;
  INSERT INTO elm.repository_aliases(id,organization_id,project_id,host,path) VALUES(target,elm.org(),(data->>'project_id')::uuid,data->>'host',data->>'path');
 ELSE RAISE EXCEPTION 'invalid operation';
 END CASE;
 INSERT INTO elm.audit_events(id,organization_id,actor_id,operation,object_id,metadata,policy_version)
 VALUES(gen_random_uuid(),elm.org(),elm.actor(),'registry.'||action,target,'{}','2026-09-22.1');
 RETURN target;
END $$;
GRANT EXECUTE ON FUNCTION elm.registry_snapshot(),elm.registry_change(text,jsonb) TO elm_review;

-- Restricted provenance must never become visible to a team-only reader.
CREATE FUNCTION elm.suspend_dependents(source_id uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,elm AS $$
DECLARE child uuid; total integer:=0;
BEGIN
 IF NOT elm.curate_learning(source_id) THEN RAISE EXCEPTION 'not available' USING ERRCODE='42501'; END IF;
 FOR child IN WITH RECURSIVE dependencies AS (
  SELECT learning_id FROM elm.lineage WHERE source_learning_id=source_id AND organization_id=elm.org()
  UNION SELECT l.learning_id FROM elm.lineage l JOIN dependencies d ON l.source_learning_id=d.learning_id WHERE l.organization_id=elm.org()
 ) SELECT learning_id FROM dependencies LOOP
  UPDATE elm.learnings SET state='suspended',updated_at=now() WHERE id=child AND organization_id=elm.org() AND state='active';
  IF FOUND THEN
   total:=total+1;
   INSERT INTO elm.retirement_events(id,organization_id,learning_id,action) VALUES(gen_random_uuid(),elm.org(),child,'suspended');
   INSERT INTO elm.audit_events(id,organization_id,actor_id,operation,object_id,metadata,policy_version) VALUES(gen_random_uuid(),elm.org(),elm.actor(),'learning.dependency_suspended',child,'{}','2026-09-22.1');
  END IF;
 END LOOP;
 RETURN total;
END $$;
GRANT EXECUTE ON FUNCTION elm.suspend_dependents(uuid) TO elm_review;

-- A restore starts blocked; applying an external post-backup retirement manifest
-- is a distinct maintenance operation. The database backup alone is insufficient.
CREATE FUNCTION elm.apply_retirements(o uuid,items jsonb) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,elm AS $$
DECLARE item jsonb; target uuid; action text; total integer:=0;
BEGIN
 UPDATE elm.service_state SET serving=false WHERE organization_id=o;
 FOR item IN SELECT * FROM jsonb_array_elements(items) LOOP
  target:=(item->>'learning_id')::uuid;action:=item->>'action';
  IF action NOT IN('suspended','revoked','archived','purged') THEN RAISE EXCEPTION 'invalid retirement'; END IF;
  UPDATE elm.learnings SET state=CASE WHEN action='purged' THEN 'revoked' ELSE action END,updated_at=now() WHERE organization_id=o AND id=target;
  INSERT INTO elm.retirement_events(id,organization_id,learning_id,action) VALUES(gen_random_uuid(),o,target,action);
  IF action='purged' THEN
   -- Remove derived payload copies first. Provenance must not resurrect deleted knowledge.
   DELETE FROM elm.proposals WHERE organization_id=o AND (derived_from=target OR amends_learning_id=target OR id IN(SELECT proposal_id FROM elm.review_decisions WHERE learning_id=target));
   DELETE FROM elm.learnings WHERE organization_id=o AND id=target;
   DELETE FROM elm.delivery_receipts WHERE organization_id=o AND learning_id=target;
   DELETE FROM elm.idempotency_records WHERE organization_id=o;
  END IF;
  total:=total+1;
 END LOOP;
 RETURN total;
END $$;
CREATE FUNCTION elm.retirement_manifest(o uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,elm AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('learning_id',learning_id,'action',action) ORDER BY created_at,id),'[]') FROM elm.retirement_events WHERE organization_id=o $$;
CREATE FUNCTION elm.set_serving(o uuid,enabled boolean) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,elm AS $$ UPDATE elm.service_state SET serving=enabled WHERE organization_id=o $$;
CREATE FUNCTION elm.retention(o uuid,proposal_days integer,receipt_days integer,audit_days integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,elm AS $$
BEGIN
 IF proposal_days<1 OR receipt_days<1 OR audit_days<1 OR greatest(proposal_days,receipt_days,audit_days)>3650 THEN RAISE EXCEPTION 'invalid retention'; END IF;
 DELETE FROM elm.proposals WHERE organization_id=o AND status<>'accepted' AND updated_at<now()-make_interval(days=>proposal_days);
 DELETE FROM elm.delivery_receipts WHERE organization_id=o AND created_at<now()-make_interval(days=>receipt_days);
 DELETE FROM elm.idempotency_records WHERE organization_id=o AND created_at<now()-make_interval(days=>greatest(proposal_days,receipt_days));
 DELETE FROM elm.audit_events WHERE organization_id=o AND created_at<now()-make_interval(days=>audit_days);
 DELETE FROM elm.review_sessions WHERE organization_id=o AND expires_at<now();
 DELETE FROM elm.rate_buckets WHERE organization_id=o AND bucket<to_char(now()-interval '2 days','YYYY-MM-DD');
END $$;
GRANT EXECUTE ON FUNCTION elm.apply_retirements(uuid,jsonb),elm.retirement_manifest(uuid),elm.set_serving(uuid,boolean),elm.retention(uuid,integer,integer,integer) TO elm_maintenance;
RESET ROLE;
