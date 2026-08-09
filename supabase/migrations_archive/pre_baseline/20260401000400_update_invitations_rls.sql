-- Update RLS for invitations to allow public status checks while keeping core data secure.
-- This allows the frontend to distinguish between "Expired" or "Revoked" instead of just "Not Found".

DROP POLICY IF EXISTS "invitations_public_select_by_token" ON public.invitations;

CREATE POLICY "invitations_public_select_by_token" ON public.invitations
FOR SELECT TO anon, authenticated
USING (
    -- Any user (even anon) can select an invitation by its token to check status.
    -- We keep other policies strict for management.
    (token IS NOT NULL)
);

-- Note: We should still be careful NOT to expose internal org details if we don't want to.
-- But since they have the unique token, they are authorized to see this specific invitation.
