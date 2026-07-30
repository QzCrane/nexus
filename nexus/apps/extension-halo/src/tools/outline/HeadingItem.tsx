// goal: Heading Item component for Outline
// eff: Extracted to separate file

import type React from 'react';
import type { HeadingItem as HeadingItemType } from './types';
import { styles } from './panel.styles';

interface HeadingItemProps {
	heading: HeadingItemType;
	index: number;
	onClick: (index: number) => void;
	title: string;
}

export const HeadingItem: React.FC<HeadingItemProps> = ({ heading, index, onClick, title }) => {
	return (
		<button
			type="button"
			style={{
				...styles.headingItem,
				paddingLeft: `${14 + (heading.level - 1) * 18}px`,
				width: '100%',
				border: 'none',
				textAlign: 'left',
			}}
			onClick={() => onClick(index)}
			title={title}
		>
			<span style={styles.headingLevel}>H{heading.level}</span>
			<span style={styles.headingText}>{heading.text || '(empty)'}</span>
		</button>
	);
};
