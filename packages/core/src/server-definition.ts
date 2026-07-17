import { Type, type Static } from "@sinclair/typebox";

// Re-exported so consumers (e.g. @pufferpanel/services, which does not
// declare @sinclair/typebox as a direct dependency) can validate against
// this schema via `@pufferpanel/core/server-definition` without needing
// their own node_modules resolution path to the typebox package.
export { Value } from "@sinclair/typebox/value";

export const InstallStep = Type.Union([
  Type.Object({
    type: Type.Literal("download"),
    url: Type.String(),
    targetPath: Type.String(),
  }),
  Type.Object({
    type: Type.Literal("command"),
    command: Type.String(),
  }),
]);

export type InstallStepType = Static<typeof InstallStep>;

export const ServerDefinition = Type.Object({
  type: Type.String(),
  display: Type.String(),
  environment: Type.Object({ type: Type.String() }),
  supportedEnvironments: Type.Array(Type.Object({ type: Type.String() })),
  variables: Type.Record(
    Type.String(),
    Type.Object({
      display: Type.String(),
      description: Type.Optional(Type.String()),
      value: Type.Unknown(),
      type: Type.String(),
      userEdit: Type.Optional(Type.Boolean()),
    }),
  ),
  execution: Type.Object({
    command: Type.String(),
    stopCommand: Type.Optional(Type.String()),
    autoStart: Type.Optional(Type.Boolean()),
    autoRestartFromCrash: Type.Optional(Type.Boolean()),
  }),
  installation: Type.Optional(Type.Array(InstallStep)),
  uninstallation: Type.Optional(Type.Array(InstallStep)),
});

export type ServerDefinitionType = Static<typeof ServerDefinition>;
