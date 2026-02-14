import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://hsiqzmbfulmfxbvbsdwz.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhzaXF6bWJmdWxtZnhidmJzZHd6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5MTQ5NjYsImV4cCI6MjA4NjQ5MDk2Nn0.Il9Qgv06SoHhKaXNw5FESukqtb-7eQotp9XtDwZ_5uI';
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const CHAT_ENDPOINT = SUPABASE_URL + '/functions/v1/chat';
