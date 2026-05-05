import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const callsTable = pgTable("calls", {
  id: serial("id").primaryKey(),
  transcript: text("transcript").notNull(),
  issue: text("issue").notNull(),
  emotion: text("emotion").notNull(),
  language: text("language").notNull(),
  urgency: text("urgency"),
  confidence: integer("confidence"),
  level: integer("level"),
  feedback: text("feedback"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCallSchema = createInsertSchema(callsTable).omit({ id: true, createdAt: true });
export type InsertCall = z.infer<typeof insertCallSchema>;
export type Call = typeof callsTable.$inferSelect;
