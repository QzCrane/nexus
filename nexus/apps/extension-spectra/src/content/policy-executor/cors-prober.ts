/**
 * 策略执行器 - CORS 主动探测器 (v3.4)
 * 
 * 职责：使用临时 AudioContext + AnalyserNode 探测域名 CORS 状态
 * 
 * 原理：createMediaElementSource() 不会因跨域抛出错误！
 * 真正的 CORS 限制体现在读取音频数据时（AnalyserNode 返回全零）
 */

import { logger } from '../../shared/logger';

const log = logger.content;

/** 已探测的域名集合（防止重复探测） */
const probedDomains = new Set<string>();

/**
 * 检查媒体元素是否已就绪且正在播放
 */
function isMediaReady(el: HTMLMediaElement): boolean {
	// 必须有实际的媒体数据（readyState >= 2 表示有足够数据）
	if (el.readyState < 2) return false;
	// 必须正在播放或已有时间进度
	if (el.paused && el.currentTime === 0) return false;
	return true;
}

/**
 * 检查域名是否已探测过
 */
export function isDomainProbed(hostname: string): boolean {
	return probedDomains.has(hostname);
}

/**
 * 使用临时 AudioContext + AnalyserNode 探测 CORS
 * 
 * 关键：读取音频数据，如果全为零则表示 CORS 限制
 * 
 * @returns true = RESTRICTED, false = SAFE, null = 元素未就绪或已探测过
 */
export async function probeWithTempContext(el: HTMLMediaElement): Promise<boolean | null> {
	const hostname = window.location.hostname;

	// 已探测过的域名返回 null
	if (probedDomains.has(hostname)) {
		log.debug(`[CORS Prober] ${hostname}: 已探测过，跳过`);
		return null;
	}

	// 检查元素是否就绪
	if (!isMediaReady(el)) {
		log.debug(`[CORS Prober] ${hostname}: 媒体未就绪 (readyState=${el.readyState}, paused=${el.paused})`);
		return null;
	}

	try {
		const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
		const tempCtx = new AC();

		// 如果 AudioContext 被暂停，需要恢复
		if (tempCtx.state === 'suspended') {
			await tempCtx.resume();
		}

		try {
			const source = tempCtx.createMediaElementSource(el);
			const analyser = tempCtx.createAnalyser();
			analyser.fftSize = 32; // 最小值，用于快速检测

			source.connect(analyser);
			analyser.connect(tempCtx.destination);

			// 读取频域数据
			const data = new Uint8Array(analyser.frequencyBinCount);
			analyser.getByteFrequencyData(data);

			// 检查是否全为零（CORS 限制会导致全零）
			const hasData = data.some(v => v > 0);

			// 标记元素和域名
			el.dataset.vmProbed = 'true';
			probedDomains.add(hostname);

			if (hasData) {
				log.info(`[CORS Prober] ${hostname}: 探测成功 (SAFE) - 有音频数据`);
				await tempCtx.close();
				return false; // SAFE
			} else {
				log.info(`[CORS Prober] ${hostname}: 探测失败 (RESTRICTED) - 数据全零`);
				await tempCtx.close();
				return true; // RESTRICTED
			}

		} catch (err) {
			// 绑定失败（元素已被其他 AudioContext 使用）
			probedDomains.add(hostname);
			log.debug(`[CORS Prober] ${hostname}: 绑定失败 - ${err}`);
			await tempCtx.close();
			// 绑定失败不确定是否 CORS，保守返回 null
			return null;
		}

	} catch {
		probedDomains.add(hostname);
		log.debug(`[CORS Prober] ${hostname}: AudioContext 创建失败`);
		return true; // 保守视为 RESTRICTED
	}
}


