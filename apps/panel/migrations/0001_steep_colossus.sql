ALTER TABLE `nodes` ADD `node_private_key_pem` text NOT NULL;--> statement-breakpoint
ALTER TABLE `nodes` ADD `node_public_key_jwk` text NOT NULL;--> statement-breakpoint
ALTER TABLE `nodes` DROP COLUMN `secret`;