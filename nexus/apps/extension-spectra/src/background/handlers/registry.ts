// goal: preserve the stable v2 site-route RPC while SettingsRepository remains
// the only persistence, revision and migration owner

import { rpcFailure, rpcSuccess, SPECTRA_PROTOCOL_VERSION } from '@nexus/contracts';
import { settingsRepository } from '../settings-repository';
import {
	scheduleAllMediaRouteProjection,
	scheduleMediaRouteProjection,
} from '../settings-projection';
import { isBackgroundRequestEnvelope, RPC_INVALID_REQUEST } from '../background-rpc';
import { isPopupDocumentSender } from '../popup-document-sender';

const PROTO_REGISTRY_GET = 'spectra.registry.get' as const;
const PROTO_REGISTRY_ADD = 'spectra.registry.add' as const;
const PROTO_REGISTRY_REMOVE = 'spectra.registry.remove' as const;
const PROTO_REGISTRY_QUERY = 'spectra.registry.query' as const;
const PROTO_REGISTRY_MARK_PROBED = 'spectra.registry.mark-probed' as const;
const PROTO_RULES_GET = 'spectra.media-route.rules.get' as const;
const PROTO_RULES_UPSERT = 'spectra.media-route.rules.upsert' as const;
const PROTO_RULES_REMOVE = 'spectra.media-route.rules.remove' as const;
const REGISTRY_REQUEST_TYPES = new Set<string>([
	PROTO_REGISTRY_GET,
	PROTO_REGISTRY_ADD,
	PROTO_REGISTRY_REMOVE,
	PROTO_REGISTRY_QUERY,
	PROTO_REGISTRY_MARK_PROBED,
	PROTO_RULES_GET,
	PROTO_RULES_UPSERT,
	PROTO_RULES_REMOVE,
]);

function isAttemptedRegistryMessage(message: unknown): boolean {
	if (!message || typeof message !== 'object') return false;
	const candidate = message as { protocolVersion?: unknown; type?: unknown };
	return candidate.protocolVersion === SPECTRA_PROTOCOL_VERSION
		&& typeof candidate.type === 'string'
		&& REGISTRY_REQUEST_TYPES.has(candidate.type);
}

export function isTrustedMediaRouteRulesSender(sender: chrome.runtime.MessageSender): boolean {
	return isPopupDocumentSender(sender);
}

async function projectRouteMutation(domain?: string): Promise<void> {
	const snapshot = await settingsRepository.getSnapshot();
	if (domain) scheduleMediaRouteProjection(snapshot, domain);
	else scheduleAllMediaRouteProjection(snapshot);
}

export function registerRegistryHandlers(): void {
	chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
		if (!isAttemptedRegistryMessage(message)) return false;
		if (sender.id !== chrome.runtime.id) {
			sendResponse(rpcFailure('forbidden', 'Site route RPC is extension-internal only'));
			return false;
		}
		if (!isBackgroundRequestEnvelope(message) || !REGISTRY_REQUEST_TYPES.has(message.type)) {
			sendResponse(rpcFailure(
				RPC_INVALID_REQUEST,
				`Malformed SPECTRA extension RPC v${SPECTRA_PROTOCOL_VERSION} site route request`,
			));
			return false;
		}
		if ((message.type === PROTO_RULES_GET
			|| message.type === PROTO_RULES_UPSERT
			|| message.type === PROTO_RULES_REMOVE)
			&& !isTrustedMediaRouteRulesSender(sender)) {
			sendResponse(rpcFailure('forbidden', 'Media route rules require the extension Popup'));
			return false;
		}

		const operation = async () => {
			if (message.type === PROTO_REGISTRY_GET) {
				return rpcSuccess(await settingsRepository.getMediaRouteSnapshot());
			}
			if (message.type === PROTO_REGISTRY_ADD) {
				const result = await settingsRepository.addMediaRoute(
					message.payload.domain,
					'user',
					message.payload.route,
					{ force: message.payload.force === true },
				);
				await projectRouteMutation(message.payload.domain);
				return rpcSuccess(result);
			}
			if (message.type === PROTO_REGISTRY_REMOVE) {
				const before = await settingsRepository.getMediaRouteSnapshot();
				const domain = before.entries.find((entry) => (
					entry.fingerprint === message.payload.fingerprint
				))?.domain;
				const result = await settingsRepository.removeMediaRoute(message.payload.fingerprint);
				if (result.removed) await projectRouteMutation(domain);
				return rpcSuccess(result);
			}
			if (message.type === PROTO_REGISTRY_QUERY) {
				return rpcSuccess(await settingsRepository.queryMediaRoute(message.payload.domain));
			}
			if (message.type === PROTO_REGISTRY_MARK_PROBED) {
				const result = await settingsRepository.markMediaRouteProbed(
					message.payload.domain,
					message.payload.route,
					{ force: message.payload.force === true },
				);
				await projectRouteMutation(message.payload.domain);
				return rpcSuccess(result);
			}
			if (message.type === PROTO_RULES_GET) {
				return rpcSuccess(await settingsRepository.getMediaRouteRulesSnapshot());
			}
			if (message.type === PROTO_RULES_UPSERT) {
				const result = await settingsRepository.upsertMediaRouteRule({
					domain: message.payload.domain,
					...(message.payload.pathPrefix ? { pathPrefix: message.payload.pathPrefix } : {}),
				}, message.payload.route);
				await projectRouteMutation(message.payload.domain);
				return rpcSuccess(result);
			}
			if (message.type === PROTO_RULES_REMOVE) {
				const before = await settingsRepository.getMediaRouteRulesSnapshot();
				const domain = before.entries.find((entry) => (
					entry.fingerprint === message.payload.fingerprint
				))?.domain;
				const result = await settingsRepository.removeMediaRouteRule(message.payload.fingerprint);
				if (domain) await projectRouteMutation(domain);
				return rpcSuccess(result);
			}
			return rpcFailure('unsupported_request', 'No site route handler for this request');
		};

		void operation().then(sendResponse).catch((error) => sendResponse(rpcFailure(
			'registry_unavailable',
			error instanceof Error ? error.message : String(error),
			true,
		)));
		return true;
	});
}
