# Production entrypoint + migration-on-boot + PID-based reattachment

## Context

`apps/panel/src/app.ts` exports `createPanelApp(db, cookieSecret, dataDir)`, which wires
every route module into one Elysia instance. Nothing calls it outside of tests: there is
no `apps/panel/src/index.ts`, no `.listen()` call, and `createDb()`
(`apps/panel/src/db/client.ts`) opens the SQLite file as-is without ever running the
Drizzle migrations in `apps/panel/migrations/` (only the test helper
`db/test-helper.ts` does that today).

Separately, the Panel process has no way to survive its own restart without losing
track of running game servers: `ServerRegistry.createEnvironment`
(`apps/panel/src/modules/servers/daemon/registry.ts`) always constructs a fresh
`TtyEnvironmentImpl` and calls `environment.start(...)`, which would spawn a second,
duplicate game server process on top of one already running from before the restart.

This feature closes both gaps: a real bootable entrypoint, and a narrow
PID-based reattachment mechanism so a Panel restart doesn't orphan or double-spawn
game server processes. Full console reattachment (tailing stdout, resuming stdin) was
explored earlier and dropped after a FIFO-based prototype produced a genuine deadlock
(opening a FIFO for reading blocks until a writer connects, and Bun's stdin-pipe API
gives no way to hand it a pre-opened writer). This feature intentionally reattaches
status/stop/kill/stats only; console access and command-sending are unavailable until
the game server itself is restarted.

## Scope

In scope:
- `apps/panel/src/config.ts` — env-var-driven configuration, with defaults
- Cookie secret: generate once, persist to a file in the data directory, reuse on
  subsequent boots (with an env var override for advanced use)
- `apps/panel/src/db/migrate.ts` — run Drizzle migrations against the real on-disk DB
  on every boot
- `apps/panel/src/bootstrap-admin.ts` — create an initial admin user from env vars,
  only when the `users` table is empty
- `apps/panel/src/index.ts` — the real entrypoint: config → migrate → bootstrap →
  listen, plus graceful shutdown on `SIGTERM`/`SIGINT`
- PID-file-based reattachment: `TtyEnvironmentImpl` writes/removes a PID file next to
  each running server; `ServerRegistry` checks for a live PID before falling back to
  spawning a fresh process; a new `ReattachedEnvironmentImpl` backs a reattached
  `Environment` with status/stop/kill/stats support only

Out of scope (unchanged from the deferred list in
`docs/superpowers/specs/2026-07-18-phase2-daemon-slice1-design.md`): Docker execution
environment, remote-node `NodeClient`, file access, backups/tasks, full console
reattachment across a Panel restart.

## Design

### Config (`apps/panel/src/config.ts`)

A single `loadConfig(): PanelConfig` function reads `process.env` once and returns a
plain object — no class, no singleton, so tests can construct arbitrary configs
directly without touching real env vars.

```ts
interface PanelConfig {
  port: number;           // PANEL_PORT, default 8080
  host: string;           // PANEL_HOST, default "0.0.0.0"
  dbPath: string;         // PANEL_DB_PATH, default "./data/panel.db"
  dataDir: string;        // PANEL_DATA_DIR, default "./data"
  cookieSecret?: string;  // PANEL_COOKIE_SECRET, optional override
  initialAdmin?: { username: string; email: string; password: string };
}
```

`initialAdmin` is populated only if all three of `PANEL_INITIAL_ADMIN_USERNAME`,
`PANEL_INITIAL_ADMIN_EMAIL`, `PANEL_INITIAL_ADMIN_PASSWORD` are set; if exactly one or
two are set (a likely typo), `loadConfig` throws with a message naming the missing
variable(s), since silently ignoring a partial config would leave the operator
believing an admin account was created when it wasn't.

### Cookie secret persistence

A `resolveCookieSecret(dataDir, override?)` function (in `config.ts`): if `override` is
given, return it as-is. Otherwise look for `${dataDir}/cookie-secret`; if it exists,
read and return its contents; if not, generate 32 random bytes
(`crypto.randomBytes(32).toString("hex")`), write them to that path, and return the
new value. The data directory is created (`mkdir(dataDir, {recursive: true})`) before
the write if needed. This mirrors how the existing test helpers already generate an
ad-hoc secret per test run, but persists it so real sessions survive a restart.

### Migration on boot (`apps/panel/src/db/migrate.ts`)

```ts
export function runMigrations(db: PanelDb): void {
  migrate(db, { migrationsFolder: `${import.meta.dir}/../../migrations` });
}
```

Same call the test helper already makes, extracted so both production and tests share
one code path. Called once from `index.ts` right after `createDb()`, before anything
else touches the database.

### Initial admin bootstrap (`apps/panel/src/bootstrap-admin.ts`)

```ts
export async function bootstrapAdmin(db: PanelDb, admin?: PanelConfig["initialAdmin"]): Promise<void> {
  if (!admin) return;
  const existing = await listUsers(db);
  if (existing.length > 0) return;
  const user = await createUser(db, admin);
  await grantScopes(db, { userId: user.id }, [SCOPES.ADMIN.value]);
}
```

Reuses `createUser` (`modules/users/service.ts`) and `grantScopes`
(`modules/auth/permission.ts`) exactly as they exist today — no new user-creation path.
Runs after migrations, before the HTTP server starts listening. Only ever creates an
admin when the table is completely empty, so it's safe to leave the env vars set
across restarts without creating duplicate admins or overwriting real data.

### Entrypoint (`apps/panel/src/index.ts`)

Split into two pieces so it's testable without binding a real port:

```ts
export async function bootstrap(config: PanelConfig) {
  const db = createDb(config.dbPath);
  runMigrations(db);
  await mkdir(config.dataDir, { recursive: true });
  const cookieSecret = await resolveCookieSecret(config.dataDir, config.cookieSecret);
  await bootstrapAdmin(db, config.initialAdmin);
  return createPanelApp(db, cookieSecret, config.dataDir);
}

if (import.meta.main) {
  const config = loadConfig();
  const app = await bootstrap(config);
  app.listen({ port: config.port, hostname: config.host });
  console.log(`panel listening on ${config.host}:${config.port}`);

  const shutdown = () => {
    console.log("shutting down (game servers keep running)");
    app.stop();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
```

`bootstrap()` is the unit tests exercise directly (real temp dir, real in-process
`.handle()` calls, no bound port). The `if (import.meta.main)` block is the only part
that touches a real port and real OS signals, so it stays thin and untested by design
— the same split Bun's own docs recommend for testable entrypoints.

Shutdown deliberately does **not** call `.stop()`/`.kill()` on any tracked
`Environment` — that's the entire point: a running game server process is left alone
so the next boot's `ServerRegistry` can reattach to it instead of losing track of it.

### PID-based reattachment

**`ExecutionData` gains an optional field** (`environment-impl.ts`):
```ts
export interface ExecutionData {
  command: string;
  cwd: string;
  env?: Record<string, string>;
  pidFilePath?: string;
}
```

**`TtyEnvironmentImpl.executeAsync`** writes `this.proc.pid` to `data.pidFilePath` (if
given) right after `Bun.spawn` returns, and removes that file in the existing
`proc.exited.then(...)` handler (best-effort — swallow ENOENT, since a stale file
should never crash a clean exit). No behavior change when `pidFilePath` is omitted
(existing tests that don't pass it keep working unmodified).

**New `ReattachedEnvironmentImpl`** (same file, `tty-environment.ts`), backed by only a
`pid: number` — no `Bun.spawn` handle exists for a process this Panel instance didn't
spawn:
- `isRunning()`: `process.kill(pid, 0)` → `true`; catches `ESRCH` → `false` (the
  standard Node/Bun liveness-check idiom; sending signal `0` performs no actual signal
  delivery, only the permission/existence check)
- `kill()`: `process.kill(pid, "SIGKILL")`
- `sendCode(signal)`: `process.kill(pid, signal)`
- `sendCommand()`: throws `Error("console is unavailable for a reattached server; restart it to regain console access")`
- `getStats()`: `pidusage(pid)`, wrapped in the same try/catch `TtyEnvironmentImpl`
  already uses
- `getUid()`/`getGid()`: return the current process's uid/gid (best-effort — the
  original spawn's identity isn't recoverable from a bare pid, and this Panel only
  ever spawns its own game servers as itself in this slice, matching
  `TtyEnvironmentImpl`'s own behavior)
- `onConsoleLine()`: stores the listener but never invokes it — no stdout stream
  exists to read from
- `onExit()`: since there's no `child_process` handle and thus no `proc.exited`
  promise to await, liveness is polled every 2 seconds (same cadence as
  `Environment`'s existing stats poll) starting immediately at construction (the
  process is known-alive at that point); the first poll that observes
  `isRunning() === false` fires the exit listener once and stops polling.

**`ServerRegistry`** gains `getPidFilePath(identifier)` (`join(dataDir, "servers", identifier, "server.pid")`,
alongside the existing `getServerDir`/`getDefinitionPath`) and `createEnvironment` is
extended:
```ts
private async createEnvironment(identifier: string): Promise<Environment | null> {
  const definition = await this.loadDefinition(identifier);
  if (!definition) return null;
  const pidFilePath = this.getPidFilePath(identifier);
  const stalePid = await readPidFile(pidFilePath); // undefined if file missing/unparseable
  if (stalePid !== undefined && isProcessAlive(stalePid)) {
    const environment = new Environment(new ReattachedEnvironmentImpl(stalePid));
    environment.reattachRunning();
    this.environments.set(identifier, environment);
    return environment;
  }
  if (stalePid !== undefined) await rm(pidFilePath, { force: true }); // dead, stale file
  const environment = new Environment(new TtyEnvironmentImpl());
  this.environments.set(identifier, environment);
  return environment;
}
```
This runs inside the existing `pending`-map-guarded path in `getOrCreateEnvironment`,
so it inherits the same concurrent-call safety already proven in Phase 2 Slice 1 —
no new race surface.

**`Environment`** gains `reattachRunning(): void` — sets status to
`{running: true, installing: false}`, emits `"status"`, and starts stats polling,
without calling `impl.executeAsync` (there's nothing to execute; the process already
exists). It does not touch `startInFlight`, since reattachment happens once inside
`createEnvironment` and never races a concurrent `start()` call for the same
identifier — the `pending` map already serializes that.

**`node-app.ts`**'s `POST /servers/:identifier/start` handler passes
`pidFilePath: registry.getPidFilePath(params.identifier)` in the `ExecutionData` object
it builds today. No other route changes — `stop`/`status`/the WebSocket route already
operate purely through the `Environment`/`EnvironmentImpl` interface and work
identically regardless of which impl backs it.

## Testing

- `config.ts`: defaults, env var overrides, partial-`initialAdmin` throws, cookie
  secret generate-once-then-reused-on-second-call-with-same-dataDir
- `db/migrate.ts`: running against a fresh on-disk sqlite file leaves the schema
  queryable (e.g. `listUsers` returns `[]` without throwing)
- `bootstrap-admin.ts`: creates the admin + grants `ADMIN` scope when the table is
  empty; no-op (and no duplicate) when a user already exists; verified via a real
  login through `verifyPassword` afterward, not just a row count
- `index.ts`'s `bootstrap()`: full wiring smoke test — real temp `dataDir`, in-process
  `.handle()` call against a route that requires auth, confirms migrations +
  admin bootstrap + cookie secret all actually ran
- `ReattachedEnvironmentImpl`: spawn a real short-lived throwaway process (e.g.
  `sleep 5` via `Bun.spawn` in the test itself, detached from any `Environment`) to get
  a real pid; verify `isRunning()`, `kill()`, `getStats()`, `sendCommand()` throwing,
  and `onExit()` firing after `kill()`
- Acceptance test (the actual "Panel restart" scenario): start a server through one
  `ServerRegistry` instance pointed at a temp `dataDir`; discard that registry instance
  (simulating the Panel process dying) while the real child process keeps running;
  construct a **fresh** `ServerRegistry` against the same `dataDir`; confirm
  `getOrCreateEnvironment` returns an `Environment` reporting `running: true` without
  spawning a second process — verified by having the test's spawned process write a
  one-time marker file on start, then asserting that marker file's mtime/content is
  unchanged after reattachment; confirm `stop()` and `status` both work through the
  reattached instance
- Stale-PID-file cleanup: write a PID file containing a pid that is guaranteed dead
  (e.g. spawn a process, wait for it to exit, reuse its now-dead pid), confirm
  `createEnvironment` falls back to spawning fresh via `TtyEnvironmentImpl` and removes
  the stale file

## Self-review notes

- No placeholders remain; every field/function above has a concrete default or
  behavior.
- Checked for contradictions with the Phase 2 Slice 1 design doc: none — this only
  adds an optional field to `ExecutionData` and a new `EnvironmentImpl`, it doesn't
  change either existing implementation's contract.
- Scope check: this is one coherent vertical slice (boot path + reattachment), small
  enough for a single implementation plan — not decomposing further.
- Ambiguity check: "reattachment" is defined precisely as status/stop/kill/stats only,
  with `sendCommand` throwing and console callbacks never firing, so there's no
  reading of this doc under which console reattachment is silently expected.
