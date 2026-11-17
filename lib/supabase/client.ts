import { supabase } from "@/lib/supabaseClient";

export { supabase };

export function createClient() {
  return supabase;
}

export const createSupabaseClient = createClient;
