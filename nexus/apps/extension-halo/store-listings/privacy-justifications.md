---
type: reference
status: stable
audience: contributor
owner: halo-store-copy
last_reviewed: 2026-08-13
---

# HALO Chrome Web Store privacy declarations

This file must match the exact submitted manifest, production package, [`../PRIVACY.md`](../PRIVACY.md), and runtime behavior. HALO has no telemetry, but several explicit tools make user-requested network calls; do not select a declaration whose official meaning is “no collection or transmission” when it conflicts with those calls or Chrome sync.

## Single purpose

```text
HALO provides a local-first browser SidePanel of focused utilities for page inspection, text and data transformation, browser organization, and explicit user-invoked network tasks.
```

## Required permission justifications

### `storage`

Saves extension settings, enabled tools, language, user-created tool state, and bounded histories. Most records use local extension storage; selected preferences use Chrome sync. The developer does not receive this data.

### `activeTab`

Allows a user-invoked tool to inspect or act on the currently selected tab without granting a separate persistent host permission for that individual operation. Restricted pages remain inaccessible.

### `scripting`

Runs locally bundled inspection and interaction functions in the user-selected page. HALO does not use it to download or execute updates to extension-owned code.

### `sidePanel`

Provides HALO's primary user interface in Chrome's Side Panel and opens that interface from the toolbar action or supported context-menu commands.

### `contextMenus`

Creates user-visible commands for opening HALO or invoking supported actions on the selected page or content. Menu events are processed locally.

### `tabs`

Finds the active tab, opens user-selected URLs, organizes tabs and sessions, and binds page operations to the correct tab. Tab data is processed locally unless the user explicitly sends a URL or text through a disclosed network tool.

### `declarativeNetRequest`

Lets Hover Zoom install a bounded set of dynamic anti-hotlink rules for image and media requests. The rules remove the `Referer` header only for the feature's declared domains; they do not monitor browsing for analytics.

### content-script host access

The submitted manifest installs bundled content scripts on ordinary HTTP(S) pages and frames so enabled page tools, smooth scrolling, local clipboard capture, annotation, ruler, and Hover Zoom can receive page events. Its web-accessible-resource declaration exposes only packaged tool/script/assets paths behind dynamic URLs so those same page runtimes can load their bundled lazy code; it does not grant a site access to extension storage or APIs. Content remains local unless a disclosed user-invoked network feature requests a page resource or endpoint. Chrome internal and other restricted pages are not bypassed.

## Optional permission justifications

### `pageCapture`

Captures the current user-selected page as an MHTML archive only when the user requests it. The archive is stored locally in IndexedDB and can be deleted by the user.

### `clipboardRead` and `clipboardWrite`

Read access supports the explicit clipboard-history feature; write access supports copy actions across tools. Clipboard history is local, can be disabled or cleared, and is capped at 100 entries.

### `cookies`

Lets Cookie Manager read, edit, and delete cookies for the currently selected site after the user grants access. Cookie values stay inside the extension UI or a user-requested local export; HALO does not upload them.

### `downloads`

Saves user-requested media or generated files through Chrome's download UI. HALO does not read or upload unrelated downloads.

### `history`

Searches, displays, opens, and deletes browser-history entries only inside the History tool after the user grants access. Results remain local; favicon rendering can send the entry hostname to Google's favicon service as disclosed in the privacy policy.

### `bookmarks`

Searches, displays, opens, and deletes bookmarks inside the Bookmark tool after user authorization. Bookmark data remains local; favicon rendering can send the bookmark hostname to Google's favicon service.

### `tabGroups`

Lists, creates, renames, colors, collapses, and moves Chrome tab groups through the user's explicit Tab Groups tool actions.

### `userScripts` and optional host access

Registers JavaScript the user writes or imports through Chrome's `userScripts` API. Automatic runs follow the match patterns the user configures; the explicit Test action targets only the active tab. A saved script can use Chrome's isolated `USER_SCRIPT` world or the page-visible `MAIN` world. User-authored CSS uses `scripting.insertCSS`. Both paths require the same explicit `userScripts` permission and broad host-access gate, which can be revoked. They are not a fallback for extension-owned remote code.

### `management`

Lists installed extensions and apps and performs user-confirmed enable, disable, options-page, or uninstall actions inside Extension Manager. HALO does not upload the inventory.

## Remote-code declaration

```text
All extension-owned JavaScript, WebAssembly, libraries, and assets are bundled in the submitted package. HALO does not fetch executable updates to its own code. User-authored or user-imported scripts are a separate, user-visible capability registered through Chrome's userScripts API after optional permission and host access are granted.
```

## Data-use declaration

Use the current Chrome Web Store category names and definitions. The declaration must communicate that:

- HALO has no advertising, analytics, telemetry, or developer-operated collection service;
- local and sync storage can contain user-created tool data, clipboard entries, API requests/results, notes, secrets, page archives, resources, and user scripts;
- Chrome sync may process selected preferences under the user's browser account;
- explicit network tools send user-selected URLs, request fields, text, public media identifiers, or IP queries to the selected or named third-party destination;
- IP, favicon, translation, Hover Zoom, dark-mode resource, URL-fetch, and user-script-installation flows are disclosed in `PRIVACY.md`;
- data is used only to provide the invoked feature and is not sold or used for advertising, credit decisions, or behavioral profiling.

## Publication gate

Before submission, compare this file with the exact built manifest, production network destinations, `PRIVACY.md`, every locale, Chrome's current Dashboard wording, and the authenticated account's declarations. If the official primary sources or Dashboard cannot be reached, submission is blocked rather than inferred from old wording.
