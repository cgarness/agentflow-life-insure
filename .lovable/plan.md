

## Plan: Add Dev-Only Auth Bypass via Query Parameter

**What**: Allow bypassing authentication in development by adding `?bypass_auth=true` to the URL. This lets the browser automation tool access protected routes without logging in.

**How**: Modify the `ProtectedRoute` component in `src/App.tsx` (lines 36-45) to check for the `bypass_auth=true` query parameter. The bypass will only work in development mode (`import.meta.env.DEV`).

```typescript
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  const searchParams = new URLSearchParams(window.location.search);
  const bypassAuth = import.meta.env.DEV && searchParams.get('bypass_auth') === 'true';
  
  if (bypassAuth) return <>{children}</>;
  if (isLoading) return (/* spinner */);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
};
```

**Safety**: `import.meta.env.DEV` is `false` in production builds, so the bypass is completely stripped out. No security risk in deployed builds.

**Usage**: When asking me to test, I'll navigate to e.g. `/settings?bypass_auth=true`.

**Note**: Profile-dependent features (user name, avatar, etc.) will show empty/null since there's no actual session. But it's sufficient for testing UI and OAuth flows.

