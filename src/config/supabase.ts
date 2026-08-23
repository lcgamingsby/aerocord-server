import 'dotenv/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

// Polyfill global WebSocket for Node.js environments (< Node 22)
if (typeof (global as any).WebSocket === 'undefined') {
  (global as any).WebSocket = WebSocket;
}

const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service-key';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    '\n⚠️  [SUPABASE NOTICE] SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY belum diisi di file server/.env!\n' +
    '👉 Silakan salin server/.env.example ke server/.env dan masukkan API Key Supabase Anda.\n'
  );
}

/**
 * Supabase Admin Client (Service Role — bypasses RLS, server-side only)
 * Never expose the service role key to the client!
 */
export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  },
  // Provide WebSocket implementation to support all Node versions on Railway/Render/Docker
  realtime: {
    transport: WebSocket as any
  }
});

export const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'aerocord-uploads';
