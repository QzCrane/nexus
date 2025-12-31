// goal: HALO SidePanel entry point
// eff: Minimal entry, logic moved to components/sidepanel

import React from 'react';
import { createRoot } from 'react-dom/client';
import { SidePanel } from '../components/sidepanel/SidePanel';

createRoot(document.getElementById('root')!).render(<SidePanel />);
