import { createClient } from "@supabase/supabase-js";

// Create a free project at https://supabase.com, run supabase/schema.sql
// in its SQL editor, then paste the two values below (Project Settings -> API).
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Fails loudly at startup instead of silently breaking every query later.
  console.error(
    "Missing Supabase env vars. Create a .env file with VITE_SUPABASE_URL and " +
    "VITE_SUPABASE_ANON_KEY — see supabase/schema.sql and MIGRATION.md."
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
