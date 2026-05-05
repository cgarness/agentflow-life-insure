-- Grant anon and authenticated roles permission to execute the invitation lookup RPC.
-- This is required because invited users have no session when they click the email link.
GRANT EXECUTE ON FUNCTION public.get_invitation_by_token_rpc(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.get_invitation_by_token_rpc(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
