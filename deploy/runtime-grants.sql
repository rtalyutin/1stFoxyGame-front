-- Apply as the migration owner in this application's schema AFTER creating the
-- LOGIN role foxy_runtime with an operator-supplied password. Never put that
-- password or owner DATABASE_URL into this file or the application container.
-- Provision/password rotation run with the migration owner, never this role.
BEGIN;
DO $$
DECLARE trusted_schema text := current_schema();
BEGIN
 IF trusted_schema IS NULL OR trusted_schema IN ('pg_catalog','information_schema') OR trusted_schema LIKE 'pg_temp%' THEN
  RAISE EXCEPTION 'Select the trusted application schema before applying runtime grants';
 END IF;
 EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I',trusted_schema,'foxy_runtime');
END $$;
GRANT SELECT ON applied_migrations,entity_types,entity_parameters,entities,entity_parameter_values TO foxy_runtime;
GRANT INSERT,UPDATE ON entities TO foxy_runtime;
GRANT INSERT,UPDATE,DELETE ON entity_parameter_values TO foxy_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON profile_sessions,profile_operations,profile_runs TO foxy_runtime;
-- The constructor uses SELECT FOR UPDATE to serialize type mutations. Only
-- immutable identity may be named by UPDATE; its trigger forbids changing it.
GRANT UPDATE(id) ON entity_types TO foxy_runtime;
GRANT EXECUTE ON FUNCTION constructor_lock(),constructor_validate(),constructor_validate_object(uuid),profile_validate_ownership(),economy_validate_money() TO foxy_runtime;
GRANT EXECUTE ON FUNCTION balance_protect_history(),balance_validate_pin(),balance_number(uuid,text),balance_validate_revision() TO foxy_runtime;
GRANT EXECUTE ON FUNCTION forge_fence_writer(),forge_validate_balance(),forge_protect_metadata() TO foxy_runtime;
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_parameter_values ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS r34_entities_read ON entities;
DROP POLICY IF EXISTS r34_entities_insert ON entities;
DROP POLICY IF EXISTS r34_entities_update ON entities;
DROP POLICY IF EXISTS r34_values_read ON entity_parameter_values;
DROP POLICY IF EXISTS r34_values_insert ON entity_parameter_values;
DROP POLICY IF EXISTS r34_values_update ON entity_parameter_values;
DROP POLICY IF EXISTS r34_values_delete ON entity_parameter_values;
CREATE POLICY r34_entities_read ON entities FOR SELECT TO foxy_runtime USING(true);
CREATE POLICY r34_entities_insert ON entities FOR INSERT TO foxy_runtime WITH CHECK(entity_type_id IN (
 'ca5f0000-0000-5000-a000-000000000001','ca5d0000-0000-5000-a000-000000000002','ca5d0000-0000-5000-a000-000000000003','ca5d0000-0000-5000-a000-000000000004','ca5b0000-0000-5000-a000-000000000002','ca5b0000-0000-5000-a000-000000000003'));
CREATE POLICY r34_entities_update ON entities FOR UPDATE TO foxy_runtime USING(entity_type_id IN (
 'ca5f0000-0000-5000-a000-000000000001','ca5d0000-0000-5000-a000-000000000002','ca5d0000-0000-5000-a000-000000000003','ca5d0000-0000-5000-a000-000000000004','ca5b0000-0000-5000-a000-000000000002','ca5b0000-0000-5000-a000-000000000003')) WITH CHECK(entity_type_id IN (
 'ca5f0000-0000-5000-a000-000000000001','ca5d0000-0000-5000-a000-000000000002','ca5d0000-0000-5000-a000-000000000003','ca5d0000-0000-5000-a000-000000000004','ca5b0000-0000-5000-a000-000000000002','ca5b0000-0000-5000-a000-000000000003'));
CREATE POLICY r34_values_read ON entity_parameter_values FOR SELECT TO foxy_runtime USING(true);
CREATE POLICY r34_values_insert ON entity_parameter_values FOR INSERT TO foxy_runtime WITH CHECK(entity_type_id IN (
 'ca5f0000-0000-5000-a000-000000000001','ca5d0000-0000-5000-a000-000000000002','ca5d0000-0000-5000-a000-000000000003','ca5d0000-0000-5000-a000-000000000004','ca5b0000-0000-5000-a000-000000000002','ca5b0000-0000-5000-a000-000000000003'));
CREATE POLICY r34_values_update ON entity_parameter_values FOR UPDATE TO foxy_runtime USING(entity_type_id IN (
 'ca5f0000-0000-5000-a000-000000000001','ca5d0000-0000-5000-a000-000000000002','ca5d0000-0000-5000-a000-000000000003','ca5d0000-0000-5000-a000-000000000004','ca5b0000-0000-5000-a000-000000000002','ca5b0000-0000-5000-a000-000000000003')) WITH CHECK(entity_type_id IN (
 'ca5f0000-0000-5000-a000-000000000001','ca5d0000-0000-5000-a000-000000000002','ca5d0000-0000-5000-a000-000000000003','ca5d0000-0000-5000-a000-000000000004','ca5b0000-0000-5000-a000-000000000002','ca5b0000-0000-5000-a000-000000000003'));
CREATE POLICY r34_values_delete ON entity_parameter_values FOR DELETE TO foxy_runtime USING(entity_type_id IN (
 'ca5f0000-0000-5000-a000-000000000001','ca5d0000-0000-5000-a000-000000000002','ca5d0000-0000-5000-a000-000000000003','ca5d0000-0000-5000-a000-000000000004','ca5b0000-0000-5000-a000-000000000002','ca5b0000-0000-5000-a000-000000000003'));
COMMIT;
