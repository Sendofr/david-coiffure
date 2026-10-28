-- Historical entry point, replaced by versioned migrations.
-- New projects: supabase db reset (LOCAL ONLY) applies all supabase/migrations.
-- Existing projects: see docs/SECURITY.md before applying migrations after backup.
-- Never run `db reset --linked` against a live salon database.
-- No schema is applied from this file; this explicit error prevents partial setup.
do $$ begin
 raise exception 'Use versioned supabase/migrations in order; see docs/SECURITY.md. No changes applied.';
end $$;
