import { Elysia, t } from "elysia";
import { SCOPES } from "../../scopes";
import {
  createUser,
  listUsers,
  getUserById,
  updateUser,
  deleteUser,
} from "./service";
import type { AuthPlugin } from "../auth/plugin";

export function createUserRoutes(authPlugin: AuthPlugin) {
  return new Elysia({ prefix: "/users" })
    .use(authPlugin)
    .get("/", ({ db }) => listUsers(db), { scope: SCOPES.USERS_VIEW })
    .post(
      "/",
      ({ db, body }) => createUser(db, body),
      {
        scope: SCOPES.USERS_EDIT,
        body: t.Object({
          username: t.String(),
          email: t.String({ format: "email" }),
          password: t.String({ minLength: 8 }),
        }),
      },
    )
    .get(
      "/:id",
      ({ db, params }) => getUserById(db, Number(params.id)),
      { scope: SCOPES.USERS_VIEW },
    )
    .patch(
      "/:id",
      ({ db, params, body }) => updateUser(db, Number(params.id), body),
      {
        scope: SCOPES.USERS_EDIT,
        body: t.Object({ email: t.Optional(t.String({ format: "email" })) }),
      },
    )
    .delete(
      "/:id",
      async ({ db, params }) => {
        await deleteUser(db, Number(params.id));
        return { deleted: true };
      },
      { scope: SCOPES.USERS_EDIT },
    );
}
