// goal: transient visual notifications
const s: {
	host: HTMLElement | null;
	root: ShadowRoot | null;
	timer: ReturnType<typeof setTimeout> | null;
	action: (() => void) | null;
} = { host: null, root: null, timer: null, action: null };

function ensureToast(): { host: HTMLElement; root: ShadowRoot } | null {
	if (!document.body) return null;
	if (!s.root || !s.host?.isConnected) {
		const h = document.createElement('div');
		h.id = 'spectra-toast-host';
		h.style.cssText = 'position:fixed;top:20%;left:50%;transform:translateX(-50%);z-index:2147483647;pointer-events:none';
		document.body.appendChild(h);

		const ws = h.attachShadow({ mode: 'open' });
		const st = document.createElement('style');
		st.textContent = '.t{background:rgba(20,20,30,0.92);backdrop-filter:blur(10px);padding:14px 24px;border-radius:14px;color:#fff;font-family:system-ui;transition:0.3s;opacity:0;transform:translateY(-15px);display:flex;align-items:center;box-shadow:0 8px 32px rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1)}.v{opacity:1;transform:translateY(0)}.txt{font-size:14px;font-weight:500;white-space:nowrap}.a{appearance:none;border:1px solid rgba(255,255,255,.24);background:#2563eb;color:#fff;border-radius:10px;padding:10px 16px;font:600 14px system-ui;cursor:pointer}.a:focus-visible{outline:3px solid #a78bfa;outline-offset:3px}[hidden]{display:none!important}';

		const d = document.createElement('div');
		d.className = 't'; d.id = 't';
		const txt = document.createElement('span');
		txt.className = 'txt'; txt.id = 'txt';
		const action = document.createElement('button');
		action.type = 'button'; action.className = 'a'; action.id = 'action'; action.hidden = true;
		action.addEventListener('click', () => s.action?.());
		d.append(txt, action);
		ws.append(st, d);
		s.host = h;
		s.root = ws;
	}
	return { host: s.host, root: s.root };
}

function scheduleHide(delay: number): void {
	if (s.timer) clearTimeout(s.timer);
	s.timer = setTimeout(() => {
		s.root?.getElementById('t')?.classList.remove('v');
		s.action = null;
		if (s.host) s.host.style.pointerEvents = 'none';
	}, delay);
}

export function showToast(msg: string): void {
	const toast = ensureToast();
	const t = toast?.root.getElementById('t');
	const txt = toast?.root.getElementById('txt');
	const action = toast?.root.getElementById('action') as HTMLButtonElement | null;
	if (!toast || !t || !txt || !action) return;

	txt.textContent = msg;
	txt.hidden = false;
	action.hidden = true;
	s.action = null;
	toast.host.style.pointerEvents = 'none';
	t.classList.add('v');
	scheduleHide(3000);
}

// post: arms one bounded, trusted page click without a standing document listener.
export function showActionToast(label: string, action: () => void): () => void {
	const toast = ensureToast();
	const t = toast?.root.getElementById('t');
	const txt = toast?.root.getElementById('txt');
	const button = toast?.root.getElementById('action') as HTMLButtonElement | null;
	if (!toast || !t || !txt || !button) return () => undefined;

	txt.hidden = true;
	button.hidden = false;
	button.textContent = label;
	s.action = () => {
		dispose();
		action();
	};
	toast.host.style.pointerEvents = 'auto';
	t.classList.add('v');
	button.focus({ preventScroll: true });
	scheduleHide(15_000);

	const dispose = () => {
		if (s.timer) clearTimeout(s.timer);
		s.timer = null;
		s.action = null;
		t.classList.remove('v');
		toast.host.style.pointerEvents = 'none';
	};
	return dispose;
}
