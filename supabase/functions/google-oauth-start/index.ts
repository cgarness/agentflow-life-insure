import { startGoogleOAuth } from "../_shared/google-oauth.ts";

export const handler = (req: Request) => startGoogleOAuth(req, "calendar");
Deno.serve(handler);
