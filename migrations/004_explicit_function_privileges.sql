-- PostgreSQL grants EXECUTE on new functions to PUBLIC globally. A per-schema
-- REVOKE cannot remove that global default. Fix both existing and future helpers.
SET ROLE elm_owner;
ALTER DEFAULT PRIVILEGES FOR ROLE elm_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA elm FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION elm.registry_snapshot(),elm.registry_change(text,jsonb),elm.suspend_dependents(uuid) FROM elm_mcp;
REVOKE EXECUTE ON FUNCTION elm.apply_retirements(uuid,jsonb),elm.retirement_manifest(uuid),elm.set_serving(uuid,boolean),elm.retention(uuid,integer,integer,integer) FROM elm_mcp,elm_review;
GRANT EXECUTE ON FUNCTION elm.registry_snapshot(),elm.registry_change(text,jsonb),elm.suspend_dependents(uuid) TO elm_review;
GRANT EXECUTE ON FUNCTION elm.apply_retirements(uuid,jsonb),elm.retirement_manifest(uuid),elm.set_serving(uuid,boolean),elm.retention(uuid,integer,integer,integer) TO elm_maintenance;
RESET ROLE;
