import { createClient } from '@supabase/supabase-js';

// Reads from the Bazinga Supabase project. RLS on `projects` allows
// anonymous reads (college IS NULL fallback), so no login needed here.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? 'https://umiqvigdibyvieslahcb.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtaXF2aWdkaWJ5dmllc2xhaGNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcwNzg4NTgsImV4cCI6MjA3MjY1NDg1OH0.vVMDK6NOzXeRIlZ8TPGVOH0H4OxH3xLuSUGaHWHw9NM';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const ANON_KEY = SUPABASE_ANON_KEY;

export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
