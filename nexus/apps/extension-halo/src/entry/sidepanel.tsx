// goal: HALO SidePanel entry point
// eff: Minimal entry, logic moved to components/sidepanel

import { createRoot } from 'react-dom/client';
import { SidePanel } from '../components/sidepanel/SidePanel';

const root = document.getElementById('root');
if (!root) throw new Error('HALO SidePanel root element is missing');
createRoot(root).render(<SidePanel />);
