---
type: explanation
status: stable
audience: developer
owner: spectra-runtime-architecture
last_reviewed: 2026-11-11
---

# SPECTRA runtime architecture

SPECTRA is a Chrome MV3 extension with explicit ownership across runtime contexts. Shared protocols/snapshots are in `@nexus/contracts`. Per-field behavior is in [control architecture](../control/README.md).

## Runtime ownership

| Context | Owns | Does not own |
| --- | --- | --- |
| Popup / Options | intent, local render, interaction | actual audio mode, direct storage, executor choice |
| Content, isolated | document identity, media registry, DOM/CSS writers, exact configured-site lean host, proven MediaElement WebAudio graph, Capture intent/readback projection | Capture construction, processor-active claims before physical readback, cross-tab hotkey target selection |
| MAIN bridges | fullscreen audio handoff, exact-element page-media getter/setter readback | generic dispatch, domain tables, cross-tab state |
| Background worker | routing, settings, snapshots, badge projection, runtime leases, per-document lean/full hotkey ownership and restart recovery | WebAudio nodes, optimistic UI |
| Unified offscreen host | actual Capture processors, authenticated remote sessions | direct document creation/closure |

`ControlSnapshot` owns actual media/video/DSP fields. `AudioSessionSnapshot` (keyed by document) owns processor mode/phase/config/error. Projections preserve this separation.

```mermaid
flowchart LR
  User["User / shortcut / Remote page"] --> Intent["Typed intent"]
  Intent --> BG["Background ControlAuthority / one writer actor per tab"]
  BG -->|"exact document + revision"| Content["Content DocumentRuntime"]
  Content --> PageAudio["Proven MediaElement WebAudio"]
  BG -->|"one-shot Capture admission"| Offscreen["Unified offscreen host"]
  Offscreen --> Audio["Capture AudioGraph"]
  Offscreen --> Remote["RemoteSessionAuthority V3"]
  Content -->|"physical readback"| BG
  Audio -->|"processor readback"| BG
  Remote -->|"authenticated dispatch ticket"| BG
  BG --> Snapshot["Durable snapshots + bounded projections"]
  Snapshot --> UI["Popup / Side Panel / Options / badge"]
```

Every arrow is a validated port, not shared mutable state. UI and Remote submit intent; only the physical Content or offscreen owner can produce an actual-state fact, and only Background can commit that fact into the durable control model.

## Audio lifecycle

```text
mode: bypass | webaudio | capture
phase: idle | starting | active | stopping | error
```

Navigation/transition advances generation; late ACKs cannot update newer documents. Default is transparent bypass.
MediaElement WebAudio activates only after complete exact source coverage, running context, graph signature, normalized configuration, and source-count readback. Capture activates only after the offscreen host returns the equivalent tab-owned proof. Every transition neutralizes the candidate's competing route, verifies the candidate, switches ownership, and only then releases the previous owner; a failed handoff restores the last acknowledged owner. Content lifecycle events require the authoritative `documentId`, so a late event for an old document cannot mutate its replacement.

Revisioned Settings may pin a site to `direct` or `capture`; absence means
`auto`. `direct` never falls through from a failed page graph to Capture, while
`capture` remains only a preference and still requires a current one-shot
admission. Worker-restart projection replays the selected route to every
resident tab, and new Content pulls it with the additive
`spectra.audio.policy.get` request. The established
`spectra.audio.config.get -> AudioConfig` v2 response remains unchanged so old
resident Content and a new Background worker remain wire-compatible.

`audio-processor.contracts.ts` is the sole runtime owner of the processor DTO and
its exact guard. The full audio contract projects product configuration onto
that type, while the Offscreen protocol imports the leaf directly; Capture
startup therefore does not load persistence, migration, session, or page-native
audio validators that it cannot consume.

```mermaid
sequenceDiagram
  participant L as Browser lifecycle
  participant B as TabControlActor
  participant P as Physical owner
  participant S as Durable snapshot
  L->>B: beforeNavigate(tab, oldDocument)
  B->>B: advance documentEpoch and invalidate pending work
  B->>P: prepare(ticket, identity, baseRevision)
  P-->>B: physical ACK + actual readback
  B->>B: revalidate identity, epoch, ticket, lease, revision
  alt every proof is current
    B->>S: commit next revision
    S-->>B: durable readback
    B-->>L: bounded projections
  else any proof is stale or unknown
    B->>P: compensate / release when required
    B-->>L: typed rejection or indeterminate result
  end
```

## Unified offscreen host

`offscreen.html` hosts Capture processors and remote sessions. `offscreen-coordinator.ts` exclusively owns `chrome.offscreen.createDocument()` / `closeDocument()`.

- Leases: `audio:<tabId>`, `remote:<sessionId>`
- Serialized creation/reconciliation/close decisions. Closes only after all leases released + 1-shot grace alarm.
- Remote controller is a deferred module. Status requests without runtime return an empty exact result. The first explicit session creation loads exactly one local `peerjs-vendor.js` ESM default export through the offscreen-local single-flight loader. That output is built from the same workspace-owned PeerJS 1.5.5-derived data-only source consumed by the checked-in Remote page: JSON serialization is mandatory, UTF-8 messages are capped at 16 KiB before parsing or sending, and MediaConnection, BinaryPack, Raw/binary serializers, package/CDN fallbacks, and global `Peer` ownership are absent. Capture-only work does not load the transport, and load timeout/disposal fences reject only the initiating request instead of installing a fallback.
- HELLO reconstructs processors/sessions after worker restart. Unresponsive hosts enter 30s grace.
- Content READY waits for Capture reconciliation to prevent duplicate Captures.

## MAIN bridges and page-native media semantics

No generic MAIN runtime or domain tables. Two version-guarded bridges own cross-world surface:
1. **Fullscreen V1**: Temporarily yields active audio pipeline around `requestFullscreen()`.
2. **Page-media V2**: Synchronously reads/writes `volumeBase`, `mediaMuted`, `speed` for exact target.

Page-media discovery walks composed-ancestors and declared bounded paths. Matches
require paired getter/setter. The [media-control owner](../control/06-media-and-video.md#143-speed-decision-and-failure)
defines speed value admission, physical ACK and proven baseline handoff, including
an already-owned speed field. The bridge retains no controller or polling loop;
declared data is owned by the registry, not by a second MAIN runtime.

Content creates a lazy isolated-world `AudioContext` only when a visible analyser or explicit DSP demand has complete proven coverage for every current media element. The controller owns one page-lifetime source binding per element, never mutates CORS state, and disconnects on element/runtime disposal. Page volume/mute remain native fields. Capture remains the complete-tab fallback; leaving either processor first acknowledges a transparent configuration before releasing its physical owner.

Physical Capture keeps an explicit `targetTabId` so an async transition can never capture whichever tab happens to become focused later. The manifest therefore owns `activeTab` together with `tabCapture`: a user action or registered Chrome command grants temporary authority for that exact active page, while Background still rechecks tab/document/generation before and after stream-ID acquisition. Programmatic Popup opening, page activity, restore, Remote, and background-tab work cannot manufacture that grant.

## Settings and hotkey target state

Background owns revisioned settings in `chrome.storage.local`. Revisions are written to physical storage before broadcast.
Per-tab control session is stored in `chrome.storage.session` (`tabId+documentId+origin+resourceUrl`), containing 20 refresh-restorable fields.

Control snapshots, control generations, audio-session snapshots, and the Popup presentation cache use `chrome.storage.local` under their existing identity fences. MediaFacts instead uses `chrome.storage.session`: it survives worker replacement within the browser session, not a browser restart. A cached control value does not establish current media membership. Navigation and tab removal retire media facts; eligibility expiry only hides their card. Per-tab control sessions, badge-usage markers and the hotkey target also retain their explicitly session-scoped lifetimes.

The writers are separate because their failure modes differ. `control-coordinator.ts` publishes `spectra.control.tab.<tabId>` only after `chrome.storage.local.set` resolves, rolls the in-memory value back when the write fails, and keeps `spectra.control.generation.<tabId>` as the ordering authority that survives a worker. `audio-session-store.ts` owns `spectra_audio_session_<tabId>`: a 250 ms coalesced write that retries up to five times, a document fence (epoch plus current/retired document) that rejects late senders, and a bounded rejection ledger that records *why* a write was refused. Runtime-message and badge projections run on a separate per-tab queue, so a slow optional receiver can never delay the next physical or session ACK. The Popup card cache (`spectra.popup.card_cache.<tabId>`) is a forecast with no TTL: it is retired by a different document, never by elapsed time.

Settings commit and settings projection are separate authorities. A mutation ACK means the exact revision is durable and readable by a replacement worker; it does not claim every open tab has already observed the projection. `settings-projection.ts` owns one revision-coalescing queue for extension, Content, hotkey, shortcut, and restore projections. It preserves global/hotkey lanes while selecting the newest snapshot, retries real delivery failures on `50/200/800 ms`, records the last projected revision only after those lanes settle, and wakes from a Chrome alarm after a deferred failure. A destroyed or non-resident Content receiver is terminal for that document because its successor pulls the durable snapshot during bootstrap. Tab work is bounded to eight concurrent deliveries, and hotkey reconciliation reuses the already-enumerated tab snapshot. Global OSD, visualizer, language, and theme projection is presentation-only and never re-enters audio policy.

The `volume`, `volumeBase`, and `boost` fields form one canonical value object. Partial site/preset merges combine the validated patch with existing state before one canonicalization pass, so changing only base or boost cannot persist a contradictory effective volume.

| Patch source | Updates current-resource | Updates origin-portable |
| --- | --- | --- |
| Page observation | yes | no change |
| Popup / remote / shortcut ACK | yes | yes |

A page observation is a fact about one resource. It updates that resource's
projection and never revokes an origin-portable field: only an explicit
extension ACK replaces the viewer's configured intent, so a site's own volume,
mute or speed gesture cannot reset the next video in the same origin to the
preset.

Resource URL canonicalization:
- Same URL, new `documentId`: complete patch
- Same-origin, diff URL: origin-portable patch only
- Cross-origin: both retired

Restore precedence, in order: the retained tab projection (`rebind`, exact
document or exact-resource reload, else its origin-portable patch), then the
origin session, then the site preset, then the global preset. A lower layer
never overrides a higher one.

A separate monotonic per-tab record owns Action-badge stickiness, surviving worker replacements. The decision is recorded synchronously and painted by the newest decision, not by whichever asynchronous Action write happens to land first. Staged gesture inputs carry a monotonic stamp, so an input accepted while a projection is still resolving is newer than that projection regardless of the wall clock; the 600 ms bound only expires a stage whose acknowledgement never arrives. A staged tone changes the colour only — `isCapture` stays from the acknowledged lifecycle. The session-scoped global hotkey target is owned by `hotkey-target-repository.ts`; it is independent from media identity and never selects or activates an audio processor.

## Media discovery and identity

Content maintains media through an event-driven registry. Registration does one
viewport-geometry seed. Same-document navigation does not duplicate the registry.
Cold bootstrap and the full registry share `chooseInitialMedia`: connected media,
PiP/fullscreen preference, playing state, visible area and stable registration
order establish the same initial choice before explicit selection becomes sticky.
Desired native settings replay only onto the current selected source, through
registration/play/selection events and the same Background coordinator; the
registry never binds an audio graph. The [media lifecycle owner](../control/06-media-and-video.md#134-closing-live-players-and-speed-inheritance)
defines hidden/detached live-player handoff, source retirement, Popup closure
and the distinction between route, document and media identity.
The document replay template has its own single restore lease, separate from a
source's physical field ownership. Initial restore, explicit control, worker
recovery and page-settings release follow the [template lifetime owner](../control/06-media-and-video.md#135-document-replay-intent-lifetime).
Status probes cannot recreate leases after navigation or an explicit release.

### Browser, document and media lifecycle axes

These axes are independent. A frozen tab can still have the same document and
retained settings; a runnable SPA can replace its media without replacing its
document. Visibility eligibility is a projection, not a deletion or a control
lease. Returning to a tab asks Chrome to activate it; only Chrome's resumed
runnable state permits normal identity binding and observation again.

<!-- mermaid:id=browser-document-media-axes -->
```mermaid
flowchart TD
  T[Chrome tab] --> B[Browser availability axis]
  T --> D[Document identity axis]
  T --> M[Media identity and scene axis]
  B --> R[Runnable permits normal binding]
  B --> U[Frozen or discarded or unloaded is metadata only]
  D --> K[Same document preserves its own intent lifetime]
  D --> N[New document retires old callbacks and facts]
  M --> S[Source change retires exact source ownership]
  M --> V[Selection visit fences restore and observations]
  M --> C[Bounded scene speed can survive a return visit]
  B --> P[Shared membership projection]
  D --> P
  M --> P
  P --> E[Visible or hidden without deleting settings]
```

Passive bootstrap may do a bounded top-level getter. It observes `volumechange`/`ratechange` and submits complete actual pairs to Background without media identity. While the initial HELLO verdict is pending, it retains the latest observation without dispatching it. A lean verdict drains that observation; a heavy-runtime verdict discards it because the runtime owns observation. Restoration acquires the heavy runtime before writing media, so restored native events cannot be replayed by the lean bootstrap.

The bootstrap also owns the declared site's actual-speed toolbar projection for
its entire lifetime, including while the heavy runtime is resident. The
[media-control owner](../control/06-media-and-video.md#145-actual-speed-label) defines
the exact media/root binding and the independent menu witness. Initial DOM
ready/warm injection/pageshow reads do not wait for a rate event. Native media
signals discover player roots; only those roots receive a label-specific
MutationObserver for late/replaced UI. There is no document-wide topology watch,
polling, MAIN observer, or additional media writer. Bootstrap disposal releases
these observers and conditionally restores its text.

## Action Popup first frame

Chrome sizes an Action Popup from its document, and every open is a new realm.
`popup.js` is a module; asynchronous settings, identity and media-state reads
cannot establish the first visible structure or language. Waiting for them
leaves the primary stage empty; painting an English/default projection before
they settle causes a second visible presentation. Structure and actual-state
confirmation therefore have separate completion boundaries.

The render-critical appearance is announced before the document exists:

| Fact | Decided by | Read before the first paint from |
| --- | --- | --- |
| How many cards the Popup will draw | Background, `popup-frame.ts` | `popup.html?cards=N` |
| Whether this active tab has a primary card | Background's restricted-URL rule | `main=0/1` |
| Language and visualizer shape | committed global settings | `lang=...&viz=0/1` |
| Intrinsic card geometry | sole card template and CSS | all announced slots already present during parsing |
| The colour the surface paints in | the last committed theme mode | `spectra.popup.themeMode` |

### Card-count announcement

`chrome.action.setPopup({ tabId, popup })` lets a tab carry its own Popup URL, so
the count travels in that URL instead of being discovered after the window is
visible. `popupCardCount` mirrors the Popup's own inventory rule: one card for a
controllable active tab, plus every other listed media tab.
`media-inventory-runtime.ts` exposes the single inventory instance that both the
`spectra.tab.visible.list` route and this count read, so the announcement and the
rendered list cannot disagree about scope.

`popup-frame.ts` re-announces whenever the answer can change: tab activation, a
committing or navigating document, `audible` transitions, media reports
(coalesced over 60 ms, because one report per tab would read the same inventory
several times for one visible change), tab removal, window focus, and worker
startup. A per-tab monotonic generation means a slow inventory read that began
before a tab switch cannot overwrite the newer announcement. When the count
cannot be decided, the bare `popup.html` is announced — the pre-announcement
behaviour, which costs one prediction and no correctness.

The shared membership projection supplies `nextExpiryAt` and `expiryByTab`.
The Action URL carries only anonymous background deadlines (`expires`), with
the active primary card excluded. Prepaint subtracts deadlines already reached
before creating any slot, so a suspended worker or a closed Popup cannot leave
an expired empty card in the next first frame. The open Popup owns one next-expiry
wake to recompute membership. Availability transitions also
reconcile metadata-only versus runnable binding. Neither path probes unknown or
unloaded pages to discover hypothetical cards.

Global settings RPCs wait for an immediate active-tab appearance announcement
attempt before returning their durable ACK; they do not wait for the 60ms media
report timer or Content delivery. The projection queue also reconciles it.
An Action API failure cannot undo a durable settings commit and remains an
unannounced/fallback boundary, not a claimed first-frame proof.

The count and the visible list use `shared/media-card-policy.ts`; card rendering
does not apply a second retention filter or a fixed background-card quota.
Expiry hides a member without deleting facts or settings. A document can still
retire between announcement and open, or report genuinely new media. Such a
membership change is reconciled as new information. Normal opening with the
same known members needs no fresh detection and does not defer background cards.

### Bootstrap contract

`shared/popup-bootstrap.ts` owns the appearance parameters, theme key, surface
marker and Chrome's 600 px ceiling. Build injection supplies the head entry's
contract. Appearance describes known structure, never actual control authority
or a historical-height promise.

`frame-reserve.js` is a classic render-blocking script. Before the first paint it:

1. paints `data-theme` from `spectra.popup.themeMode`, resolving `system` with the
   same `prefers-color-scheme` query the module uses;
2. marks `data-spectra-surface="action-popup"` when the document really is an
   Action Popup, so tab-hosted pages keep their separate sizing behavior.

The parsing prepaint entry supplies every announced slot before rendering is
unblocked. `data-spectra-structure-ready` means that structure is complete; it
does not claim that actuals have arrived. Normal Popup geometry follows those
nodes' intrinsic CSS size. It does not read same-count, last-used or legacy
height hints, pin the window to an old height, or guess 600 px when count is
missing. A count alone cannot predict height when language or visualizer shape
changes. The module's `data-spectra-ready` likewise marks committed membership
structure, not completion of per-card actual hydration or a height unlock.

### Frame settlement

`frame-height.ts` retains synchronous first sizing, but ResizeObserver and
MutationObserver invalidations coalesce into one requestAnimationFrame before
writing ancestor root geometry. Writing the observed root during descendant
observer delivery creates undelivered shallower notifications. Release/retrack
cancels the queued frame and fences callbacks by tracking revision. The overlay
scrollbar owns only visual geometry and scrolling; its observers, listeners,
drag capture and paging timers belong to the existing Popup attempt disposer,
so bootstrap retry cannot stack them.

`popup/frame-height.ts` is the sole live frame geometry owner. It follows
`.view-container` and Chrome's 600 px cap, with one whole-document scroll surface
above the cap. It does not wait for settings, identity, control/runtime RPC or
an actual-state ready flag to let already-known structure determine size.
Failure surfaces keep this same geometry owner. Metadata and actual updates
reuse reserved lines within each card rather than adding a temporary sync band.

### Card shape and inventory forecast

Two more late reads shaped the first frame:

- `popup/settings-forecast.ts` caches the last committed `GlobalSettings` and
  validates it on read. The visualizer band is part of every card's height, so a
  user who turned the visualizer off used to watch each card shrink after the
  settings snapshot landed — and the window followed. The forecast stands in
  until the authoritative projection arrives and is then overwritten, never
  merged.
- `popup/media-inventory-from-storage.ts` projects the card list from session
  media facts (`spectra.media-facts.v1`) and Chrome's `audible` flag through the
  same shared policy as Background, so the first
  list does not wait for a service-worker round trip. The
  `spectra.tab.visible.list` request still runs and remains the authority that
  reconciles a tab which navigated or reported media while the Popup was opening.

### Presentation and actual confirmation

`popup-first-paint.js` is a separate classic head script with `defer` and explicit
`blocking="render"`: parsing supplies the existing `#tmpl-card`, then the script
localizes and clones that sole template before rendering is unblocked. All nine
Popup-only dictionaries come from their existing typed source catalog. The
classic script publishes that immutable packaged catalog to the module realm;
Options and action catalogs remain separate. Build/integrity and both Popup
script-size measurements include this entry, rather than moving its bytes out
of the measured closure.

Every announced visible slot, main and background alike, is localized and cloned
from the same template during parsing. All known members therefore appear in
the first frame together; observation concurrency bounds do not stagger DOM
mounting. No unknown page receives a reserved empty slot or a folded-library
count. Normal opening does not wait for a new media scan.

Each slot starts unbound and inert, without tab/document identity or invented
actuals: playback is `aria-pressed=mixed`, volume is `—`, and speed is unset.
Missing/invalid appearance does not imply a main card; restricted pages do not
receive a guessed card. The module assigns current membership identities to
these same nodes before per-card asynchronous work. Runnable cards read
document-fenced durable/cache presentation, strip cached `playing`, and confirm
actuals through the existing messaging reducer and bounded recovery. A frozen,
discarded or unloaded known member takes the metadata-only path before any
snapshot probe or control Port: its return-to-tab action delegates activation
to Chrome. A resumed runnable tab is rebound through the normal identity path;
availability is never inferred from a timeout or used to manufacture actuals.

Identity binding is not a processor observation. A visible pending slot remains
inert with unknown values; its default theme accent does not claim a native
processor. `data-lifecycle-coverage=known` is published with the renderer's
acknowledged lifecycle/tone projection. Browser proofs retain the entire pending
trace and require the first and every subsequent known tone to match the settled
processor, rather than hiding the structure until RPC completes.

The module's `cardBindings` owns node identity, availability, binding phase and
document ID. `initCard` reports its validated binding through a typed callback
fenced by the current attempt/token; DOM attributes only project that state.
An unchanged membership refresh performs no node move or rebind. A new confirmed
document can recover a metadata-only card even while Chrome still reports loading.

<!-- mermaid:id=popup-card-binding-lifetime -->
```mermaid
stateDiagram-v2
  [*] --> Queued: Eligible member gets its node
  Queued --> Hydrating: Bounded initialization slot
  Hydrating --> Bound: Current document validated
  Hydrating --> Unavailable: Metadata only or no usable document
  Bound --> Queued: Document or Chrome availability changed
  Unavailable --> Queued: Runnable and document evidence confirmed
  Queued --> Retired: Member or attempt retired
  Hydrating --> Retired: Member or attempt retired
  Bound --> Retired: Member or attempt retired
  Unavailable --> Retired: Member or attempt retired
  Retired --> [*]
```

Rebinding releases control resources and keeps the same node inert until the
new binding is validated. Only membership or attempt retirement removes it.
Ordinary same-document playing/usage reports do not restart hydration.

The module initializes the announced dictionary synchronously, before settings
RPC; dynamic title/ARIA rendering cannot reintroduce English. Async metadata
has reserved line height. Temporary sync announcements do not add a layout band;
exhausted recovery has a visible status overlay with the same geometry. A bind
failure removes the unbound node, and Popup/document retirement disposes the
existing handlers. There is no HTML snapshot cache, second media state owner,
whole-page visibility delay, fade or repeated node replacement.

<!-- mermaid:id=popup-first-frame -->
```mermaid
sequenceDiagram
  participant B as Background membership and announcement
  participant H as Parsing prepaint entry
  participant P as Popup module
  participant C as Existing card nodes
  participant R as Runtime actual reader
  B->>H: Announced count, main, language and shape
  H->>C: Localize sole template and create all visible slots
  Note over H,C: First paint contains every announced slot together
  P->>C: Assign identities on the same nodes
  alt Known member is not runnable
    P->>C: Metadata and return-to-tab action only
    Note over P,R: No probe, control Port or forced wake
  else Runnable member
    P->>R: Document-fenced bounded observation
    R-->>P: Current actual or explicit read failure
    P->>C: Admit ordered actual and enable valid actions
  end
  B-->>P: Genuine new fact, retirement or eligibility expiry
  P->>C: Reconcile membership without rebuilding surviving nodes
```

The built-Chrome Popup spec attaches before document scripts, holds the module
response, verifies parsed localized/unbound structure, then records every
rendering frame while settings and actual-state RPC remain blocked. It requires
all announced main/background slots, the same nodes, current-language text and
playback ARIA labels, unknown playing and unchanged card height. The zero- and
three-background fixtures exercise the count boundary; a settled-DOM assertion
alone is insufficient. These fixtures do not establish every live site's media
or route behavior.

## Runtime loading and shortcuts

Manifest loads minimal isolated bootstrap + closed MAIN bridges. Heavy Content runtime is acquired via consumer tokens. Final consumer releases listeners. Cold-document built-in hotkeys use READY ensure and release their transient capability after the admitted operation.

A document that reports playable media is itself a consumer. `ensureMediaObservation` acquires the heavy runtime through the normal loader with the `document-media-observation` capability when `spectra.tab.media.report` reports `hasMediaElement`, independent of a desired value, a restore template, or prior explicit use. Observation and writing stay separate: an observation-only runtime writes nothing until a real intent arrives, and a navigation or explicit release retires the capability so a later media report cannot resurrect it. A document that reports no media does not load the heavy runtime for observation alone. The report is an acknowledged obligation rather than a notification: the background answers `spectra.tab.media.report` only after `ensureMediaObservation` settles, so `ok:true` means this document has an observation owner. A failed ownership load is a retryable RPC failure; the bootstrap withdraws its dedupe latch and sends again. The loader retries the transient document-identity race at 120/400/1200/3000/6000/10000 ms, and the awaiting message channel keeps the worker alive across that horizon, so one rejected delivery cannot leave a redirected document unobserved until an unrelated pause/play or the Popup. The bootstrap's own HELLO handshake — the verdict that assigns observation ownership — retries at 150/400/900/1800/3000/5000 ms; one rejected handshake must not leave the document with no observation path. `/follow` and `/follow/live/<id>` are the same origin and the same tab session; that transition is a new document, not a cross-origin session migration.

When a runtime attaches to a document that already has a selection, `NativeMediaExecutor.publishCurrentSelection()` publishes that selection once after `bootstrapMessaging` — the presentation kind, `spectra.content.target.changed` carrying the registry's observation stamp, and the physical values that already exist (volume, mute, speed, pitch, playback) as a page observation. A document with no selection publishes nothing, but the first selection that follows completes the same publication exactly once; later selections keep the ordinary target-only path so no page observation is fabricated from a cold or superseded selection. An SPA route switch (`/follow` -> `/follow/live/<id>`) selects a different player element in the same document; that replacement also publishes its own physical values, because the previous player's numbers are not a snapshot of the new one. A selection that only changes identity on the same element stays target-only. The values matter because a new document otherwise has no field snapshot until its first native change or an explicit read: that empty window is what made the first Popup open look like the switch. Background admits attach publication and a later `selected` through the same ordered observation rules, so the duplicate sample is idempotent.

The document-start bootstrap remains the native-observation owner until the heavy
runtime proves it registered a player (`MediaRegistry.hasSelection`). Injection or
a READY handshake alone does not transfer that duty: a ready-but-blind runtime — a
player it never discovered, a removed element, media mounted outside its reach —
must not silence the only observer that receives document-level `volumechange`,
because the next Popup read would then be the first thing to move the snapshot.
The handoff calls `claimObservationOwnership`, which advances the shared
observation epoch so the registry's samples supersede the bootstrap's and every
replaced registry stays stale; when the registry loses its last selection the
bootstrap resumes on the same ordering and keeps submitting.

Two further boundaries keep that handoff honest. Registration is selection
evidence: a player the SPA mounts after its own `play` already happened started
playing before any listener existed, so `register` runs the same admission
`play` would have run instead of leaving the element unselected until the viewer
clicks it (I8). And a native `volumechange` is witnessed only by the element
that produced it: the audio-runtime delegate reports the extension's applied
policy, so in document-output mode it returns the same value before and after a
gesture, and reading volume/mute through it made the gesture compare equal to
the observation cache and vanish. Only hidden finite media is vetoed as a
preview — a broadcast is audible even while a canvas hides the `<video>` or
autoplay has not started it (I9).

The pre-injection runtime-status probe is an optional read bounded to 1 second.
Its settlement pool retains at most eight physical outstanding probes; observation
expiry does not pretend to cancel a browser request. An expired or unavailable
probe proceeds through the same document-scoped injection/READY transaction.
Late probe replies cannot restore source leases or publish READY. This boundary
does not time out or bypass restore writes: explicit controls still wait for the
document initialization decision. The aggregate counters exported by the
[local diagnostic port](#local-diagnostics) describe this boundary but never
influence it.
Offscreen events keep Chrome message channel open until Background settles, preventing suspension mid-event.

Built-in chords (`Alt+Arrow*/Alt+M`) are reserved, claimed at `document_start` before page handlers. `Alt+Up` is left to the browser only while the page media already sits at its native ceiling and the document has no known extension invocation: Chrome runs the manifest `volume_up` command only for keys the renderer leaves unhandled, and only that command invocation grants the tab's `activeTab` for the Capture that same press needs above 100%. The bootstrap still stops propagation there so page handlers cannot cancel the chord, without preventing the default that lets the command run. Invocation is a document-lifetime fact, not a Capture-session fact: a Popup open, a delivered command, or any successful Capture start latches the grant until the document navigates. Below the ceiling, and in any invoked document (the content path needs no new grant even after Capture stopped), the press stays claimed, so the key keeps working when the command is unavailable or the page consumes it. Configured-site bindings yield to website claims. Keyup clears unconsumed repeat pulses but cannot revoke an admitted press. `chrome.commands` admits only non-coalescing actions.

### Load-time package integrity

Injected entrypoints — `content-runtime.js` (via `chrome.scripting.executeScript`), the manifest `content_scripts` files, and `background.js` — must physically exist in the loaded unpacked package. A package missing them produces one linked symptom chain: `Could not load file: 'content-runtime.js'` in the service worker; no media card for a page that is playing (no bootstrap means the document cannot report playable media, and nothing else is asked to guess); and `Effective volume requires an observable page or standard native volume` (no runtime means no `volumeBase` readback). Normal builds cannot emit a partial `dist/`: the build finishes with a `statSync` size check on every entry and fails on a missing outfile, and watch mode restores each entrypoint's last good output on a failed rebuild while printing an explicit `✗` instead of dropping the file silently. A partial package is therefore external mutation (interrupted build or manual cleanup). Two guards cover the residual paths: `bun run check:dist` validates that every build entrypoint and manifest-referenced file physically exists (exit 1 with the missing list otherwise), and `bun run build:dev` rebuilds the package before reloading the unpacked extension.

### Configured-site lean hotkeys

A configured site may avoid a document-lifetime heavy Content Runtime hotkey lease only when **every live binding** is exactly page-default-equivalent: `speed_up`, `speed_down`, `volume_up`, `volume_down`, or `volume_mute`, with no custom parameters. Disabled, explicit no-op, or otherwise unavailable bindings do not own runtime work. One live non-equivalent binding makes the entire site `full`. The most-specific configured domain is authoritative: an explicitly disabled child suppresses an enabled parent rather than falling through.

Ownership is split into three layers:

1. `site-hotkey-loader-adapter.ts` resolves URL + settings into `none | lean | full` and owns exact heavy-listener suspend/resume projection.
2. `site-hotkey-owner.ts` is the sole Background owner for one `tabId+documentId`. It serializes reconciliations and owns Worker epoch/configuration generation, injection single-flight, lifecycle fencing, and full capability bookkeeping.
3. `content-site-hotkeys.js` is the minimal isolated-world physical input host. It has no settings authority and accepts only exact document configuration.

The exact lean configuration message is:

```text
spectra.content.site-hotkeys.configure
{ epoch, generation, bindings }
```

Rules:

- Every ownership transition starts with an exact **empty lean barrier**. A confirmed missing receiver means the document is already lean-empty. Any other transport/protocol failure is fail-closed.
- For `lean` or `none`, Background then sends an exact-document heavy `spectra.hotkeys.changed` projection with `sites:{}` before releasing any remembered hotkey lease or enabling lean. The heavy runtime may remain resident for restore/observation/control without retaining configured-site keyboard ownership.
- A broad real `spectra.hotkeys.changed` settings publication happens **before** ownership reconciliation. It updates heavy settings, but it is never lean-host configuration authority; the later exact suspend/resume projection determines heavy configured-site ownership for that document.
- A surviving lean host from a previous MV3 worker ACKs the new worker's empty barrier. A new Worker epoch supersedes the old epoch even when its numeric generation restarts lower.
- After injection, a nonempty lean projection must receive the exact `{epoch,generation}` ACK. Missing receiver after successful injection is an error, not a safe no-op.
- The lean host exposes a revision-2 read-only `active` marker in the same isolated-world realm. `getActiveHotkeySettings()` projects `sites:{}` while that marker is active. This physical fence prevents a transient heavy runtime loaded for control/feedback from claiming configured-site repeats during the READY-to-exact-suspend window.
- Per-document transitions serialize across HELLO, settings, History/navigation and lifecycle races. `forget()` increments the lifecycle token without deleting in-flight work; every async continuation proves the same lifecycle before publishing another side effect. A stale full ensure releases the capability it acquired.
- Lifecycle tombstones remain only while an injected host, full capability, injection promise, or transition is observable; retired idle keys are removed.

### Sender-document execution, repeat, and feedback

Lean bindings reuse the existing `spectra.content.default-hotkey.trigger` request with one additional validated disposition:

```text
{ action, phase, gesture, repeated, disposition: 'site-page' }
```

Absent `disposition` retains shipped default/global-hotkey-target semantics. `site-page` bypasses `hotkeyTargetRepository`; Background validates the sender and constructs `origin:'site-page'` with `foreground` and `target` equal to that exact top-level `tabId+documentId`.

The lean host owns only physical gesture admission and identity. Background owns bounded repeat coalescing (`runPageGestureBurst`); completion never self-drains queued pulses, and release discards unconsumed repeats. `volume_mute` is non-repeatable but still preserves the physical repeated fact through release.

Feedback reuses the existing scalar gesture channel and transient shortcut runtime. The same gesture is replayed to the heavy feedback owner if it loads after the first press, so speed/volume/mute retain actual OSD behavior. RPC failures use the existing Content toast. The transient runtime is released after the action/feedback path settles; this is not a document-lifetime hotkey lease.

The lean host survives BFCache `pagehide` when `event.persisted === true`: it releases held gestures but keeps its exact host/listeners in the retained realm. A real page retirement disposes it. Extension-context invalidation also disposes the host so stale code cannot keep calling `preventDefault()` after messaging becomes unavailable.

### MV3 worker-restart heavy-runtime recovery

A service-worker restart loses Background's in-memory runtime leases while an old heavy Content Runtime may survive in a page. `runtime-restart-startup.ts` is wired from the Background entry and recovers each current HTTP top document in this order:

1. exact runtime-status probe;
2. if a current-revision heavy runtime survived, acquire a fixed temporary `worker-restart-recovery` lease through the normal runtime loader;
3. reconstruct source ownership from `ownedSources`;
4. reconstruct the canonical restore capability from the exact tab-session identity/resource hostname; a restored document template returns here because it already owns the runtime;
5. independently retain a surviving runtime for a persisted processor session;
6. independently retain a surviving runtime when the session media fact names this document with outcome `found`, because a document that observed media owns its observation runtime with no desired values;
7. reconcile current configured-site hotkey ownership (`none | lean | full`);
8. release only the temporary recovery lease.

Actual orphan disposal remains inside the normal runtime-loader lease authority, which rechecks concurrent/transient leases before sending RELEASE. Restore/hotkey reconstruction failure deliberately retains the temporary safety lease. Both per-document failures and discovery failures (settings/tab enumeration) use the same bounded retry schedule: `250 ms`, `1 s`, `4 s`. If no heavy runtime survived, recovery does not create one merely because a persistent restore plan or a media fact exists; a later media report re-establishes observation at the normal document boundary.

This model removes document-lifetime heavy **hotkey ownership** for eligible sites. It does not promise that an admitted control operation or another independent consumer can never load the heavy runtime transiently.

## Remote control

Optional, capability-bound, authenticated. Requires an HMAC-SHA-256 nonce challenge. Allowlisted commands are bound to `sessionId + sessionEpoch + commandId + sequence + tabId + generation`. Offscreen is the sole live session/Peer owner; Background serializes admitted commands per session and revalidates the dispatch ticket after every await. Receipt retention and recovery are bounded, and a delayed connection/open/close callback cannot retire a newer Peer.

Remote generation advances in Background only after the authoritative offscreen host accepts the exact state. The host caches accepted state while unauthenticated or disconnected and sends it in the authenticated handshake; a hard send rejection leaves the last accepted generation unchanged, so the next command for that generation is not silently consumed. Out-of-order acknowledgements may advance but never regress accepted generation.

Runtime RPC `source` is a claim, never authority by itself. Popup and page sources must match their physical sender; page mutations require the exact current top document; `remote` and `system` are internal-only and are rejected from runtime messages. The retired Content legacy mutation adapter no longer relabels itself as Popup.

## Protocol and envelope ownership

The extension-internal v2 release line has one SPECTRA envelope owner. `@nexus/contracts`
owns the typed `SpectraRequestEnvelope` / `SpectraEventEnvelope` schema and runtime
validators. Common envelope/RPC primitives live in `spectra.protocol-primitives.ts`;
canonical Background route guards live in `spectra.background-runtime.ts` and are reused
by the generic protocol. `background-rpc.ts` owns only the allowlist derived from the
routes Background actually registers. It does not copy payload fields, DTOs, error
codes, or the full protocol table. `shared/spectra-client.ts` owns general request
construction, delivery, and response validation. Focused UI clients are typed transport
facades, not alternate protocol owners. The wire value remains the single
`SPECTRA_PROTOCOL_VERSION` contract constant, including for the minimal document-start
bootstrap boundary.

Discrete Popup controls continue to use that v2 request/response envelope. Continuous
volume/DSP uses one private typed Popup port whose Background-owned latest slot invokes
the same coordinator; it neither changes the public v2 wire nor creates another mutation
owner. A `stage` message carries the coalesced input revision, the effective volume, the
exact tone the card is painting, and at most two coverage groups. The Background repaints
the Action badge from that tone in the same turn, so the two surfaces cannot disagree about
a route the card is already showing. Port disconnect retires the Popup response channel
after Background admission, not an already accepted latest intent.

That constant versions the extension-internal RPC only. The authenticated
Remote transport has its own v3 protocol/version owner. Diagnostic errors must
name the endpoint and request type; a generic “Peer returned invalid v2” message
is forbidden because it hides whether Background or Content violated which
route contract.

A top-level `action:` message object is the retired V1 runtime protocol and is forbidden
in every production sender. `action` may occur only inside a validated hotkey payload
(`payload.action`), where it is a domain value carried by the typed envelope. The retired
kernel action table, `createRouter` / `router.on` / `router.listen`, and
`GLOBAL_SETTINGS_UPDATE` are not SPECTRA runtime paths. Listeners own exact request-type
sets and reject unknown or malformed envelopes before a handler sees them.

## Boundary projections

Favicon/QR are UI/security boundaries, not media capabilities. Exact-element, PiP, fullscreen bridge semantics handled separately.

## Local diagnostics

Diagnostics exist to answer "which owner is stuck" without exporting anything
that could identify a user. The contract is split so that no surface can widen
it by accident.

| Layer | Owner | Responsibility |
| --- | --- | --- |
| Shape and redaction | `@nexus/kernel/diagnostics.ts` | Bundle schema, token grammar, sender authentication, port lifetime |
| Fact collection | `src/background/diagnostics.ts` | Reads existing Background owners and reports scalars |
| User gesture | `src/options/diagnostics.ts` | One export button; collects, downloads, reports success or failure |

Collection is **pull-only**. Nothing in the service worker intercepts the
console, installs a telemetry timer, polls an owner, or owns a diagnostic
storage key. The Options button opens the private port
`nexus.local-diagnostics.v1`; Background answers with one bundle and retires
the port. Both sides give the exchange five seconds, and a port that outlives
that budget is disconnected rather than left open.

A port is admitted only when `isLocalDiagnosticSender` proves the sender is
this extension: `sender.id` must equal `chrome.runtime.id`, `sender.url` must
parse as a `chrome-extension:` URL whose hostname is that same id with no
credentials and no port, and `sender.origin`, when present, must be the exact
`chrome-extension://<id>` origin. A caller-supplied identity in the payload is
never consulted — the browser metadata is the authority, so a page cannot ask
for diagnostics by claiming to be a surface.

### What the bundle may contain

`DiagnosticOwnerSummary` values are `boolean`, finite `number` or `null`, and
keys must match `^[A-Za-z0-9_.:-]{1,64}$`. That single rule is what makes the
export safe: a scalar has nowhere to hide a URL, a storage payload, a document
id, a session token or a page title. A field with no honest reading is reported
as `null`, never as an invented `0` — "the Offscreen host did not answer" and
"the host answered with zero processors" must stay distinguishable.

The bundle also carries the manifest version, the Chromium major version
(parsed from the user agent, which is never included itself), the granted
permission names, an origin *count* plus one `broadGrant` flag, per-context-type
counts, and at most 64 recent events. Events are `{ sequence, timestamp, level,
scope, code }` with token-only scope and code — a message is not a field. No
page URL, tab id, window id, document id, request id or storage value is
exported.

### What Background reports

| Group | Fields | Meaning |
| --- | --- | --- |
| Surface | `backgroundSurfaceActive` | The worker answered at all, so the rest of the bundle has an owner behind it |
| Content routes | `contentRpc:<type>:pending`, `contentRpc:<type>:busyMs` | A route appears only while it has a request in flight; `busyMs` is the age of the oldest of them. The entry is deleted when the last reply settles, so an idle route is absent rather than zero |
| Popup input | `popupControlReceivedInputs`, `popupControlPendingBatches`, `popupControlFailedBatches` | Coalescing health on the private Popup port |
| Popup settlement | `popupControlSettleSamples`, `popupControlSettleP50Ms`, `popupControlSettleP95Ms`, `popupControlSettleMaxMs` | Bounded ring of input-to-paint latencies; percentiles are computed over the retained sample set, not over the session |
| Runtime loading | `runtimeProbePendingCount`, `runtimeLoadingCount`, `runtimeReadyWaiterCount`, `runtimeReadyDocumentCount`, `runtimeDisposingCount` | The pre-injection probe pool and the READY transaction described above |
| Inventory | `audibleTabCount`, `mediaFactCount`, `mediaTabStateCount`, `badgeStateCount`, `captureStateCount`, `activeCaptureCount` | Owner sizes. `captureStateCount` counts tabs with any recorded capture flag and `activeCaptureCount` only those whose flag is `true`, so the pair separates "the map was touched" from "a capture is running" |
| Offscreen | `offscreenLeaseCount`, `offscreenHostStateUnknown`, `offscreenReadSucceeded`, `offscreenHostPresent`, `offscreenAudioProcessorCount`, `offscreenRemoteSessionCount` | Read through one `OFFSCREEN_HOST_HELLO`; the four host facts are `null` together when that read failed, so a dead host is never reported as an empty one |
| Permission | `userScriptsPermissionGranted` | `null` when `chrome.permissions.contains` rejected, rather than a guessed `false` |

Reading these facts observes existing owners. Collection never creates,
restores or reconciles Offscreen authority; a diagnostic export is not an
opportunity to repair state that the product would otherwise leave alone.

## Production performance budgets

`scripts/check-production-artifacts.ts` is the executable owner. Its graph accepts only manifest/HTML/CSS references, static imports, deferred imports, declared runtime-loader edges, and the explicit vendor-module edge. An arbitrary string cannot make a file reachable.

```mermaid
flowchart LR
  Files["83 physical output files"] --> Graph["Typed ArtifactGraph"]
  Meta["Build metafiles"] --> Attribution["Physical output attribution"]
  Graph --> Static["Static script closure"]
  Graph --> Possible["Possible script union"]
  Graph --> Payload["Possible non-script payload"]
  Attribution --> Report["One analyzed report + artifact SHA-256"]
  Static --> Report
  Possible --> Report
  Payload --> Report
  Report --> Hard{"Within hard ceilings?"}
  Hard -->|no| Fail["build failure"]
  Hard -->|yes| Headroom{"At least 15% headroom?"}
  Headroom -->|no| Advise["non-blocking optimization advisory"]
  Headroom -->|yes| Eligible["eligible for later release gates"]
  Advise --> Eligible
```

Terms are deliberately non-interchangeable:

- **Physical output bytes** are bytes of one file on disk, counted once in total JS/dist. `outputAttribution: measured` means build metafiles assigned emitted bytes to their producing inputs; `not-measured` is explicit and cannot support module-contribution claims.
- **Static script closure** is the set-union of JavaScript reachable without a deferred/runtime edge from an entry. It is a loading-topology measurement, not parsed heap or CPU time.
- **Possible script union** adds every admitted deferred/runtime/vendor JavaScript edge and counts each file once. It is an upper bound on code the surface can request over its lifetime, not startup residency, simultaneous residency, or memory use.
- **Possible non-script payload** is the same possible closure's bytes excluding JavaScript, such as reachable locale assets. **Possible payload** is possible script plus those non-script bytes.
- Residency, CPU, IPC, allocation, and latency claims require a named Chrome scenario trace. Artifact reachability alone cannot prove them.

Measured candidate bytes and hashes are dated evidence, not runtime architecture. The 2026-08-29 v1.4.2 snapshot is preserved in the [historical evidence archive](../_archive/2026-Q3/production-artifact-evidence-2026-08-29.md). Current values and hard ceilings come only from the executable owner and the receipt bound to the exact candidate. A missing 15% planning target remains a non-blocking optimization advisory; hiding graph edges, weakening protocol guards, or relabelling possible closure as non-resident corrupts measurement rather than improving the product.

All tab-set operations use bounded concurrency. Settings and visualizer projection use eight workers, remote restoration uses four, and Capture/runtime-restart flows use their declared bounded fan-out owners. On failure, the fan-out owner stops admitting new items but waits for every live worker to retire before rejecting, so an immediate retry cannot overlap the previous generation and exceed the bound. A new tab-wide `Promise.all` is a release regression unless the owner proves a smaller physical bound.

Release and cross-platform lanes build the production SPECTRA candidate exactly once before Chrome integration. The build computes the analysis once, prints that same report, and binds its artifact hash; a second analysis of a changing directory is not equivalent evidence. `test:chrome:dist` consumes the receipt-bound existing `dist` when release orchestration supplies a CandidateReceipt. Standalone use requires a clean exact tree and creates a temporary receipt instead of accepting arbitrary ignored output. The developer convenience command `test:chrome` alone may prepend a development build. Capacity passes when every absolute ceiling passes in the matching receipt; 15% headroom remains advisory.

## Current implementation ownership

Ownership is registered in exactly one table:
[control 07 §17](../control/07-runtime-and-performance.md#17-implementation-ownership-and-migration-map).
It has two views — `§17.1` by file, `§17.2` by concern for the responsibilities that span
files. This page used to carry a third partial copy; three copies meant a new file had no
obvious home and a deleted file could leave a ghost in two of them.

## Actual browser launch evidence

All SPECTRA Puppeteer launches use `scripts/browser-driver.ts`, which selects
the current or floor driver through the existing replay policy and records the
runtime version plus the actual spawned process command. In a formal release
context, each physical launch writes a separate receipt bound to the exact
head, tree, run and attempt. Repeated launches by one test owner receive stable
execution sequence numbers instead of overwriting or rejecting valid samples.

Receipts retain sanitized effective arguments and declared profile-construction
metadata, never a temporary profile path. An executable digest is informational
evidence derived from the process actually returned by Puppeteer. If that
process identity is absent or unreadable, the receipt says `unknown`; a user
override path cannot substitute for an observed launch identity.
