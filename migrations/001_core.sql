-- Run only against a dedicated database with a migration administrator.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='elm_owner') THEN CREATE ROLE elm_owner NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='elm_mcp') THEN CREATE ROLE elm_mcp LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='elm_review') THEN CREATE ROLE elm_review LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='elm_maintenance') THEN CREATE ROLE elm_maintenance LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS; END IF;
END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA elm AUTHORIZATION elm_owner;
SET ROLE elm_owner;
REVOKE ALL ON SCHEMA elm FROM PUBLIC;
GRANT USAGE ON SCHEMA elm TO elm_mcp,elm_review,elm_maintenance;
ALTER DEFAULT PRIVILEGES IN SCHEMA elm REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE elm.principals (
 id uuid PRIMARY KEY, organization_id uuid NOT NULL, issuer text NOT NULL, subject text NOT NULL,
 display_name text NOT NULL CHECK(length(display_name)<=120), active boolean NOT NULL DEFAULT true,
 membership_admin boolean NOT NULL DEFAULT false, operator boolean NOT NULL DEFAULT false,
 UNIQUE(organization_id,issuer,subject)
);
CREATE TABLE elm.teams (id uuid PRIMARY KEY,organization_id uuid NOT NULL,name text NOT NULL,active boolean NOT NULL DEFAULT true);
CREATE TABLE elm.projects (id uuid PRIMARY KEY,organization_id uuid NOT NULL,team_id uuid REFERENCES elm.teams(id),name text NOT NULL,active boolean NOT NULL DEFAULT true);
CREATE TABLE elm.project_memberships (principal_id uuid REFERENCES elm.principals(id),project_id uuid REFERENCES elm.projects(id),role text NOT NULL CHECK(role IN ('reader','contributor','curator')),PRIMARY KEY(principal_id,project_id));
CREATE TABLE elm.team_memberships (principal_id uuid REFERENCES elm.principals(id),team_id uuid REFERENCES elm.teams(id),role text NOT NULL CHECK(role IN ('reader','contributor','curator')),PRIMARY KEY(principal_id,team_id));
CREATE TABLE elm.repository_aliases (id uuid PRIMARY KEY,organization_id uuid NOT NULL,project_id uuid NOT NULL REFERENCES elm.projects(id),host text NOT NULL,path text NOT NULL,UNIQUE(organization_id,host,path));
CREATE TABLE elm.participation (principal_id uuid REFERENCES elm.principals(id),project_id uuid REFERENCES elm.projects(id),organization_id uuid NOT NULL,mode text NOT NULL CHECK(mode IN('manual','auto','off')),policy_version text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(principal_id,project_id));
CREATE TABLE elm.service_state (organization_id uuid PRIMARY KEY,serving boolean NOT NULL DEFAULT false);
CREATE TABLE elm.learnings (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,audience_kind text NOT NULL CHECK(audience_kind IN('project','team')),audience_id uuid NOT NULL,
 current_revision integer NOT NULL CHECK(current_revision>0),state text NOT NULL CHECK(state IN('active','suspended','revoked','archived')),
 valid_until timestamptz NOT NULL,review_due_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE elm.learning_revisions (
 learning_id uuid REFERENCES elm.learnings(id) ON DELETE CASCADE,revision integer NOT NULL CHECK(revision>0),organization_id uuid NOT NULL,
 body jsonb NOT NULL CHECK(jsonb_typeof(body)='object'),content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
 evidence_quality text NOT NULL CHECK(evidence_quality='reviewer_checked'),created_at timestamptz NOT NULL DEFAULT now(),
 search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple',coalesce(body->>'title','')||' '||coalesce(body->>'observation','')||' '||coalesce(body->'applicability'->>'component','')||' '||coalesce((body->'tags')::text,''))) STORED,
 PRIMARY KEY(learning_id,revision)
);
CREATE INDEX learning_search ON elm.learning_revisions USING gin(search_vector);
CREATE INDEX learning_visibility ON elm.learnings(organization_id,audience_kind,audience_id,state,valid_until);
CREATE TABLE elm.proposals (
 id uuid PRIMARY KEY,organization_id uuid NOT NULL,author_id uuid NOT NULL REFERENCES elm.principals(id),source_project_id uuid NOT NULL REFERENCES elm.projects(id),
 target_team_id uuid REFERENCES elm.teams(id),derived_from uuid REFERENCES elm.learnings(id) ON DELETE SET NULL,
 amends_learning_id uuid REFERENCES elm.learnings(id) ON DELETE SET NULL,base_revision integer,
 current_revision integer NOT NULL DEFAULT 1 CHECK(current_revision>0),status text NOT NULL DEFAULT 'pending_review' CHECK(status IN('pending_review','changes_requested','accepted','rejected','withdrawn','expired')),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days',
 CHECK((amends_learning_id IS NULL AND base_revision IS NULL) OR (amends_learning_id IS NOT NULL AND base_revision>0)),
 CHECK(target_team_id IS NULL OR derived_from IS NOT NULL)
);
CREATE TABLE elm.proposal_revisions (proposal_id uuid REFERENCES elm.proposals(id) ON DELETE CASCADE,revision integer NOT NULL CHECK(revision>0),organization_id uuid NOT NULL,body jsonb NOT NULL CHECK(jsonb_typeof(body)='object'),content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(proposal_id,revision));
CREATE INDEX proposal_inbox ON elm.proposals(source_project_id,status,created_at DESC);
CREATE TABLE elm.lineage (learning_id uuid PRIMARY KEY REFERENCES elm.learnings(id) ON DELETE CASCADE,source_learning_id uuid NOT NULL REFERENCES elm.learnings(id) ON DELETE CASCADE,source_project_id uuid NOT NULL REFERENCES elm.projects(id),organization_id uuid NOT NULL);
CREATE TABLE elm.learning_conflicts (left_id uuid REFERENCES elm.learnings(id) ON DELETE CASCADE,right_id uuid REFERENCES elm.learnings(id) ON DELETE CASCADE,organization_id uuid NOT NULL,PRIMARY KEY(left_id,right_id),CHECK(left_id<right_id));
CREATE TABLE elm.review_decisions (id uuid PRIMARY KEY,organization_id uuid NOT NULL,proposal_id uuid NOT NULL REFERENCES elm.proposals(id) ON DELETE CASCADE,proposal_revision integer NOT NULL,content_hash text NOT NULL,reviewer_id uuid NOT NULL REFERENCES elm.principals(id),decision text NOT NULL CHECK(decision IN('accept','request_changes','reject')),reason text NOT NULL,learning_id uuid REFERENCES elm.learnings(id) ON DELETE SET NULL,learning_revision integer,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(proposal_id,proposal_revision));
CREATE TABLE elm.delivery_receipts (id uuid PRIMARY KEY,organization_id uuid NOT NULL,principal_id uuid NOT NULL REFERENCES elm.principals(id),request_id uuid NOT NULL,learning_id uuid NOT NULL,revision integer NOT NULL,representation text NOT NULL CHECK(representation IN('preview','full')),representation_hash text NOT NULL,policy_version text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX receipts_retention ON elm.delivery_receipts(created_at);
CREATE TABLE elm.feedback (id uuid PRIMARY KEY,organization_id uuid NOT NULL,principal_id uuid NOT NULL REFERENCES elm.principals(id),learning_id uuid NOT NULL REFERENCES elm.learnings(id) ON DELETE CASCADE,revision integer NOT NULL,category text NOT NULL CHECK(category IN('helpful','not_applicable','outdated','incorrect','security')),note text,delivery_id uuid REFERENCES elm.delivery_receipts(id) ON DELETE SET NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE elm.idempotency_records (organization_id uuid NOT NULL,principal_id uuid NOT NULL,operation text NOT NULL,key text NOT NULL,payload_hash text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(organization_id,principal_id,operation,key));
CREATE TABLE elm.audit_events (id uuid PRIMARY KEY,organization_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES elm.principals(id),operation text NOT NULL,object_id uuid,revision integer,metadata jsonb NOT NULL DEFAULT '{}',policy_version text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE elm.rate_buckets (organization_id uuid NOT NULL,principal_id uuid NOT NULL,operation text NOT NULL,bucket text NOT NULL,count integer NOT NULL CHECK(count>0),PRIMARY KEY(organization_id,principal_id,operation,bucket));
CREATE TABLE elm.review_sessions (token_hash text PRIMARY KEY,principal_id uuid REFERENCES elm.principals(id),organization_id uuid NOT NULL,csrf text NOT NULL,login_data jsonb,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE elm.retirement_events (id uuid PRIMARY KEY,organization_id uuid NOT NULL,learning_id uuid NOT NULL,action text NOT NULL CHECK(action IN('suspended','revoked','archived','purged')),created_at timestamptz NOT NULL DEFAULT now());

-- Owner-only policies are distinct from runtime policies, avoiding policy recursion in authorizer functions.
DO $$ DECLARE t text; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='elm' LOOP
  EXECUTE format('ALTER TABLE elm.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE elm.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY owner_all ON elm.%I TO elm_owner USING(true) WITH CHECK(true)',t);
 END LOOP;
END $$;
CREATE FUNCTION elm.actor() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('elm.principal_id',true),'')::uuid $$;
CREATE FUNCTION elm.org() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('elm.organization_id',true),'')::uuid $$;
CREATE FUNCTION elm.active_actor() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,elm AS $$ SELECT EXISTS(SELECT 1 FROM elm.principals WHERE id=elm.actor() AND organization_id=elm.org() AND active) $$;
CREATE FUNCTION elm.role_rank(role text) RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT CASE role WHEN 'reader' THEN 1 WHEN 'contributor' THEN 2 WHEN 'curator' THEN 3 ELSE 999 END $$;
CREATE FUNCTION elm.can_project(p uuid,needed text DEFAULT 'reader') RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,elm AS $$
 SELECT elm.active_actor() AND EXISTS(SELECT 1 FROM elm.project_memberships m JOIN elm.projects p ON p.id=m.project_id WHERE m.principal_id=elm.actor() AND p.id=$1 AND p.organization_id=elm.org() AND p.active AND elm.role_rank(m.role)>=elm.role_rank(needed)) $$;
CREATE FUNCTION elm.can_team(t uuid,needed text DEFAULT 'reader') RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,elm AS $$
 SELECT elm.active_actor() AND EXISTS(SELECT 1 FROM elm.team_memberships m JOIN elm.teams t ON t.id=m.team_id WHERE m.principal_id=elm.actor() AND t.id=$1 AND t.organization_id=elm.org() AND t.active AND elm.role_rank(m.role)>=elm.role_rank(needed)) $$;
CREATE FUNCTION elm.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,elm AS $$ SELECT EXISTS(SELECT 1 FROM elm.principals WHERE id=elm.actor() AND organization_id=elm.org() AND active AND membership_admin) $$;
CREATE FUNCTION elm.can_audience(kind text,audience uuid,needed text DEFAULT 'reader') RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT CASE kind WHEN 'project' THEN elm.can_project(audience,needed) WHEN 'team' THEN elm.can_team(audience,needed) ELSE false END $$;
CREATE FUNCTION elm.read_learning(l uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,elm AS $$ SELECT EXISTS(SELECT 1 FROM elm.learnings WHERE id=l AND organization_id=elm.org() AND state='active' AND valid_until>now() AND elm.can_audience(audience_kind,audience_id)) $$;
CREATE FUNCTION elm.curate_learning(l uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,elm AS $$ SELECT EXISTS(SELECT 1 FROM elm.learnings WHERE id=l AND organization_id=elm.org() AND elm.can_audience(audience_kind,audience_id,'curator')) $$;
CREATE FUNCTION elm.visible_proposal(p uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,elm AS $$ SELECT EXISTS(SELECT 1 FROM elm.proposals WHERE id=p AND organization_id=elm.org() AND ((author_id=elm.actor() AND elm.can_project(source_project_id,'contributor')) OR elm.can_project(source_project_id,'curator')) AND (target_team_id IS NULL OR elm.can_team(target_team_id,'curator'))) $$;
CREATE FUNCTION elm.resolve_identity(o uuid,i text,s text) RETURNS TABLE(id uuid,organization_id uuid,display_name text,membership_admin boolean,operator boolean) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,elm AS $$ SELECT id,organization_id,display_name,membership_admin,operator FROM elm.principals WHERE organization_id=o AND issuer=i AND subject=s AND active $$;
CREATE FUNCTION elm.current_principal() RETURNS TABLE(id uuid,organization_id uuid,display_name text,membership_admin boolean,operator boolean) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,elm AS $$ SELECT id,organization_id,display_name,membership_admin,operator FROM elm.principals WHERE organization_id=elm.org() AND id=elm.actor() AND active $$;
CREATE FUNCTION elm.project_context(selected uuid DEFAULT NULL) RETURNS TABLE(id uuid,name text,team_id uuid,role text,participation_mode text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,elm AS $$
 SELECT p.id,p.name,CASE WHEN elm.can_team(p.team_id) THEN p.team_id ELSE NULL END,m.role,coalesce(c.mode,'off') FROM elm.projects p JOIN elm.project_memberships m ON m.project_id=p.id AND m.principal_id=elm.actor() LEFT JOIN elm.participation c ON c.project_id=p.id AND c.principal_id=elm.actor() WHERE p.organization_id=elm.org() AND p.active AND elm.active_actor() AND ($1 IS NULL OR p.id=$1) ORDER BY p.name,p.id LIMIT 100 $$;
CREATE FUNCTION elm.lookup_repository(h text,p text) RETURNS TABLE(project_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,elm AS $$ SELECT project_id FROM elm.repository_aliases WHERE organization_id=elm.org() AND host=h AND path=p AND elm.can_project(project_id) $$;
CREATE FUNCTION elm.alias_in_project(a uuid,p uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,elm AS $$ SELECT EXISTS(SELECT 1 FROM elm.repository_aliases WHERE id=a AND project_id=p AND organization_id=elm.org() AND elm.can_project(p)) $$;
CREATE FUNCTION elm.proposal_allowed(p uuid,policy text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,elm AS $$ SELECT elm.can_project(p,'contributor') AND EXISTS(SELECT 1 FROM elm.participation WHERE project_id=p AND principal_id=elm.actor() AND organization_id=elm.org() AND mode IN('manual','auto') AND policy_version=policy) $$;
CREATE FUNCTION elm.serving(o uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,elm AS $$ SELECT coalesce((SELECT serving FROM elm.service_state WHERE organization_id=o),false) $$;

CREATE POLICY mcp_learning_read ON elm.learnings FOR SELECT TO elm_mcp USING(organization_id=elm.org() AND state='active' AND valid_until>now() AND elm.can_audience(audience_kind,audience_id));
CREATE POLICY review_learning_read ON elm.learnings FOR SELECT TO elm_review USING(organization_id=elm.org() AND (elm.read_learning(id) OR elm.curate_learning(id)));
CREATE POLICY review_learning_write ON elm.learnings FOR ALL TO elm_review USING(organization_id=elm.org() AND elm.can_audience(audience_kind,audience_id,'curator')) WITH CHECK(organization_id=elm.org() AND elm.can_audience(audience_kind,audience_id,'curator'));
CREATE POLICY mcp_revision_read ON elm.learning_revisions FOR SELECT TO elm_mcp USING(organization_id=elm.org() AND elm.read_learning(learning_id) AND revision=(SELECT current_revision FROM elm.learnings WHERE id=learning_id));
CREATE POLICY review_revision_read ON elm.learning_revisions FOR SELECT TO elm_review USING(organization_id=elm.org() AND (elm.curate_learning(learning_id) OR (elm.read_learning(learning_id) AND revision=(SELECT current_revision FROM elm.learnings WHERE id=learning_id))));
CREATE POLICY review_revision_insert ON elm.learning_revisions FOR INSERT TO elm_review WITH CHECK(organization_id=elm.org() AND elm.curate_learning(learning_id));
CREATE POLICY proposals_read ON elm.proposals FOR SELECT TO elm_mcp,elm_review USING(elm.visible_proposal(id));
CREATE POLICY mcp_proposals_insert ON elm.proposals FOR INSERT TO elm_mcp WITH CHECK(organization_id=elm.org() AND author_id=elm.actor() AND elm.proposal_allowed(source_project_id,'2026-09-22.1') AND target_team_id IS NULL AND derived_from IS NULL AND current_revision=1 AND status='pending_review');
CREATE POLICY review_proposals_insert ON elm.proposals FOR INSERT TO elm_review WITH CHECK(organization_id=elm.org() AND author_id=elm.actor() AND elm.proposal_allowed(source_project_id,'2026-09-22.1') AND (target_team_id IS NULL OR (elm.can_project(source_project_id,'curator') AND elm.can_team(target_team_id,'curator'))));
CREATE POLICY review_proposals_update ON elm.proposals FOR UPDATE TO elm_review USING(elm.visible_proposal(id)) WITH CHECK(elm.visible_proposal(id));
CREATE POLICY proposal_revisions_read ON elm.proposal_revisions FOR SELECT TO elm_mcp,elm_review USING(organization_id=elm.org() AND elm.visible_proposal(proposal_id));
CREATE POLICY proposal_revisions_insert ON elm.proposal_revisions FOR INSERT TO elm_mcp,elm_review WITH CHECK(organization_id=elm.org() AND EXISTS(SELECT 1 FROM elm.proposals WHERE id=proposal_id AND author_id=elm.actor() AND status IN('pending_review','changes_requested') AND current_revision=revision));
CREATE POLICY lineage_review ON elm.lineage TO elm_review USING(organization_id=elm.org() AND elm.can_project(source_project_id,'curator') AND elm.curate_learning(learning_id)) WITH CHECK(organization_id=elm.org() AND elm.can_project(source_project_id,'curator') AND elm.curate_learning(learning_id));
CREATE POLICY conflicts_read ON elm.learning_conflicts FOR SELECT TO elm_mcp,elm_review USING(organization_id=elm.org() AND elm.read_learning(left_id) AND elm.read_learning(right_id));
CREATE POLICY conflicts_write ON elm.learning_conflicts FOR INSERT TO elm_review WITH CHECK(organization_id=elm.org() AND elm.curate_learning(left_id) AND elm.curate_learning(right_id));
CREATE POLICY review_decisions_read ON elm.review_decisions FOR SELECT TO elm_review USING(organization_id=elm.org() AND elm.visible_proposal(proposal_id));
CREATE POLICY review_decisions_insert ON elm.review_decisions FOR INSERT TO elm_review WITH CHECK(organization_id=elm.org() AND reviewer_id=elm.actor() AND EXISTS(SELECT 1 FROM elm.proposals WHERE id=proposal_id AND author_id<>elm.actor() AND elm.can_project(source_project_id,'curator') AND (target_team_id IS NULL OR elm.can_team(target_team_id,'curator'))));
CREATE POLICY own_receipts ON elm.delivery_receipts TO elm_mcp,elm_review USING(organization_id=elm.org() AND principal_id=elm.actor() AND elm.active_actor()) WITH CHECK(organization_id=elm.org() AND principal_id=elm.actor() AND elm.read_learning(learning_id));
CREATE POLICY own_feedback_read ON elm.feedback FOR SELECT TO elm_mcp,elm_review USING(organization_id=elm.org() AND ((principal_id=elm.actor() AND elm.read_learning(learning_id)) OR elm.curate_learning(learning_id)));
CREATE POLICY feedback_insert ON elm.feedback FOR INSERT TO elm_mcp,elm_review WITH CHECK(organization_id=elm.org() AND principal_id=elm.actor() AND elm.read_learning(learning_id));
CREATE POLICY own_idempotency ON elm.idempotency_records TO elm_mcp,elm_review USING(organization_id=elm.org() AND principal_id=elm.actor() AND elm.active_actor()) WITH CHECK(organization_id=elm.org() AND principal_id=elm.actor() AND elm.active_actor());
CREATE POLICY audit_insert ON elm.audit_events FOR INSERT TO elm_mcp,elm_review WITH CHECK(organization_id=elm.org() AND actor_id=elm.actor() AND elm.active_actor());
CREATE POLICY audit_review_read ON elm.audit_events FOR SELECT TO elm_review USING(organization_id=elm.org() AND (actor_id=elm.actor() OR elm.is_admin()));
CREATE POLICY own_rate ON elm.rate_buckets TO elm_mcp,elm_review USING(organization_id=elm.org() AND principal_id=elm.actor() AND elm.active_actor()) WITH CHECK(organization_id=elm.org() AND principal_id=elm.actor() AND elm.active_actor());
CREATE POLICY own_participation ON elm.participation TO elm_review USING(organization_id=elm.org() AND principal_id=elm.actor() AND elm.can_project(project_id,'contributor')) WITH CHECK(organization_id=elm.org() AND principal_id=elm.actor() AND elm.can_project(project_id,'contributor'));
CREATE POLICY review_sessions_access ON elm.review_sessions TO elm_review USING(true) WITH CHECK(true);
CREATE POLICY retire_insert ON elm.retirement_events FOR INSERT TO elm_review WITH CHECK(organization_id=elm.org() AND elm.curate_learning(learning_id));

GRANT SELECT ON elm.learnings,elm.learning_revisions,elm.learning_conflicts TO elm_mcp,elm_review;
GRANT SELECT,INSERT ON elm.proposals,elm.proposal_revisions,elm.feedback,elm.delivery_receipts,elm.idempotency_records TO elm_mcp,elm_review;
GRANT INSERT ON elm.audit_events TO elm_mcp,elm_review;
GRANT SELECT,INSERT,UPDATE ON elm.rate_buckets TO elm_mcp,elm_review;
GRANT INSERT,UPDATE ON elm.learnings TO elm_review;
GRANT INSERT ON elm.learning_revisions,elm.learning_conflicts,elm.retirement_events TO elm_review;
GRANT UPDATE ON elm.proposals TO elm_review;
GRANT SELECT,INSERT ON elm.review_decisions,elm.lineage TO elm_review;
GRANT SELECT ON elm.audit_events TO elm_review;
GRANT SELECT,INSERT,UPDATE ON elm.participation TO elm_review;
GRANT SELECT,INSERT,UPDATE,DELETE ON elm.review_sessions TO elm_review;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA elm TO elm_mcp,elm_review;
-- Security definer helpers use an owner-only policy. Runtime roles never inherit this role.
CREATE FUNCTION elm.immutable_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF current_user NOT IN('elm_owner','elm_maintenance') THEN RAISE EXCEPTION 'immutable revision'; END IF; RETURN OLD; END $$;
CREATE TRIGGER learning_revision_immutable BEFORE UPDATE OR DELETE ON elm.learning_revisions FOR EACH ROW EXECUTE FUNCTION elm.immutable_revision();
CREATE TRIGGER proposal_revision_immutable BEFORE UPDATE OR DELETE ON elm.proposal_revisions FOR EACH ROW EXECUTE FUNCTION elm.immutable_revision();
CREATE TRIGGER review_decision_immutable BEFORE UPDATE OR DELETE ON elm.review_decisions FOR EACH ROW EXECUTE FUNCTION elm.immutable_revision();
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON elm.audit_events FOR EACH ROW EXECUTE FUNCTION elm.immutable_revision();
RESET ROLE;
