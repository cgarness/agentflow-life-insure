import { disconnectGoogleOAuth } from "../_shared/google-oauth.ts";

export const handler = (req: Request) => disconnectGoogleOAuth(req, "calendar");
Deno.serve(handler);
