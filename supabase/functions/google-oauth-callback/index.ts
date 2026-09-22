import { finishGoogleOAuth } from "../_shared/google-oauth.ts";

export const handler = (req: Request) => finishGoogleOAuth(req, "calendar");
Deno.serve(handler);
