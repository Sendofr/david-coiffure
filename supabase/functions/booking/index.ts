import { createBookingHandler } from './handler.mjs';

// Only the function's private runtime reads these values. The service-role key
// is platform-injected and must never be included in browser build variables.
const handler = createBookingHandler({
  env: {
    SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    TURNSTILE_SECRET_KEY: Deno.env.get('TURNSTILE_SECRET_KEY'),
    BOOKING_RATE_SECRET: Deno.env.get('BOOKING_RATE_SECRET'),
    BOOKING_ALLOWED_ORIGINS: Deno.env.get('BOOKING_ALLOWED_ORIGINS'),
  },
});

Deno.serve(handler);
