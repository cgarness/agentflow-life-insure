// Node test adapter; production keeps Deno's server implementation.
export const serve = (handler: (req: Request) => Promise<Response>) => Deno.serve(handler);
