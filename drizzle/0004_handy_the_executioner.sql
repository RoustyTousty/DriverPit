ALTER TABLE "drivers" ALTER COLUMN "last_active_year" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "drivers" DROP COLUMN "is_eligible";