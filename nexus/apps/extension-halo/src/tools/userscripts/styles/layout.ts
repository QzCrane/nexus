import type { CSSProperties } from 'react';
import { TEXT, TEXT_MUTED } from './shared';

export const layoutStyles: Record<string, CSSProperties> = {
	wrapper: {
		display: 'flex',
		flexDirection: 'column',
		gap: '14px',
		scrollBehavior: 'smooth',
		position: 'relative',
		minHeight: '100vh',
	},
	sectionHeader: {
		display: 'flex',
		justifyContent: 'space-between',
		alignItems: 'center',
		marginTop: '8px',
	},
	sectionTitle: {
		fontSize: '13px',
		fontWeight: 600,
		color: TEXT_MUTED,
		textTransform: 'uppercase',
		letterSpacing: '0.5px',
	},
	scriptList: {
		display: 'flex',
		flexDirection: 'column',
		gap: '8px',
	},
	templatesGrid: {
		display: 'grid',
		gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
		gap: '8px',
		marginTop: '8px',
	},
};
