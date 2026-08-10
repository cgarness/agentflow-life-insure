-- Allow authenticated users to insert clients for their own organization
CREATE POLICY "Users can insert clients in their organization"
ON clients
FOR INSERT
TO authenticated
WITH CHECK (
  organization_id = (
    SELECT organization_id FROM profiles WHERE id = auth.uid()
  )
);
-- Also verify select, update, delete policies exist and are correct
-- If any of the following policies are missing, create them:
-- SELECT
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'clients' AND cmd = 'SELECT'
  ) THEN
    CREATE POLICY "Users can view clients in their organization"
    ON clients FOR SELECT TO authenticated
    USING (
      organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
    );
  END IF;
END $$;
-- UPDATE
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'clients' AND cmd = 'UPDATE'
  ) THEN
    CREATE POLICY "Users can update clients in their organization"
    ON clients FOR UPDATE TO authenticated
    USING (
      organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
    )
    WITH CHECK (
      organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
    );
  END IF;
END $$;
-- DELETE
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'clients' AND cmd = 'DELETE'
  ) THEN
    CREATE POLICY "Users can delete clients in their organization"
    ON clients FOR DELETE TO authenticated
    USING (
      organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
    );
  END IF;
END $$;
