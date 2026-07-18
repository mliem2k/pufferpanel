import { Type, type Static } from "@sinclair/typebox";

// Re-exported so consumers (e.g. the templates and daemon modules) can
// validate against this schema via a single import from this file, without
// each needing their own separate import of @sinclair/typebox/value.
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
  environment: Type.Object({ type: Type.String(), image: Type.Optional(Type.String()) }),
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
