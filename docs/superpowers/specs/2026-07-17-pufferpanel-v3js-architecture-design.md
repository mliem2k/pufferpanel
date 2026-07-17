# PufferPanel v3-js: Architecture & Contracts Design (Phase 0)

Status: Draft, pending user review
Date: 2026-07-17
Branch: `v3-js` (permanent default branch on `mliem2k/pufferpanel`, never merged to `v3`)

## Purpose

This is Phase 0 of a multi-phase rewrite of PufferPanel (Go backend + Vue frontend game
server panel) into ElysiaJS (Bun/TypeScript) + Eden Treaty + React. The end goal is to
replace the live PufferPanel install on `ubuntu-mliem` (single node, single server
`mliem`, Purpur 1.21.10) with a functionally-parity system in a modern TS stack.

This document defines the architecture and contracts that later phases (Core Panel,
Daemon/Node, Frontend, Migration) all build against. It intentionally does not
implement anything; see the companion implementation plan for that.

## Porting philosophy

**Faithful 1:1 structural port**, same philosophy as the `claude-swap` Go port: mirror
PufferPanel's actual Go package tree as a Bun workspace monorepo, one TS module per Go
file, one function/class-method per Go function/method, same names wherever TS syntax
allows. The goal is that porting a future upstream commit is a matter of finding the
analogous file, not re-deriving intent from scratch.

Where TS/Elysia genuinely does something better than the Go original (see "Local-node
bypass" below), that improvement is taken, but the default posture is "port faithfully,"
not "redesign."

Full PufferPanel feature parity is in scope (multi-node, multi-user/OAuth clients,
template marketplace, SFTP-equivalent file access), not a trimmed-down personal subset,
even though the only real deployment target today is a single node/single server.

## Monorepo layout

```
/packages
  core/           # mirrors root `pufferpanel` Go package: Server type, Environment class,
                  #   message.go -> message.ts, httpmodels.go -> httpmodels.ts
  models/         # mirrors models/ - Drizzle schema, same tables/fields as the GORM structs
                  #   (user.ts, node.ts, server.ts, client.ts, permission.ts)
  services/       # mirrors services/ - node.ts, server.ts, templates.ts, token.ts, user.ts,
                  #   permission.ts
  scopes/         # mirrors scopes/ - same ~50 scope constants, same values, same forServer flag
  environments/
    docker/       # mirrors servers/docker
    tty/          # mirrors servers/tty (native pty + Linux namespace isolation)
  web/
    api/          # mirrors web/api/ - Elysia routes, Panel-mode
    daemon/       # mirrors web/daemon/ - Elysia routes, Node-mode
/apps
  panel/          # Elysia server entrypoint; config flag selects Panel-mode / Node-mode / both;
                  #   exports the Eden Treaty type contract
  frontend/       # React + Tailwind v4 + shadcn/ui + Eden Treaty; views mirror
                  #   client/frontend/src/views/ 1:1
```

`client/api/` (PufferPanel's hand-rolled REST+WebSocket JS client) does not get ported.
Eden Treaty replaces its REST half by construction, and Elysia's typed WebSocket
subscriptions replace most of `servers.js`'s socket wrapper (a thin reconnect-on-close
policy layer is still added client-side, since that's app policy, not part of the type
contract).

## Dual-mode architecture (Panel/Node)

PufferPanel upstream does not actually have a separate Panel and Daemon binary: it's one
Go codebase running in one of two modes (`PanelEnabled` config flag / node mode), and
when the node is local (the real `ubuntu-mliem` deployment: one machine runs both), the
panel skips the network and calls the node code in-process via an
`httptest.ResponseRecorder` hack.

The v3-js port keeps this exact pattern: **one Elysia app, a config flag selects
Panel-mode / Node-mode / both.** A `NodeClient` abstraction in `services/` picks its
transport based on `node.local`:

- **Local node**: calls the Node app's `.handle()` directly in-process (Elysia apps are
  directly callable), zero network hop, full type safety, this is strictly better than
  upstream's `ResponseRecorder` simulation.
- **Remote node**: dials the Node app via an Eden Treaty client typed against the Node
  app's route tree.

Every call site in `services/` sees one uniform Eden-Treaty-derived interface regardless
of locality.

## Eden Treaty everywhere

Every internal TS-to-TS call in the system goes through Eden Treaty, not raw `fetch`:

- **Frontend <-> Panel**: Eden Treaty client generated from the Panel app's route types.
- **Panel <-> Node, remote**: Eden Treaty client typed against the Node app's Elysia
  route tree (`treaty<NodeApp>(...)`), with Ed25519-JWT signing wired in as Eden
  Treaty's `headers` hook. Both REST (start/stop/files/backups/tasks/etc.) and the
  WebSocket (console/stats/status) go through Treaty.
- **Panel <-> Node, local**: same Treaty-typed call sites, backed by the in-process
  `.handle()` transport described above.
- **Exception**: the JWKS endpoint stays plain REST (spec-compliant JSON per RFC 7517),
  since its job is interop with a standard, not TS-to-TS type safety.

## Data model (Drizzle + SQLite)

1:1 field mapping from the GORM models. The DB stays a **thin index**, exactly like
upstream, it does not store full server definitions.

- `users`: id, username (unique), email (unique), hashedPassword, otpSecret, otpActive,
  allowPasswordlessLogin, createdAt, updatedAt
- `nodes`: id, name (unique), publicHost, privateHost, publicPort (default 8080),
  privatePort (default 8080), sftpPort (default 5657), secret, createdAt, updatedAt.
  `local` stays a runtime-computed flag, not a column, same as upstream.
- `servers`: name, identifier (PK, <=20 chars), nodeId -> nodes.id, ip, port, type, icon,
  createdAt, updatedAt
- `clients`: id, clientId (unique), hashedClientSecret, userId -> users.id, serverId? ->
  servers.identifier (nullable = global client), name, description, scopes
- `permissions`: id, userId? XOR clientId? (owner), serverIdentifier? (null = global
  grant), rawScopes (comma-joined string column, kept denormalized like upstream, this
  is a faithful port, not a redesign)
- `templates` / `templateRepos`: the special "Local" repo (id 0) stays DB-backed custom
  templates; other repos stay git-cloned folder trees, not database rows.

The real per-server definition (variables, groups, install/uninstall steps, execution
config, environment, requirements, stats, query, keepalive) lives as a JSON file on the
node's disk, typed as a Zod-validated `ServerDefinition` mirroring the Go
`pufferpanel.Server` struct, not in the DB. This is the shape any inherited template or
your live `mliem` server's config needs to match.

## Panel <-> Node protocol

- One shared WebSocket at `GET /api/servers/{id}/socket`, query flags
  `?console`/`?stats`/`?status` select trackers, frames are
  `{type: "console"|"stat"|"status", data: ...}`.
- Auth is a fresh **Ed25519-signed JWT with empty claims** per request (proof the Panel
  holds the private key), not a static shared secret. The Panel's keypair auto-generates
  on first boot; a pure remote node validates via the Panel's public JWKS. Maps onto the
  `jose` library (Ed25519 sign/verify + a JWKS endpoint).
- `nodes.secret` is a one-time OAuth2 client-credentials secret used only for node
  bootstrap/deployment, unrelated to per-request auth.
- REST proxying (remote nodes): forward to `http(s)://{node.privateHost}:{node.privatePort}{path}`
  with a freshly signed JWT; SSL auto-probed via an unauthenticated `OPTIONS /daemon` call.

## Execution environments

Mirrors the `Environment` / `EnvironmentImpl` strategy pattern:

- `Environment` class (ports `environment.go`): owns the console ring buffer, stats
  tracker, and status tracker (the pub/sub sources feeding the WebSocket's
  `console`/`stat`/`status` frames), plus the console stdin transport
  (telnet/rcon/rconws/direct).
- `EnvironmentImpl` interface, same six methods: `executeAsync`, `kill`, `getStats`,
  `sendCode`, `getUid`, `getGid`, `isRunning`.
- Two implementations, same split as upstream:
  - `environments/docker/`: Docker Engine API via Bun's Docker socket support (image,
    binds, network mode).
  - `environments/tty/`: native process via Bun's `spawn` attached to a pty, optional
    Linux namespace isolation. This is almost certainly what the live `mliem` server
    runs under today (matches the "namespace-isolated process" note in infra memory),
    so it's the priority implementation for the eventual migration.
- A node's advertised feature list (`getFeatures`) reports which environments + Docker
  availability it supports, same as upstream's `config.DockerDisallowHost` gating.

## Template system

Kept wire-compatible with the existing ecosystem, deliberately not redesigned:

- Same git-repo-of-folders format: each `TemplateRepo` (except the special
  `Local`/id-0 DB-backed repo) is a cloned git repo where each top-level folder is one
  template, a JSON file matching the `ServerDefinition` shape above.
- Practical win: existing community PufferPanel template repos work unmodified against
  the new node, no template migration needed.
- Listing returns the trimmed `{display, type, environment, supportedEnvironments,
  requirements}` view; fetching a specific template returns the full definition
  (install steps, run command, variables/groups), same two-tier fetch as upstream.

## Auth & scopes

- Same ~50 scope constants ported verbatim (`server.view`, `server.start/stop/kill/
  install/reload`, `server.files.view/edit`, `server.console`/`server.console.send`,
  `server.stats`, `server.status`, `server.backup.*`, `server.tasks.*`,
  `server.clients.*`, `server.users.*`, `server.sftp`, plus non-server scopes like
  `admin`, `nodes.*`, `templates.*`, `users.*`, `server.create`), each carrying the same
  `forServer` flag. `admin` and `server.admin` stay implicit wildcards.
- Enforcement as an Elysia `derive`/`beforeHandle` guard: each route declares its
  required scope, the guard resolves the caller's `permissions` rows (user or client,
  global or server-scoped) and checks membership. The scope *data model* is solid (ported
  1:1); the exact enforcement wiring is faithful-intent (verify against upstream's actual
  middleware call sites before the Phase 1 plan locks it in, the Go check site wasn't
  pinned down by the research pass).

## Frontend

React + Tailwind v4 + shadcn/ui + Eden Treaty, used for every view (dashboard, console,
file manager, admin), not just a subset.

- Same view set as `client/frontend/src/views/`: Login, ServerList, ServerView,
  ServerCreate, NodeList/View/Create, TemplateList/View/Create, UserList/View/Create,
  Self, Settings, Registration, Invite.
- Same ~40 language packs carried over as JSON, wired through a React i18n library.
- Layered on top, the CherryPanel-derived dashboard enhancements: real-time per-server
  player count (WebSocket-driven, anti-spoof log-prefix anchored), kick/ban buttons
  (game-aware, hidden when unsupported), inline dashboard start/stop, CPU/RAM/
  performance-history charts, adjustable refresh interval, theme presets.
- Real-time wiring uses Eden Treaty's typed WS subscription in place of the hand-rolled
  `client/api/src/servers.js` reconnect wrapper, plus a thin client-side
  reconnect-on-close policy layer.

## Open items for Phase 1 planning

- Pin down the exact upstream scope-enforcement middleware call site before finalizing
  the Elysia guard implementation.
- Confirm the community template repository URL(s) currently in use (not found in this
  checkout) so Phase 1 can test against real templates.
- Migration phase (Phase 4) needs to account for `join_transfer_watcher.sh` and
  `transfer_one.sh` on `ubuntu-mliem`, which currently call PufferPanel's REST/console
  API directly and will need updating to the new API.

## Phase breakdown (for context, each gets its own spec/plan)

0. Architecture & contracts (this document)
1. Core Panel: auth, users/OAuth scopes, servers/nodes/templates CRUD, REST + Eden
   Treaty API, Daemon calls stubbed
2. Daemon/Node: Docker + tty execution environments, template execution engine,
   console/log streaming, file access, real Panel<->Node protocol
3. Frontend: React + Tailwind v4 + shadcn/ui + Eden Treaty, full view set plus
   CherryPanel-derived dashboard enhancements
4. Migration/cutover: import the live `mliem` server's data, update
   `join_transfer_watcher.sh`/`transfer_one.sh`, actual production cutover on
   `ubuntu-mliem`
