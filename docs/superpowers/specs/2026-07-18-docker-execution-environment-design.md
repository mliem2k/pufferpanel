# Docker execution environment

## Context

`apps/panel/src/modules/servers/daemon/` currently has two `EnvironmentImpl`
implementations: `TtyEnvironmentImpl` (spawns a real OS process via `Bun.spawn`) and
`ReattachedEnvironmentImpl` (reconnects to a process that outlived a Panel restart,
via a recorded pid). `ServerDefinition.environment` (`apps/panel/src/modules/templates/server-definition.ts`)
already carries a `{type: string}` discriminator and `supportedEnvironments` list, but
`ServerRegistry.createEnvironment` (`apps/panel/src/modules/servers/daemon/registry.ts`)
ignores it entirely and always constructs a `TtyEnvironmentImpl` for a fresh spawn.

This feature adds a third implementation, `DockerEnvironmentImpl`, so a server can run
inside a Docker container instead of directly on the host, and wires `ServerRegistry`
to actually dispatch on `environment.type`.

Every claim below about how the Docker Engine API behaves under Bun was verified
empirically against a real local Docker daemon (OrbStack, Docker Engine 29.4.0, API
1.54) before being written into this spec, following this project's established
"verify empirically before writing into a plan" discipline (the same discipline that
caught Elysia's cookie-propagation bug and the FIFO stdin deadlock in earlier phases).

## Scope

In scope:
- `DockerEnvironmentImpl` implementing the existing `EnvironmentImpl` interface
  (`apps/panel/src/modules/servers/daemon/environment-impl.ts`), unmodified
- A thin Docker Engine API client used only by this file
- `ServerDefinition.environment` gains an optional `image` field
- `ServerRegistry.createEnvironment` dispatches on `environment.type` for both the
  fresh-spawn path and (for Docker) its own name-based reattachment check
- Host networking only (no port-mapping config surface)
- Arbitrary `execution.command` run inside the given image (same model as tty), not
  an image's own entrypoint/env-var-driven startup

Out of scope (deferred): port-mapping/bridge networking, image pulling/registry auth
(the image must already exist locally — matches this project's current single-admin
trust tier, same reasoning already accepted for template `command` shell injection),
resource limits (memory/cpu caps), volumes beyond the one server-files bind mount,
Windows containers, remote Docker hosts (only a local Unix socket).

## Design

### Docker Engine API access

A new small module, `apps/panel/src/modules/servers/daemon/docker-client.ts`, wraps
the socket path (default `/var/run/docker.sock`, overridable via `PANEL_DOCKER_SOCKET`)
behind a handful of functions used only by `DockerEnvironmentImpl`:

- `dockerFetch(path, init)`: thin wrapper over `fetch(`http://localhost${path}`, {...init, unix: socketPath})`.
  Confirmed empirically that Bun's `fetch()` accepts a `unix` option and correctly
  routes the request over the Unix socket — every simple request/response endpoint
  (`create`, `start`, `kill`, `json` (inspect), `stats`, delete) uses this.
- `attach(containerId)`: opens the one exception, `POST /containers/{id}/attach?stream=1&stdin=1&stdout=1&stderr=1`,
  as a raw `Bun.connect({unix: socketPath})` connection, since this endpoint hijacks
  the HTTP connection into a raw duplex byte stream once upgraded (a `101 UPGRADED`
  response), not a normal request/response — `fetch()` cannot represent this.
  Confirmed empirically: writing to this connection after creating a container with
  `OpenStdin: true` reaches the container's stdin (echoed back through its stdout in
  a real test), and killing the container closes this connection from the server side
  within ~500ms.

### Container lifecycle mapped to `EnvironmentImpl`

- **`executeAsync(data)`**: `POST /containers/create?name=pufferpanel-<identifier>`
  with body `{Image: environment.image, Cmd: tokenizeCommand(data.command), WorkingDir: "/data", HostConfig: {NetworkMode: "host", Binds: [`${data.cwd}:/data`]}, OpenStdin: true, StdinOnce: false, Tty: false}`
  (reusing the existing `tokenizeCommand` from `tty-environment.ts`, unmodified),
  then `POST /containers/{id}/start`, then open one `attach()` connection for the
  container's whole lifetime — mirroring `TtyEnvironmentImpl`'s single-process-handle
  model, where one handle covers stdin, stdout, and stderr together.
- **`sendCommand(command)`**: write `${command}\n` to the attach connection.
- **`onConsoleLine(listener)`**: the attach connection's incoming bytes are
  Docker's multiplexed stream format — an 8-byte header per frame (1 byte stream type,
  3 padding bytes, 4-byte big-endian payload length) followed by that many bytes of
  payload — confirmed by inspecting real frames from a running container. A demuxer
  strips these headers before handing payload bytes to the same line-buffering logic
  `TtyEnvironmentImpl.pumpLines` already uses.
- **`onExit(listener)`**: the attach connection's own `close` event fires the exit
  listener directly — confirmed empirically that killing a container closes this
  connection from the Docker daemon's side in real time. No polling needed at all,
  unlike `ReattachedEnvironmentImpl`'s 2-second liveness poll (which has no live
  connection to observe).
- **`kill()`**: `POST /containers/{id}/kill` (defaults to SIGKILL).
- **`sendCode(signal)`**: `POST /containers/{id}/kill?signal=<signal>`.
- **`getStats()`**: `POST /containers/{id}/stats?stream=false` — confirmed this
  single call's JSON body already contains both `cpu_stats` and `precpu_stats`
  (Docker internally samples twice before returning), so the standard cpu% delta
  formula (`(cpu_stats.cpu_usage.total_usage - precpu_stats.cpu_usage.total_usage) / (cpu_stats.system_cpu_usage - precpu_stats.system_cpu_usage) * online_cpus * 100`)
  is computable from one request, matching `docker stats --no-stream`'s own math.
  `memory_stats.usage` maps directly to `ServerStats.memory`.
- **`isRunning()`**: `GET /containers/{id}/json`, check `.State.Running`.
- **`getUid()`/`getGid()`**: return `0`/`0` (the container's own root user; the
  bind-mounted files directory's actual on-host ownership is a separate, deferred
  concern — matches this slice's scope, not addressed here).

### Schema change

`ServerDefinition.environment` (`server-definition.ts`) becomes
`Type.Object({type: Type.String(), image: Type.Optional(Type.String())})`. No
TypeBox-level "required when type is docker" validation — `ServerRegistry` checks
this in code and fails the same way `loadDefinition` already fails on any other
malformed/incomplete definition (returns `null`, surfaced as a 404 by the route).

### Reattachment (no pid file needed)

Docker containers are addressable by a stable, deterministic name across a Panel
restart — `pufferpanel-<identifier>`, assigned at creation. This means Docker
reattachment needs none of the pid-file bookkeeping tty reattachment required: on a
fresh access, `ServerRegistry` (for a `"docker"`-typed definition) does
`GET /containers/pufferpanel-<identifier>/json`; if that container exists and
`.State.Running` is true, construct `DockerEnvironmentImpl` around that container ID,
open a fresh `attach()` connection to it (reattaching to console/exit-detection is
just reopening the same attach endpoint — Docker doesn't require the original
attacher to still be connected), and call `environment.reattachRunning()` (the same
method built for tty reattachment in the prior feature) — no separate
`ReattachedEnvironmentImpl`-style class needed, since the ordinary
`DockerEnvironmentImpl` already works identically whether it just started the
container or is reattaching to one that was already running. If the container
doesn't exist or isn't running, fall through to a fresh `executeAsync` (i.e. use the
same `DockerEnvironmentImpl`, just via `create`+`start`+`attach` instead of an
`attach`-only reconnect).

This also sidesteps the whole "reattached environment can never restart" class of
bug the final review caught for tty reattachment (fixed via cache eviction in the
prior feature) — a Docker-backed `Environment` is always the same class, so
`executeAsync` never permanently throws for it; a dead container's identifier simply
isn't found on the next `GET .../json` and falls through to a fresh create+start.

### `ServerRegistry` wiring

`createEnvironment`'s fresh-spawn branch (`new Environment(new TtyEnvironmentImpl())`)
becomes a dispatch on `definition.environment.type`: `"docker"` → the new Docker
path described above (name-based reattach-or-create), anything else (including the
existing `"tty"`) → the existing tty/pid-file path, completely unchanged.

## Testing

- `docker-client.ts`: unit tests against a real local Docker daemon (this repo's CI/dev
  environment already has Docker available, confirmed) — create/start/inspect/stats/kill
  a real `alpine` container, confirm the multiplexed-stream demuxer parses real frames
  correctly, confirm the attach connection's `close` event fires within a bounded time
  after `kill()`.
- `DockerEnvironmentImpl`: same real-process-only testing discipline as
  `TtyEnvironmentImpl`'s own tests — spawn a real container, exercise
  isRunning/getStats/sendCommand/onConsoleLine/onExit/kill against it, no mocking of
  the Docker API.
- `ServerRegistry`: a definition with `environment: {type: "docker", image: "alpine"}`
  reattaches to (or freshly creates) a real container, mirroring the existing
  tty-focused registry tests.
- An acceptance test analogous to the tty reattachment one: start a Docker-backed
  server, "restart" the Panel (fresh `ServerRegistry` against the same `dataDir`),
  confirm the same container is reattached to (not a second one created) via the
  deterministic container name.

## Self-review notes

- No placeholders — every endpoint, field, and behavior above is concrete and was
  independently verified against a real Docker daemon, not assumed from documentation.
- Checked for contradictions with the existing `EnvironmentImpl` contract: none — the
  interface is unmodified; `DockerEnvironmentImpl` implements it exactly like the
  other two.
- Scope check: one coherent vertical slice (one new impl + one schema field + one
  registry dispatch), similar size to Phase 2 Slice 1 — not decomposing further.
- Ambiguity check: "host networking only" and "arbitrary command, not entrypoint-driven"
  are both explicit, closing off the two most likely double-readings of this design.
