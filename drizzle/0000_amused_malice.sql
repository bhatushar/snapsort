CREATE TABLE `auth` (
	`password` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cities_name_unique` ON `cities` (`name`);--> statement-breakpoint
CREATE TABLE `countries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `countries_name_unique` ON `countries` (`name`);--> statement-breakpoint
CREATE TABLE `keywords` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`keyword` text NOT NULL,
	`category` text NOT NULL,
	`is_folder_label` integer DEFAULT false NOT NULL,
	`location_id` integer,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "location_check" CHECK(("keywords"."category" = 'Location' AND "keywords"."location_id" IS NOT NULL) OR ("keywords"."category" != 'Location' AND "keywords"."location_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `keywords_keyword_unique` ON `keywords` (`keyword`);--> statement-breakpoint
CREATE TABLE `library_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`mime_type` text NOT NULL,
	`capture_date_time` integer NOT NULL,
	`timezone` text NOT NULL,
	`title` text,
	`latitude` real,
	`longitude` real,
	`altitude` real,
	CONSTRAINT "mime_type_check" CHECK(("library_files"."mime_type" LIKE 'image/%') OR ("library_files"."mime_type" LIKE 'video/%')),
	CONSTRAINT "lat_long_check" CHECK(("library_files"."latitude" IS NULL AND "library_files"."longitude" IS NULL) OR ("library_files"."latitude" IS NOT NULL AND "library_files"."longitude" IS NOT NULL)),
	CONSTRAINT "altitude_check" CHECK(("library_files"."latitude" IS NOT NULL) OR ("library_files"."altitude" IS NULL)),
	CONSTRAINT "latitude_min_check" CHECK("library_files"."latitude" >= -90.0),
	CONSTRAINT "latitude_max_check" CHECK("library_files"."latitude" <= 90.0),
	CONSTRAINT "longitude_min_check" CHECK("library_files"."longitude" >= -180.0),
	CONSTRAINT "longitude_max_check" CHECK("library_files"."longitude" <= 180.0)
);
--> statement-breakpoint
CREATE TABLE `library_files_to_keywords` (
	`file_id` integer NOT NULL,
	`keyword_id` integer NOT NULL,
	PRIMARY KEY(`file_id`, `keyword_id`),
	FOREIGN KEY (`file_id`) REFERENCES `library_files`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`keyword_id`) REFERENCES `keywords`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `locations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`city_id` integer,
	`state_id` integer,
	`country_id` integer NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`altitude` real,
	FOREIGN KEY (`city_id`) REFERENCES `cities`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`state_id`) REFERENCES `states`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`country_id`) REFERENCES `countries`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "city_without_state_check" CHECK(("locations"."state_id" IS NOT NULL) OR ("locations"."city_id" IS NULL)),
	CONSTRAINT "latitude_min_check" CHECK("locations"."latitude" >= -90.0),
	CONSTRAINT "latitude_max_check" CHECK("locations"."latitude" <= 90.0),
	CONSTRAINT "longitude_min_check" CHECK("locations"."longitude" >= -180.0),
	CONSTRAINT "longitude_max_check" CHECK("locations"."longitude" <= 180.0)
);
--> statement-breakpoint
CREATE TABLE `queued_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`thumbnail_path` text NOT NULL,
	`mime_type` text NOT NULL,
	`capture_date_time` integer,
	`timezone` text,
	`title` text,
	`latitude` real,
	`longitude` real,
	`altitude` real,
	CONSTRAINT "mime_type_check" CHECK(("queued_files"."mime_type" LIKE 'image/%') OR ("queued_files"."mime_type" LIKE 'video/%')),
	CONSTRAINT "latitude_min_check" CHECK("queued_files"."latitude" >= -90.0),
	CONSTRAINT "latitude_max_check" CHECK("queued_files"."latitude" <= 90.0),
	CONSTRAINT "longitude_min_check" CHECK("queued_files"."longitude" >= -180.0),
	CONSTRAINT "longitude_max_check" CHECK("queued_files"."longitude" <= 180.0)
);
--> statement-breakpoint
CREATE TABLE `queued_files_to_keywords` (
	`file_id` integer NOT NULL,
	`keyword_id` integer NOT NULL,
	PRIMARY KEY(`file_id`, `keyword_id`),
	FOREIGN KEY (`file_id`) REFERENCES `queued_files`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`keyword_id`) REFERENCES `keywords`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `states` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `states_name_unique` ON `states` (`name`);