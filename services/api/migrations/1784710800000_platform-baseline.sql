-- Platform baseline: PostGIS, least-privilege roles, and module schema ownership.
--
-- This migration creates no domain tables. It establishes the invariants every
-- later migration depends on: the spatial extension at the pinned version, a
-- migration role that owns DDL, an application role that may only read and write
-- rows, and one schema per owning module.
--
-- Source: architecture/data-and-geospatial-design.md, section "3. Schema Ownership";
--         ADR-0009, "Toolchain and Platform Version Baseline";
--         ADR-0010, "Coordinate space registration".

-- Up Migration

-- The version is requested explicitly rather than left to
-- `CREATE EXTENSION IF NOT EXISTS postgis` picking whatever a platform
-- currently treats as default. Confirmed directly against both target
-- platforms while writing this migration: Cloud SQL for PostgreSQL 17
-- defaults to PostGIS 3.6.0 and only installs 3.5.2 when asked for it by
-- name, while the postgis/postgis:17-3.5 image used by the Testcontainers
-- suite already defaults to 3.5.2. Requesting '3.5.2' by name makes a fresh
-- environment deterministic on both instead of depending on Cloud SQL's
-- current default staying 3.6.0 forever, which the version-assertion block
-- below would only ever catch after the fact.
CREATE EXTENSION IF NOT EXISTS postgis VERSION '3.5.2';

-- The geometry semantics of the whole product are pinned to a PostGIS major and
-- minor version. A silent upgrade would change spatial predicate behavior under
-- an unchanged application, so it must stop the deployment instead.
DO $$
DECLARE
  installed_version text;
BEGIN
  SELECT extversion INTO installed_version FROM pg_extension WHERE extname = 'postgis';

  IF installed_version IS NULL THEN
    RAISE EXCEPTION 'PostGIS is not installed.';
  END IF;

  IF split_part(installed_version, '.', 1) <> '3' OR split_part(installed_version, '.', 2) <> '5' THEN
    RAISE EXCEPTION 'PostGIS 3.5 is required (ADR-0009); found version %.', installed_version;
  END IF;
END
$$;

-- Roles are group roles without LOGIN. Concrete login identities — the Cloud SQL
-- IAM service accounts of the deployment pipeline and of the running service —
-- are granted membership by infrastructure, so credentials never live here.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'verdery_migration') THEN
    CREATE ROLE verdery_migration NOLOGIN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'verdery_application') THEN
    CREATE ROLE verdery_application NOLOGIN;
  END IF;
END
$$;

-- `ALTER DEFAULT PRIVILEGES FOR ROLE` requires membership in that role. A
-- superuser has it implicitly; a least-privilege deployment identity does not.
DO $$
BEGIN
  IF NOT pg_has_role(current_user, 'verdery_migration', 'MEMBER') THEN
    EXECUTE format('GRANT verdery_migration TO %I', current_user);
  END IF;
END
$$;

-- Nothing may create objects in `public`; it exists only to host the extension
-- and the migration tracking table below.
--
-- verdery_migration keeps CREATE here as a narrow, deliberate exception, not an
-- oversight: node-pg-migrate needs to create and write its own history table
-- before it can run any migration file, including this one, so that table has
-- nowhere else to live on a database this young. `PUBLIC` — the pseudo-role
-- meaning "everyone" — still gets nothing. Confirmed necessary by running this
-- migration through the actual least-privilege Cloud SQL IAM identity: without
-- this grant it fails with "permission denied for schema public" the moment
-- node-pg-migrate's own `CREATE TABLE IF NOT EXISTS pgmigrations` runs, even
-- though the migration it is about to record has nothing left to do.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO verdery_migration, verdery_application;
GRANT CREATE ON SCHEMA public TO verdery_migration;

-- One schema per owning module. A module reaches another module's data only
-- through an approved view, query port, or documented transaction use case, and
-- the schema boundary makes an accidental cross-module join visible in review.
DO $$
DECLARE
  module_schema text;
  module_schemas text[] := ARRAY[
    'identity_access',
    'collaboration',
    'gardens_mapping',
    'plants_inventory',
    'observations_history',
    'tasks_recommendations',
    'media',
    'capture_import',
    'platform'
  ];
BEGIN
  FOREACH module_schema IN ARRAY module_schemas LOOP
    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I AUTHORIZATION verdery_migration', module_schema);

    -- The application role may use the schema but never create in it: schema
    -- changes are a reviewed release step, not something a request can perform.
    EXECUTE format('REVOKE ALL ON SCHEMA %I FROM PUBLIC', module_schema);
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO verdery_application', module_schema);

    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE verdery_migration IN SCHEMA %I '
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO verdery_application',
      module_schema
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE verdery_migration IN SCHEMA %I '
      'GRANT USAGE, SELECT ON SEQUENCES TO verdery_application',
      module_schema
    );
  END LOOP;
END
$$;

-- Down Migration

DO $$
DECLARE
  module_schema text;
  roles_exist boolean;
  module_schemas text[] := ARRAY[
    'identity_access',
    'collaboration',
    'gardens_mapping',
    'plants_inventory',
    'observations_history',
    'tasks_recommendations',
    'media',
    'capture_import',
    'platform'
  ];
BEGIN
  SELECT count(*) = 2 INTO roles_exist
    FROM pg_roles
   WHERE rolname IN ('verdery_migration', 'verdery_application');

  FOREACH module_schema IN ARRAY module_schemas LOOP
    -- Default privileges reference both roles by name, so they can only be
    -- released while both still exist.
    IF roles_exist THEN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE verdery_migration IN SCHEMA %I '
        'REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM verdery_application',
        module_schema
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE verdery_migration IN SCHEMA %I '
        'REVOKE USAGE, SELECT ON SEQUENCES FROM verdery_application',
        module_schema
      );
    END IF;

    EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', module_schema);
  END LOOP;
END
$$;

-- Remaining grants must be released before a role can be dropped.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'verdery_application') THEN
    EXECUTE 'DROP OWNED BY verdery_application CASCADE';
    EXECUTE 'DROP ROLE verdery_application';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'verdery_migration') THEN
    EXECUTE 'DROP OWNED BY verdery_migration CASCADE';
    EXECUTE 'DROP ROLE verdery_migration';
  END IF;
END
$$;

-- PostGIS is deliberately left installed.
--
-- The pinned image postgis/postgis:17-3.5 preinstalls postgis_topology and
-- postgis_tiger_geocoder, both of which depend on postgis. `DROP EXTENSION
-- postgis` therefore aborts, and because node-pg-migrate wraps a migration in a
-- single transaction, that failure rolls back the whole down migration and
-- leaves the roles behind — the opposite of what rolling back is for.
--
-- Adding CASCADE would silently drop those two extensions and every dependent
-- object, which is worse: an extension this migration did not create is not
-- this migration's to remove. Reversing the schema does not require reversing
-- the availability of a spatial type system.
--
-- Source: architecture/environments-and-delivery.md, section "12. Database
-- Migrations" — a rollback must be safe to run, not merely symmetrical.
