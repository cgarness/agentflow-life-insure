import { createRoot } from 'react-dom/client';
import UnderwritingPage from './UnderwritingPage';
export function startUnderwriting(root:HTMLElement):void {
  createRoot(root).render(<UnderwritingPage />);
}
