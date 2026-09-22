import { finishGoogleOAuth } from "../_shared/google-oauth.ts";

export const handler = (req: Request) => finishGoogleOAuth(req, "email");
Deno.serve(handler);
