import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Subject from 'virtual:subject';
import '@/index.css';
const queryClient = new QueryClient({defaultOptions:{queries:{retry:false}}});
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}><Subject/></QueryClientProvider>
);
