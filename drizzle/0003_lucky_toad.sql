CREATE TABLE `directive_records` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`case_id` text NOT NULL,
	`request_key` text NOT NULL,
	`reference` text NOT NULL,
	`data` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `directive_owner_request` ON `directive_records` (`owner`,`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `directive_case_reference` ON `directive_records` (`case_id`,`reference`);--> statement-breakpoint
CREATE INDEX `directive_owner_case` ON `directive_records` (`owner`,`case_id`);--> statement-breakpoint
CREATE TABLE `intake_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`request_key` text NOT NULL,
	`visa_number` text NOT NULL,
	`data` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `intake_owner_request` ON `intake_requests` (`owner`,`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `intake_owner_visa` ON `intake_requests` (`owner`,`visa_number`);