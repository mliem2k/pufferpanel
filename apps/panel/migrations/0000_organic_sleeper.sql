CREATE TABLE `clients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_id` text NOT NULL,
	`hashed_client_secret` text NOT NULL,
	`user_id` integer NOT NULL,
	`server_id` text,
	`name` text NOT NULL,
	`description` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`identifier`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clients_client_id_unique` ON `clients` (`client_id`);--> statement-breakpoint
CREATE TABLE `local_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`definition` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `local_templates_name_unique` ON `local_templates` (`name`);--> statement-breakpoint
CREATE TABLE `nodes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`public_host` text NOT NULL,
	`private_host` text NOT NULL,
	`public_port` integer DEFAULT 8080 NOT NULL,
	`private_port` integer DEFAULT 8080 NOT NULL,
	`sftp_port` integer DEFAULT 5657 NOT NULL,
	`secret` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nodes_name_unique` ON `nodes` (`name`);--> statement-breakpoint
CREATE TABLE `permissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`client_id` integer,
	`server_identifier` text,
	`raw_scopes` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`server_identifier`) REFERENCES `servers`(`identifier`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `servers` (
	`identifier` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`node_id` integer NOT NULL,
	`ip` text NOT NULL,
	`port` integer NOT NULL,
	`type` text NOT NULL,
	`icon` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `template_repos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `template_repos_name_unique` ON `template_repos` (`name`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`email` text NOT NULL,
	`hashed_password` text NOT NULL,
	`otp_secret` text,
	`otp_active` integer DEFAULT false NOT NULL,
	`allow_passwordless_login` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);