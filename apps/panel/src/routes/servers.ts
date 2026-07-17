import { Elysia, status, t } from "elysia";
import { SCOPES } from "@pufferpanel/scopes";
import {
  createServer,
  listServers,
  getServerByIdentifier,
  updateServer,
  deleteServer,
} from "@pufferpanel/services/server";
import {
  createNodeClient,
  NodeClientHttpError,
  NodeClientNotImplementedError,
  type NodeClient,
} from "@pufferpanel/services/node-client";
import type { AuthPlugin } from "../auth-plugin";

export function createServerRoutes(
  authPlugin: AuthPlugin,
  createClient: (node: { id: number }) => NodeClient = createNodeClient,
) {
  return new Elysia({ prefix: "/servers" })
    .use(authPlugin)
    .get("/", ({ db }) => listServers(db), { scope: SCOPES.SERVER_VIEW })
    .post(
      "/",
      ({ db, body }) => createServer(db, body),
      {
        scope: SCOPES.SERVER_CREATE,
        body: t.Object({
          identifier: t.String({ maxLength: 20 }),
          name: t.String(),
          nodeId: t.Number(),
          ip: t.String(),
          port: t.Number(),
          type: t.String(),
          icon: t.Optional(t.String()),
        }),
      },
    )
    .get(
      "/:identifier",
      ({ db, params }) => getServerByIdentifier(db, params.identifier),
      { scope: SCOPES.SERVER_VIEW },
    )
    .patch(
      "/:identifier",
      ({ db, params, body }) => updateServer(db, params.identifier, body),
      {
        scope: SCOPES.SERVER_EDIT,
        body: t.Object({
          name: t.Optional(t.String()),
          ip: t.Optional(t.String()),
          port: t.Optional(t.Number()),
          icon: t.Optional(t.String()),
        }),
      },
    )
    .delete(
      "/:identifier",
      async ({ db, params }) => {
        await deleteServer(db, params.identifier);
        return { deleted: true };
      },
      { scope: SCOPES.SERVER_CREATE },
    )
    .post(
      "/:identifier/start",
      async ({ params }) => {
        try {
          return await createClient({ id: 0 }).start(params.identifier);
        } catch (err) {
          if (err instanceof NodeClientNotImplementedError) {
            return status(501, { error: err.message });
          }
          // Branch on literal status codes (rather than `status(err.status, ...)`
          // with the widened `number` from NodeClientHttpError) so Elysia/Eden
          // can still build a precise discriminated response type; anything
          // outside the daemon's known error codes falls through to a 500.
          if (err instanceof NodeClientHttpError) {
            if (err.status === 404) return status(404, { error: err.message });
            if (err.status === 409) return status(409, { error: err.message });
          }
          throw err;
        }
      },
      { scope: SCOPES.SERVER_START },
    )
    .post(
      "/:identifier/stop",
      async ({ params }) => {
        try {
          return await createClient({ id: 0 }).stop(params.identifier);
        } catch (err) {
          if (err instanceof NodeClientNotImplementedError) {
            return status(501, { error: err.message });
          }
          // Branch on literal status codes (rather than `status(err.status, ...)`
          // with the widened `number` from NodeClientHttpError) so Elysia/Eden
          // can still build a precise discriminated response type; anything
          // outside the daemon's known error codes falls through to a 500.
          if (err instanceof NodeClientHttpError) {
            if (err.status === 404) return status(404, { error: err.message });
            if (err.status === 409) return status(409, { error: err.message });
          }
          throw err;
        }
      },
      { scope: SCOPES.SERVER_STOP },
    )
    .get(
      "/:identifier/status",
      async ({ params }) => {
        try {
          return await createClient({ id: 0 }).status(params.identifier);
        } catch (err) {
          if (err instanceof NodeClientNotImplementedError) {
            return status(501, { error: err.message });
          }
          // Branch on literal status codes (rather than `status(err.status, ...)`
          // with the widened `number` from NodeClientHttpError) so Elysia/Eden
          // can still build a precise discriminated response type; anything
          // outside the daemon's known error codes falls through to a 500.
          if (err instanceof NodeClientHttpError) {
            if (err.status === 404) return status(404, { error: err.message });
            if (err.status === 409) return status(409, { error: err.message });
          }
          throw err;
        }
      },
      { scope: SCOPES.SERVER_STATUS },
    );
}
