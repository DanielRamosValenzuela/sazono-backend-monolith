-- Disable RLS on Prisma's internal migration table so Prisma can manage schema history.
ALTER TABLE public."_prisma_migrations" DISABLE ROW LEVEL SECURITY;

-- Enable RLS on every business table in the public schema.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;',
      r.tablename
    );
  END LOOP;
END
$$;
