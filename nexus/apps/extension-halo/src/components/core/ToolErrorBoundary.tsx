import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Card, Button } from '@nexus/ui-kit';

interface Props {
	children: ReactNode;
	toolId: string;
	onReset?: () => void;
}

interface State {
	hasError: boolean;
	error: Error | null;
}

export class ToolErrorBoundary extends Component<Props, State> {
	public state: State = {
		hasError: false,
		error: null
	};

	public static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error };
	}

	public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
		console.error(`[ToolErrorBoundary] Error in tool ${this.props.toolId}:`, error, errorInfo);
	}

	private handleReset = () => {
		this.setState({ hasError: false, error: null });
		this.props.onReset?.();
	};

	public render() {
		if (this.state.hasError) {
			return (
				<Card variant="default" padding="md" style={{ margin: '12px' }}>
					<div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center', textAlign: 'center' }}>
						<div style={{ fontSize: '24px' }}>⚠️</div>
						<div style={{ fontWeight: 600, color: 'var(--halo-text-primary)' }}>
							Tool "{this.props.toolId}" crashed
						</div>
						<div style={{ fontSize: '12px', opacity: 0.7, color: 'var(--halo-text-secondary)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
							{this.state.error?.message || 'Unknown error'}
						</div>
						<Button variant="primary" size="sm" onClick={this.handleReset}>
							Reload Tool
						</Button>

					</div>
				</Card>
			);
		}

		return this.props.children;
	}
}
