import { createClient } from "@supabase/supabase-js";


const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    "Missing Supabase env vars. Create a .env file with VITE_SUPABASE_URL and " +
    "VITE_SUPABASE_ANON_KEY — see supabase/schema.sql and MIGRATION.md."
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
