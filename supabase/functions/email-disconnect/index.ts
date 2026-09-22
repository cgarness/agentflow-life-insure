import { disconnectGoogleOAuth } from "../_shared/google-oauth.ts";

export const handler = (req: Request) => disconnectGoogleOAuth(req, "email");
Deno.serve(handler);
