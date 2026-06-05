import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SUPABASE_URL = "https://psvdtgjvognbmxfvqbaa.supabase.co";
export const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzdmR0Z2p2b2duYm14ZnZxYmFhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwMzAwMTQsImV4cCI6MjA4NzYwNjAxNH0.zEBcFOT8u9BViQ1YVMm-QYsPKy1TZCKU2nJXqJR1Em0";
export const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
export const PIPE_ID = "306833898";
