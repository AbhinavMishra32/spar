ALTER TYPE "public"."question_status" ADD VALUE 'abandoned';--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "replaces_question_id" uuid;--> statement-breakpoint
CREATE INDEX "questions_replacement_idx" ON "questions" USING btree ("replaces_question_id");