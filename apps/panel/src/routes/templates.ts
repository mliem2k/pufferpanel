import { Elysia, t } from "elysia";
import { SCOPES } from "@pufferpanel/scopes";
import { ServerDefinition } from "@pufferpanel/core/server-definition";
import {
  createLocalTemplate,
  listLocalTemplates,
  getLocalTemplate,
  deleteLocalTemplate,
} from "@pufferpanel/services/templates";
import type { AuthPlugin } from "../auth-plugin";

export function createTemplateRoutes(authPlugin: AuthPlugin) {
  return new Elysia({ prefix: "/templates" })
    .use(authPlugin)
    .get("/local", ({ db }) => listLocalTemplates(db), { scope: SCOPES.TEMPLATES_VIEW })
    .post(
      "/local",
      ({ db, body }) => createLocalTemplate(db, body),
      {
        scope: SCOPES.TEMPLATES_EDIT,
        body: t.Object({ name: t.String(), definition: ServerDefinition }),
      },
    )
    .get(
      "/local/:name",
      ({ db, params }) => getLocalTemplate(db, params.name),
      { scope: SCOPES.TEMPLATES_VIEW },
    )
    .delete(
      "/local/:name",
      async ({ db, params }) => {
        await deleteLocalTemplate(db, params.name);
        return { deleted: true };
      },
      { scope: SCOPES.TEMPLATES_EDIT },
    );
}
