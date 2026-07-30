export interface OwnedMSESession {
	readonly ready: Promise<void>;
	dispose: () => void;
}

export interface MSESessionCallbacks {
	onFailure: (error: unknown) => void;
	onReady: (isCurrent: () => boolean) => void;
}

/**
 * Owns the one MSE session allowed to affect the shared hover viewer.
 *
 * Replacement retires the previous session synchronously. Promise completion is
 * accepted only while both the generation and session identity still match.
 */
export class MSESessionOwner {
	private generation = 0;
	private current: {
		generation: number;
		session: OwnedMSESession;
	} | null = null;

	replace(session: OwnedMSESession, callbacks: MSESessionCallbacks): void {
		this.retire();
		const generation = ++this.generation;
		this.current = { generation, session };
		const isCurrent = () => this.isCurrent(generation, session);
		const failCurrent = (error: unknown) => {
			if (!isCurrent()) return;
			this.current = null;
			this.generation++;
			try {
				session.dispose();
			} catch (disposalError: unknown) {
				console.error(
					'[HALO:MSESessionOwner] Session disposal failed',
					disposalError,
				);
			}
			callbacks.onFailure(error);
		};

		void session.ready
			.then(
				() => {
					if (!isCurrent()) return;
					try {
						callbacks.onReady(isCurrent);
					} catch (error: unknown) {
						failCurrent(error);
					}
				},
				failCurrent,
			)
			.catch((error: unknown) => {
				console.error('[HALO:MSESessionOwner] Completion callback failed', error);
			});
	}

	retire(): void {
		this.generation++;
		const current = this.current;
		this.current = null;
		current?.session.dispose();
	}

	private isCurrent(generation: number, session: OwnedMSESession): boolean {
		return this.current?.generation === generation
			&& this.current.session === session;
	}
}
