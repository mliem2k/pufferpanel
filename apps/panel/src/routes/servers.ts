import { Elysia, status, t } from "elysia";
import { SCOPES } from "@pufferpanel/scopes";
import {
  createServer,
  listServers,
  getServerByIdentifier,
  updateServer,
  deleteServer,
} from "@pufferpanel/services/server";
import { createNodeClient, NodeClientNotImplementedError } from "@pufferpanel/services/node-client";
import type { AuthPlugin } from "../auth-plugin";

export function createServerRoutes(authPlugin: AuthPlugin) {
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
          return await createNodeClient({ id: 0 }).start(params.identifier);
        } catch (err) {
          if (err instanceof NodeClientNotImplementedError) {
            return status(501, { error: err.message });
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
          return await createNodeClient({ id: 0 }).stop(params.identifier);
        } catch (err) {
          if (err instanceof NodeClientNotImplementedError) {
            return status(501, { error: err.message });
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
          return await createNodeClient({ id: 0 }).status(params.identifier);
        } catch (err) {
          if (err instanceof NodeClientNotImplementedError) {
            return status(501, { error: err.message });
          }
          throw err;
        }
      },
      { scope: SCOPES.SERVER_STATUS },
    );
}
