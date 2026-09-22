-- Resolve membership sets once per statement, not thousands of nested lookups.
-- These functions remain bound to transaction-local identity and active account.
SET ROLE elm_owner;
CREATE FUNCTION elm.actor_project_ids(minimum_role text DEFAULT 'reader') RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,elm AS $$
 SELECT p.id FROM elm.projects p JOIN elm.project_memberships m ON m.project_id=p.id
 WHERE p.organization_id=elm.org() AND p.active AND m.principal_id=elm.actor() AND elm.active_actor()
 AND minimum_role IN('reader','contributor','curator')
 AND (minimum_role='reader' OR m.role='curator' OR (minimum_role='contributor' AND m.role='contributor')) $$;
CREATE FUNCTION elm.actor_team_ids(minimum_role text DEFAULT 'reader') RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,elm AS $$
 SELECT t.id FROM elm.teams t JOIN elm.team_memberships m ON m.team_id=t.id
 WHERE t.organization_id=elm.org() AND t.active AND m.principal_id=elm.actor() AND elm.active_actor()
 AND minimum_role IN('reader','contributor','curator')
 AND (minimum_role='reader' OR m.role='curator' OR (minimum_role='contributor' AND m.role='contributor')) $$;
GRANT EXECUTE ON FUNCTION elm.actor_project_ids(text),elm.actor_team_ids(text) TO elm_mcp,elm_review;
DROP POLICY mcp_learning_read ON elm.learnings;
CREATE POLICY mcp_learning_read ON elm.learnings FOR SELECT TO elm_mcp USING(
 organization_id=(SELECT elm.org()) AND state='active' AND valid_until>now()
 AND ((audience_kind='project' AND audience_id IN(SELECT elm.actor_project_ids('reader')))
 OR (audience_kind='team' AND audience_id IN(SELECT elm.actor_team_ids('reader')))));
-- Review readers still see only live knowledge; curators may inspect retired items.
DROP POLICY review_learning_write ON elm.learnings;
CREATE POLICY review_learning_insert ON elm.learnings FOR INSERT TO elm_review WITH CHECK(organization_id=(SELECT elm.org()) AND elm.can_audience(audience_kind,audience_id,'curator'));
CREATE POLICY review_learning_update ON elm.learnings FOR UPDATE TO elm_review USING(organization_id=(SELECT elm.org()) AND elm.can_audience(audience_kind,audience_id,'curator')) WITH CHECK(organization_id=(SELECT elm.org()) AND elm.can_audience(audience_kind,audience_id,'curator'));
DROP POLICY review_learning_read ON elm.learnings;
CREATE POLICY review_learning_read ON elm.learnings FOR SELECT TO elm_review USING(
 organization_id=(SELECT elm.org()) AND (
 ((state='active' AND valid_until>now()) AND ((audience_kind='project' AND audience_id IN(SELECT elm.actor_project_ids('reader'))) OR (audience_kind='team' AND audience_id IN(SELECT elm.actor_team_ids('reader')))))
 OR (audience_kind='project' AND audience_id IN(SELECT elm.actor_project_ids('curator')))
 OR (audience_kind='team' AND audience_id IN(SELECT elm.actor_team_ids('curator')))));
DROP POLICY mcp_revision_read ON elm.learning_revisions;
CREATE POLICY mcp_revision_read ON elm.learning_revisions FOR SELECT TO elm_mcp USING(
 organization_id=(SELECT elm.org()) AND (learning_id,revision) IN(SELECT id,current_revision FROM elm.learnings));
DROP POLICY review_revision_read ON elm.learning_revisions;
CREATE POLICY review_revision_read ON elm.learning_revisions FOR SELECT TO elm_review USING(
 organization_id=(SELECT elm.org()) AND ((learning_id,revision) IN(SELECT id,current_revision FROM elm.learnings WHERE state='active' AND valid_until>now())
 OR learning_id IN(SELECT id FROM elm.learnings WHERE (audience_kind='project' AND audience_id IN(SELECT elm.actor_project_ids('curator'))) OR (audience_kind='team' AND audience_id IN(SELECT elm.actor_team_ids('curator'))))));
RESET ROLE;
