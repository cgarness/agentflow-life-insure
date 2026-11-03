// Synthetic harness only: Vite aliases the Supabase client and Voice SDK. Never imported by the app.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {RoomWorkspace} from '../../../../src/components/inbounds/RoomWorkspace';
import '../../../../src/index.css';
createRoot(document.getElementById('root')!).render(<RoomWorkspace org="a0000000-0000-0000-0000-000000000001" user="a1000000-0000-0000-0000-000000000001" name="Demo agent"/>);
