import './index.css';
import { isUnderwritingPath } from './underwriting/routing';

// Keep the public tool outside the CRM module graph and its provider side effects.
// Full-document navigation into the CRM is deliberate; do not mount both applications.
const root = document.getElementById('root');
if (!root) throw new Error('Application root is missing');

async function start(): Promise<void> {
  if (isUnderwritingPath(window.location.pathname)) {
    const { startUnderwriting } = await import('./underwriting/bootstrap');
    startUnderwriting(root!);
  } else {
    const [{ createRoot }, { default: App }] = await Promise.all([
      import('react-dom/client'), import('./App.tsx'),
    ]);
    createRoot(root!).render(<App />);
  }
}
void start().catch(() => {
  // No client input or exception payload is logged.
  root.replaceChildren();
  const message = document.createElement('p');
  message.textContent = 'The application could not load. Please reload this page.';
  root.append(message);
});
