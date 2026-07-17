export interface Scope {
  value: string;
  forServer: boolean;
}

function scope(value: string, forServer: boolean): Scope {
  return { value, forServer };
}

export const SCOPES = {
  ADMIN: scope("admin", false),
  SERVER_ADMIN: scope("server.admin", true),
  SERVER_CREATE: scope("server.create", false),
  SERVER_VIEW: scope("server.view", true),
  SERVER_EDIT: scope("server.edit", true),
  SERVER_START: scope("server.start", true),
  SERVER_STOP: scope("server.stop", true),
  SERVER_KILL: scope("server.kill", true),
  SERVER_INSTALL: scope("server.install", true),
  SERVER_RELOAD: scope("server.reload", true),
  SERVER_FILES_VIEW: scope("server.files.view", true),
  SERVER_FILES_EDIT: scope("server.files.edit", true),
  SERVER_CONSOLE: scope("server.console", true),
  SERVER_CONSOLE_SEND: scope("server.console.send", true),
  SERVER_STATS: scope("server.stats", true),
  SERVER_STATUS: scope("server.status", true),
  SERVER_BACKUP_VIEW: scope("server.backup.view", true),
  SERVER_BACKUP_EDIT: scope("server.backup.edit", true),
  SERVER_TASKS_VIEW: scope("server.tasks.view", true),
  SERVER_TASKS_EDIT: scope("server.tasks.edit", true),
  SERVER_CLIENTS_VIEW: scope("server.clients.view", true),
  SERVER_CLIENTS_EDIT: scope("server.clients.edit", true),
  SERVER_USERS_VIEW: scope("server.users.view", true),
  SERVER_USERS_EDIT: scope("server.users.edit", true),
  SERVER_SFTP: scope("server.sftp", true),
  NODES_VIEW: scope("nodes.view", false),
  NODES_EDIT: scope("nodes.edit", false),
  NODES_DEPLOY: scope("nodes.deploy", false),
  TEMPLATES_VIEW: scope("templates.view", false),
  TEMPLATES_EDIT: scope("templates.edit", false),
  USERS_VIEW: scope("users.view", false),
  USERS_EDIT: scope("users.edit", false),
  SELF_EDIT: scope("self.edit", false),
  SELF_CLIENTS: scope("self.clients", false),
  SETTINGS_EDIT: scope("settings.edit", false),
} as const;

export type ScopeValue = (typeof SCOPES)[keyof typeof SCOPES]["value"];

export function containsScope(
  granted: string[],
  required: Scope,
  serverIdentifier?: string,
): boolean {
  if (granted.includes(SCOPES.ADMIN.value)) return true;
  if (required.forServer && serverIdentifier && granted.includes(SCOPES.SERVER_ADMIN.value)) {
    return true;
  }
  return granted.includes(required.value);
}
