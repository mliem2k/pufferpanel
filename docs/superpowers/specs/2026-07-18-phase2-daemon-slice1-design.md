# PufferPanel v3-js: Phase 2 Slice 1 (Local tty Daemon) Design

Status: Draft, approved via brainstorming
Date: 2026-07-18
Branch: `v3-js` (permanent default branch on `mliem2k/pufferpanel`, never merged to `v3`)

## Purpose

Phase 1 (Core Panel) shipped a fully-tested Panel-mode backend where every
daemon-backed action (start/stop/status) returns an honest `501`. This is
Slice 1 of Phase 2 (Daemon/Node): it replaces that stub with a real, locally-
executing daemon for the one execution environment that matters for the
actual migration target (`ubuntu-mliem`'s Purpur server, which runs as a
native process, not Docker).

**In scope:** real local `NodeClient`, the `tty` execution environment
(plain stdio, no pseudo-terminal), the `Environment` class (console/stats/
status pub-sub), install/uninstall template execution (scoped to `download`
and `command` steps), and WebSocket console/stats/status streaming.

**Explicitly deferred to later slices:** the `docker` execution environment,
remote-node support (Eden Treaty over a real network socket), file access
(get/put/delete, archive/extract), backups, and scheduled tasks.

This continues the faithful-port philosophy and Eden-Treaty-everywhere
principle from the Phase 0 architecture doc, and the pragmatic layout Phase 1
actually landed on: routes and services live directly under `apps/panel` and
`packages/services`, not the more elaborate `packages/web/api`+`web/daemon`
split originally sketched in Phase 0.

## Package layout

```
packages/core/src/
  environment.ts          # Environment class: console ring buffer + EventEmitter
                           #   pub/sub ("console"/"stat"/"status" events), stats/status
                           #   trackers, delegates process control to an injected
                           #   EnvironmentImpl
  environment-impl.ts      # EnvironmentImpl interface: executeAsync, kill, getStats,
                           #   sendCode, getUid, getGid, isRunning
  server-definition.ts     # EXTENDED (additive): adds `installation`/`uninstallation`
                           #   step arrays to the Phase 1 schema, no breaking change

packages/environments/     # NEW package: @pufferpanel/environments
  package.json             # wildcard exports, same convention as every Phase 1 package
  src/tty.ts               # TtyEnvironmentImpl: Bun.spawn + plain stdio (no pty),
                           #   pidusage for cross-platform CPU/memory stats

packages/services/src/
  template-execution.ts    # runInstall/runUninstall: download + command steps only,
                           #   {{variableName}} substitution into commands/URLs

apps/panel/src/daemon/
  app.ts                   # createNodeApp(registry): Node-mode Elysia routes
                           #   (start/stop/status) + one shared WS /socket route
  registry.ts              # in-memory Map<identifier, Environment>, populated by
                           #   reading each server's ServerDefinition JSON from disk
  node-client-local.ts     # createLocalNodeClient(nodeApp): real NodeClient calling
                           #   nodeApp.handle() directly in-process, no network hop
```

**Correction made while grounding this design against the actual Phase 1 code:**
`packages/services` cannot depend on `apps/panel` (packages hold shared logic apps
depend on, never the reverse), so the real `NodeClient` implementation — which must
call the Node app's `.handle()` — lives in `apps/panel/src/daemon/`, not
`packages/services`. `packages/services/src/node-client.ts` (the `NodeClient`
interface, `NodeClientNotImplementedError`, and the existing stub `createNodeClient()`)
stays exactly as Phase 1 left it, completely unchanged. Wiring in the real client is a
small, additive change to `apps/panel`: `createServerRoutes(authPlugin, createClient =
createNodeClient)` gains a second, optional, defaulted parameter, so every existing
Phase 1 call site and test (`createServerRoutes(authPlugin)`) keeps working unchanged,
and only `apps/panel/src/app.ts`'s real composition passes
`() => createLocalNodeClient(nodeApp)` to override the default stub.

## Environment class and tty execution environment

`Environment` (ports `environment.go`) owns:
- A bounded console ring buffer (last 500 lines).
- An `EventEmitter` emitting `console` (new log line), `stat` (CPU/memory
  snapshot), and `status` (running/installing state change) events, the same
  three the WebSocket protocol forwards verbatim.
- A reference to an injected `EnvironmentImpl` it delegates actual process
  control to.

`EnvironmentImpl` interface (same six methods as the Phase 0 architecture
doc, unchanged): `executeAsync`, `kill`, `getStats`, `sendCode`, `getUid`,
`getGid`, `isRunning`.

`TtyEnvironmentImpl` (the only implementation in this slice):
- Spawns via `Bun.spawn({cmd, cwd, stdio: ["pipe","pipe","pipe"]})`, no pty.
  Minecraft server console doesn't need real terminal semantics (raw mode,
  ioctl), plain stdio pipes are sufficient and avoid a native-binding
  dependency (`node-pty`) with uncertain Bun compatibility.
- stdout is split into lines and pushed into the console tracker; stdin
  accepts console-send commands.
- Stats via the `pidusage` library (cross-platform: works via `/proc` on
  Linux, `ps` on macOS, so the test suite exercises the real code path on
  the dev machine, not a fake).
- `isRunning()` reflects the subprocess's actual exit state.
- `stop()`: writes `execution.stopCommand` to stdin if present, waits up to
  a timeout, escalates to `SIGTERM` then `SIGKILL` if the process hasn't
  exited. `kill()` always sends `SIGKILL` immediately.
- `autoRestartFromCrash` (already a field on `ServerDefinition.execution`
  from Task 13): if true, an unexpected exit (not from an intentional
  `stop()`/`kill()` call) triggers an automatic restart.

## Template execution engine

`ServerDefinition` (Task 13's schema) gains `installation`/`uninstallation`
step arrays, additive only, no change to any existing field Phase 1 code
already depends on. Scoped down from upstream PufferPanel's full operation
zoo (curseforge/github downloads, file move/copy/unzip, etc., ~15+ types) to
the two step types actually needed to install or reinstall a Purpur-style
server:

- `{ type: "download", url: string, targetPath: string }` — fetches a URL to
  a file path relative to the server's working directory.
- `{ type: "command", command: string }` — runs a shell command in the
  server's working directory; a non-zero exit code fails the installation.

`template-execution.ts` exposes `runInstall(serverDir, definition, variables)`
and `runUninstall(serverDir, definition, variables)`, running steps
sequentially, substituting `definition.variables` values into command
strings and download URLs via `{{variableName}}` replacement.

## Node app and WebSocket protocol

`createNodeApp(registry)` in `apps/panel/src/daemon/app.ts`:
- `POST /servers/:identifier/start`, `POST /servers/:identifier/stop`,
  `GET /servers/:identifier/status` — look up the server's `Environment` in
  the registry and delegate.
- One shared `.ws("/servers/:identifier/socket")` route with query flags
  `console`/`stats`/`status` selecting which of the three event streams a
  connection subscribes to. Frames are `{type: "console"|"stat"|"status",
  data: ...}`, matching the Phase 0 architecture doc's wire format exactly.
  `open` subscribes the socket to the requested `Environment` events,
  `close` unsubscribes.

`registry.ts` is an in-memory `Map<identifier, Environment>`, populated by
reading each server's `ServerDefinition` JSON from a configurable data
directory: `data/servers/<identifier>/definition.json` (the definition) and
`data/servers/<identifier>/files/` (the server's actual working directory,
where the jar/world files live and where the spawned process's `cwd` points).

## Real NodeClient

`createLocalNodeClient(nodeApp)` (`apps/panel/src/daemon/node-client-local.ts`)
implements the existing `NodeClient` interface (`start`, `stop`, `status`) by
calling `nodeApp.handle(new Request(...))` directly, in-process, against the
routes above. This matches the exact HTTP semantics a remote node will use
once that slice lands. `createServerRoutes` gains a second, optional,
defaulted parameter (`createClient = createNodeClient`) so this can be
wired in without touching `NodeClient`'s interface or any existing Task 15
test.

## Open items for the next slice

- Docker execution environment (a second `EnvironmentImpl`).
- Remote-node `NodeClient` (Eden Treaty client typed against `createNodeApp`,
  with the Ed25519 JWT signing from Task 6 wired in as the `headers` hook).
- File access (get/put/delete, archive/extract).
- Backups and scheduled tasks.
- Actual production entrypoint (`apps/panel/src/main.ts`, flagged as missing
  in Phase 1's final review) and migration-on-boot, needed before any real
  deployment, still deferred until Phase 4 (migration/cutover).
