/**
 * SPECTRA Options - 标签页切换
 */

export function initTabs(): void {
	const navBtns = document.querySelectorAll<HTMLButtonElement>('.nav-btn');
	const tabContents = document.querySelectorAll<HTMLElement>('.tab-content');

	navBtns.forEach(btn => {
		btn.addEventListener('click', () => {
			const tabId = btn.dataset.tab;
			if (!tabId) return;

			// 切换导航状态
			navBtns.forEach(b => b.classList.remove('active'));
			btn.classList.add('active');

			// 切换内容区
			tabContents.forEach(content => {
				content.classList.toggle('hidden', content.id !== `tab-${tabId}`);
			});
		});
	});
}
