import { createClient } from "@supabase/supabase-js";

// These are public browser credentials by design. A Supabase publishable key
// is safe to ship to the client when Row Level Security protects user data.
// Environment variables take precedence; the project-specific public values
// below keep the app functional on Cloudflare when only Worker vars are set
// and Next.js build-time variables were not injected.
const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://emcspruiboxkixcyokka.supabase.co";

const publishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "sb_publishable_A-5jkGNT9OaPVSqPvqi_5A_iIoWfLB7";

export const isSupabaseConfigured = Boolean(url && publishableKey);

export const supabase = isSupabaseConfigured
  ? createClient(url, publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
