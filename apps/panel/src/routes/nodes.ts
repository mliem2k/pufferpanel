import { Elysia, t } from "elysia";
import { SCOPES } from "@pufferpanel/scopes";
import { createNode, listNodes, getNode, updateNode, deleteNode } from "@pufferpanel/services/node";
import type { AuthPlugin } from "../auth-plugin";

export function createNodeRoutes(authPlugin: AuthPlugin) {
  return new Elysia({ prefix: "/nodes" })
    .use(authPlugin)
    .get("/", ({ db }) => listNodes(db), { scope: SCOPES.NODES_VIEW })
    .post(
      "/",
      ({ db, body }) => createNode(db, body),
      {
        scope: SCOPES.NODES_EDIT,
        body: t.Object({
          name: t.String(),
          publicHost: t.String(),
          privateHost: t.String(),
          publicPort: t.Optional(t.Number()),
          privatePort: t.Optional(t.Number()),
          sftpPort: t.Optional(t.Number()),
        }),
      },
    )
    .get("/:id", ({ db, params }) => getNode(db, Number(params.id)), {
      scope: SCOPES.NODES_VIEW,
    })
    .patch(
      "/:id",
      ({ db, params, body }) => updateNode(db, Number(params.id), body),
      {
        scope: SCOPES.NODES_EDIT,
        body: t.Object({
          publicHost: t.Optional(t.String()),
          privateHost: t.Optional(t.String()),
          publicPort: t.Optional(t.Number()),
          privatePort: t.Optional(t.Number()),
        }),
      },
    )
    .delete(
      "/:id",
      async ({ db, params }) => {
        await deleteNode(db, Number(params.id));
        return { deleted: true };
      },
      { scope: SCOPES.NODES_EDIT },
    );
}
