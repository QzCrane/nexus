---
type: reference
status: stable
audience: user
owner: halo-privacy
last_reviewed: 2026-08-13
---

# Privacy Policy for HALO

**Last updated: August 13, 2026**

## Overview

HALO is a browser SidePanel toolkit. It has no advertising, analytics, telemetry, or developer-operated data collection service. Most tools process data on the user's device. Network-backed tools are separate capabilities that run only after the user invokes or enables them; their data flows are listed below.

## Data kept on the device

HALO can keep settings, enabled-tool state, language, notes, snippets, tasks, user scripts, tool inputs and results, and other user-created tool data in Chrome extension storage. Some preferences use `storage.sync`; Chrome may synchronize that data through the user's signed-in browser account under Google's policies. HALO's developer does not receive it.

The clipboard-history feature, when enabled, stores copied text and may store the source page URL and title. It keeps at most 100 entries; users can delete entries, clear unpinned history, or disable capture. API Tester can retain request configuration and responses locally; its dedicated saved-request history is capped at 20 entries. Sensitive values that users enter into tools, including API headers or bodies and TOTP secrets, remain local unless the user deliberately sends or exports them through a network or file operation.

HALO uses IndexedDB for user-created page archives, downloaded resource blobs, and module state. Dark-mode support can use Cache Storage for page styles and resources fetched from the page's own URLs. Bundled or user-installed page scripts may keep their own settings in the matched site's local storage. These records remain until the user deletes them through the relevant feature, clears extension/site data, uninstalls HALO, or the browser evicts cache data.

User-requested exports and downloads are written to locations selected or managed by the browser. HALO does not upload those files to the developer.

## User-invoked network capabilities

HALO does not run analytics or hidden background uploads. The following operations make outbound requests only when the related feature is invoked or enabled:

- **API Tester** sends the URL, method, enabled headers, and request body entered by the user to the user-selected public HTTP(S) endpoint. Private, loopback, and cloud-metadata hosts are blocked.
- **Header Viewer, subresource-integrity fetch, resource download, and user-script installation** request the public HTTP(S) URL selected by the user. The destination receives ordinary connection metadata and the request URL; returned content is processed or stored locally. User-installed JavaScript is saved locally and executes only through Chrome's `userScripts` API after permission and host access are granted; saved match rules own automatic execution, and the explicit Test action targets only the active tab. A script may use Chrome's isolated `USER_SCRIPT` world or the page's `MAIN` world according to the user's saved script configuration. User-authored CSS uses Chrome's `scripting.insertCSS` only after the same explicit permission/host-access gate.
- **IP Lookup** contacts `ipinfo.io`; if the current-IP lookup fails, it can fall back to `api.ipify.org`. Those providers necessarily receive the requester's IP address. A specific-IP lookup sends the entered IP address to `ipinfo.io`.
- **Bookmark and history favicons** request Google's favicon service at `www.google.com/s2/favicons` with the relevant hostname.
- **Translation and font links** open Google Translate, DeepL, Bing/Microsoft translation, or Google Fonts with the text, page URL, target language, or font family selected by the user.
- **Hover Zoom** loads user-hovered image/media URLs and can request site APIs needed to resolve a higher-quality source, including Bilibili and Bilibili TV endpoints. Requests can contain the page/media URL, public media identifiers, requested quality parameters, and normal network metadata. The privileged background proxy accepts only public HTTP(S) hosts and omits ambient credentials; page-owned media loads remain subject to the browser and destination site's request behavior.
- **Dark mode** can fetch stylesheets and referenced page resources from their existing URLs so Dark Reader can render the enabled page. Cache Storage may retain successful responses locally.

Local `data:`, `blob:`, and `chrome-extension:` resource reads are not outbound network traffic.

Third-party destinations process requests under their own privacy and retention policies. HALO does not control their server logs. Network features can fail because of browser permissions, CORS, authentication, quotas, site changes, or restricted pages.

## Browser data and permissions

HALO's page tools can read or modify the current page after installation or user action. Optional permissions separately gate page capture, clipboard access, cookies for the currently selected site, downloads, browsing history, bookmarks, tab groups, user scripts, extension management, and broad user-script host access. Cookie Manager keeps values inside the extension UI or a user-requested local export. HALO processes permission-backed data locally unless a user-invoked network operation above explicitly sends it to its chosen destination.

HALO does not bypass protected pages, browser permission prompts, content-security restrictions, authentication, or user-activation requirements.

## Data HALO does not collect

The developer does not receive, sell, rent, or use personal information, browsing history, page content, clipboard entries, files, tool inputs, identifiers, or usage events for advertising, analytics, credit decisions, or behavioral profiling. HALO does not include an advertising SDK or telemetry endpoint.

This statement does not mean that every feature is offline: optional network operations and Chrome account synchronization are disclosed above.

## Extension code

HALO's own JavaScript, WebAssembly, libraries, and assets are bundled in the submitted package. HALO does not download updates to its own executable code. User-authored or user-imported JavaScript is a distinct, explicit capability executed through Chrome's `userScripts` API after the corresponding permission and host access are granted. Its saved execution world is either Chrome's isolated `USER_SCRIPT` world or the page-visible `MAIN` world; HALO does not describe the latter as sandboxed. User-authored CSS uses Chrome's explicit CSS injection API under the same access gate.

## Policy changes and contact

A release that changes permissions, network destinations, transmitted fields, storage, retention, or user-script behavior must update this policy before publication. For privacy questions, use the issue or support channel in HALO's published repository or listing.
