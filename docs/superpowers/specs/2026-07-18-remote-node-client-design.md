# Remote-node NodeClient

## Context

`apps/panel/src/modules/servers/daemon/node-client.ts` defines the `NodeClient`
interface (`start`/`stop`/`status`) that both the local and a future remote
implementation share. `local-node-client.ts` already implements it for the
co-located node by calling `createNodeApp(registry)`'s `.handle()` directly
in-process, with no network hop and no auth. `createNodeClient` (the factory
`servers/index.ts` is written against) has only ever been a stub
(`NotImplementedNodeClient`), and `servers/index.ts`'s three daemon-action routes
(`start`/`stop`/`status`) currently call `createClient({ id: 0 })` unconditionally,
completely ignoring which node a server actually lives on (`servers.nodeId` in the
schema is never consulted for this).

Separately, `apps/panel/src/modules/auth/node-token.ts` already implements Ed25519
JWT signing/verification (`generateNodeKeyPair`, `signPanelToken`,
`verifyPanelToken`) — built during Phase 1 specifically for this feature, per the
original Phase 0 architecture doc's decision to authenticate panel-to-node calls
with a signed token — but nothing in the codebase calls any of these three functions
yet. `nodes.secret` (schema.ts) is written by `createNode` but never read by any
route; it was a placeholder for exactly the credential this feature needs to
replace with something real.

## Scope

In scope:
- `nodes` schema: replace the unused `secret` column with `nodePrivateKeyPem` and
  `nodePublicKeyJwk`, generated once via `generateNodeKeyPair()` when a node is
  created
- `createRemoteNodeClient(node)`: a real `NodeClient` implementation using Eden
  Treaty (`treaty()`) against `http://{publicHost}:{publicPort}`, signing every
  request with a fresh Ed25519 JWT
- `createNodeAuthPlugin(publicKeyJwk)`: a composable Elysia plugin verifying that
  JWT, returning 401 on anything missing/invalid — layered on top of
  `createNodeApp`, not baked into it, so the existing local in-process path is
  untouched
- Real per-server node routing in `servers/index.ts`: load the server's `nodeId`,
  dispatch to the existing local client for node id `0`, or the new remote client
  for any other real node row
- End-to-end testing via two real Elysia HTTP servers on different local ports in
  the same test process (a genuine network round trip, no second machine needed)

Out of scope (deferred): a standalone deployable "node-mode" entrypoint (a way to
actually run just the daemon routes as an independent process on a second machine);
per-action JWT scoping (this slice's token proves "this really is the registered
Panel," not which specific action is being authorized); token caching/reuse across
requests (a fresh token is signed per request — Ed25519 signing is cheap, and this
avoids any cache-invalidation complexity for a first slice).

## Design

### Schema change

`nodes` (`db/schema.ts`) drops `secret: text("secret").notNull()` (confirmed unused
by any route today) and gains:
```ts
nodePrivateKeyPem: text("node_private_key_pem").notNull(),
nodePublicKeyJwk: text("node_public_key_jwk").notNull(), // JSON-serialized JWK
```
`createNode` (`nodes/service.ts`) calls `generateNodeKeyPair()` once and stores
both halves. The public key is what a real remote node's own config would need
(out of scope for this slice, since there's no standalone node-mode entrypoint to
configure yet) — for now both halves simply live in the Panel's DB, which is
sufficient for this slice's own test harness (a "fake remote node" test double
constructed in-process needs the public half to verify against, and the real
remote client needs the private half to sign with).

### `createRemoteNodeClient`

New file, `apps/panel/src/modules/servers/daemon/remote-node-client.ts`:
```ts
export function createRemoteNodeClient(node: {
  publicHost: string;
  publicPort: number;
  nodePrivateKeyPem: string;
}): NodeClient
```
Uses `@elysiajs/eden`'s `treaty()` typed against `NodeApp` (the same type
`local-node-client.ts` already imports), pointed at
`http://${node.publicHost}:${node.publicPort}`. Before each call, signs a fresh
token via `signPanelToken(node.nodePrivateKeyPem)` and passes it as
`headers: { authorization: `Bearer ${token}` }`. Maps Eden's typed error responses
to `NodeClientHttpError` exactly the way `local-node-client.ts` already does for
its own raw-`fetch`-shaped errors, so both implementations produce identical error
types for `servers/index.ts` to branch on.

### `createNodeAuthPlugin`

New file, `apps/panel/src/modules/auth/node-auth-plugin.ts`:
```ts
export function createNodeAuthPlugin(publicKeyJwk: Record<string, unknown>) {
  return new Elysia({ name: "node-auth-plugin" }).onBeforeHandle(async ({ headers, set }) => {
    const auth = headers.authorization;
    const token = auth?.startsWith("Bearer ") ? auth.slice(7) : undefined;
    if (!token || !(await verifyPanelToken(token, publicKeyJwk))) {
      set.status = 401;
      return { error: "unauthenticated" };
    }
  });
}
```
Composed as `new Elysia().use(createNodeAuthPlugin(publicKeyJwk)).use(createNodeApp(registry))`
wherever a node app is exposed over a real network boundary. `createNodeApp` itself
is never modified — the existing local in-process `.handle()` path (used by
`createLocalNodeClient`) has no auth header today and continues to need none, since
it never crosses a process boundary.

### Real per-server node routing

`servers/index.ts`'s `createServerRoutes` currently takes
`createClient: (node: { id: number }) => NodeClient = createNodeClient` and calls
it as `createClient({ id: 0 })` in all three daemon-action routes, ignoring the
actual server. This becomes: load the server row (`getServerByIdentifier`, already
used elsewhere in this file) to get `nodeId`; if `nodeId === 0`, call the existing
local client; otherwise load the node row (`getNode` from `nodes/service.ts`,
extended to also return the two new key columns for internal use — a
Panel-internal accessor separate from the existing public-column-projected
`getNode` used by the `/nodes` HTTP routes, which must keep never exposing the
private key over the API) and construct `createRemoteNodeClient(nodeRow)`.
`createPanelApp` (`app.ts`) wires the real dispatcher in place of today's
`() => localClient` constant function.

## Testing

- `remote-node-client.ts`: a real two-Elysia-server test — one instance is
  `createNodeApp(registry)` wrapped in `createNodeAuthPlugin`, bound to a real port
  via `.listen()`; the other is `createRemoteNodeClient` pointed at that port,
  exercising start/stop/status against a real spawned tty process over real HTTP,
  matching this project's established no-mocking discipline.
- `node-auth-plugin.ts`: a request with no `Authorization` header, a malformed
  token, and a token signed with the WRONG keypair all get 401; a token signed with
  the correct keypair passes through to the wrapped route.
- `nodes/service.ts`: `createNode` generates and persists a real, distinct keypair
  per node; the public `nodes` HTTP routes never leak the private key or raw JWK in
  their response bodies (mirrors the existing `publicColumns` pattern already used
  for `users`/`nodes`).
- `servers/index.ts`: an acceptance test with a server on node id `0` still uses the
  local in-process path (no regression), and a server on a real remote node id
  correctly reaches a second, independently-running Elysia instance over real HTTP.

## Self-review notes

- No placeholders — every function signature, schema column, and route change
  above is concrete.
- Checked for contradictions with the existing `NodeClient` interface: none — both
  implementations satisfy the same unmodified interface, matching the Phase 0
  design's explicit intent.
- Scope check: one coherent vertical slice (client + auth + routing), comparable in
  size to the Docker execution environment feature — not decomposing further.
- Ambiguity check: "local node id 0" and "no standalone node-mode entrypoint" are
  both stated explicitly, closing off the two most likely scope misreadings.
