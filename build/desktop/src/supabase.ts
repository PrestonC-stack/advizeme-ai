import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export const getSupabaseClient = () => {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  if (!client) {
    client = createClient(url, anonKey, {
      auth: {
        persistSession: false
      }
    });
  }

  return client;
};

export const hasSupabaseConfig = () =>
  Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

export const sourceMap: Record<string, "Tekmetric" | "AutoFlow" | "AutoTextMe" | "Trello" | "Manual"> = {
  TEKMETRIC: "Tekmetric",
  AUTOFLOW: "AutoFlow",
  AUTOTEXTME: "AutoTextMe",
  TRELLO: "Trello",
  MANUAL: "Manual"
};

export const locationCodeMap: Record<"Country Club" | "Apache", string> = {
  "Country Club": "COUNTRY_CLUB",
  Apache: "APACHE"
};
