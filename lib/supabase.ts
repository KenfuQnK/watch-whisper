import { createClient } from '@supabase/supabase-js';

// Tu Project ID: ulrbgmuqqenpauejbkcj
const SUPABASE_URL = 'https://ulrbgmuqqenpauejbkcj.supabase.co';

// ⚠️ IMPORTANTE: FALTA TU CLAVE PÚBLICA (ANON KEY)
// 1. Ve a https://supabase.com/dashboard/project/ulrbgmuqqenpauejbkcj/settings/api
// 2. Copia la clave "anon" "public"
// 3. Pégala abajo entre las comillas
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVscmJnbXVxcWVucGF1ZWpia2NqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU1OTQzMTcsImV4cCI6MjA4MTE3MDMxN30.gi_soxnLdgTa-qTc1XoGcVP0Y1kNEumCqEQ0txQW66s';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);