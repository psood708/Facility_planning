// Public client configuration — safe to ship to browsers. Only the project
// URL and the anon/publishable key belong here; access is enforced by row
// level security in the database. NEVER put the server-side secret key
// here. These defaults point at the local stack (npx supabase start); the
// deploy writes production values (see T11).
window.APP_CONFIG = Object.freeze({
  supabaseUrl: "http://127.0.0.1:54321",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
});
