import { createClient } from '@supabase/supabase-js';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  throw new Error('Faltan variables SUPABASE_URL y/o SUPABASE_ANON_KEY en el .env');
}

// Cliente público (usa anon key + RLS para lectura)
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);
