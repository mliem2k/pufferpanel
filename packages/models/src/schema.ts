import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  hashedPassword: text("hashed_password").notNull(),
  otpSecret: text("otp_secret"),
  otpActive: integer("otp_active", { mode: "boolean" }).notNull().default(false),
  allowPasswordlessLogin: integer("allow_passwordless_login", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const nodes = sqliteTable("nodes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  publicHost: text("public_host").notNull(),
  privateHost: text("private_host").notNull(),
  publicPort: integer("public_port").notNull().default(8080),
  privatePort: integer("private_port").notNull().default(8080),
  sftpPort: integer("sftp_port").notNull().default(5657),
  secret: text("secret").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const servers = sqliteTable("servers", {
  identifier: text("identifier").primaryKey(),
  name: text("name").notNull(),
  nodeId: integer("node_id")
    .notNull()
    .references(() => nodes.id),
  ip: text("ip").notNull(),
  port: integer("port").notNull(),
  type: text("type").notNull(),
  icon: text("icon"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const clients = sqliteTable("clients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: text("client_id").notNull().unique(),
  hashedClientSecret: text("hashed_client_secret").notNull(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  serverId: text("server_id").references(() => servers.identifier),
  name: text("name").notNull(),
  description: text("description"),
});

export const permissions = sqliteTable("permissions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").references(() => users.id),
  clientId: integer("client_id").references(() => clients.id),
  serverIdentifier: text("server_identifier").references(() => servers.identifier),
  rawScopes: text("raw_scopes").notNull().default(""),
});

export const templateRepos = sqliteTable("template_repos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  url: text("url").notNull(),
});

export const localTemplates = sqliteTable("local_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  definition: text("definition", { mode: "json" }).notNull(),
});
