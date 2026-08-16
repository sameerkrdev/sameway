import { z } from "zod";

/** Database primary keys are `Int @default(autoincrement())`. */
export const idSchema = z.coerce.number().int().positive();

/** Route params arrive as strings, so `id` is coerced. */
export const idParamSchema = z.object({
  id: idSchema,
});

export const emailSchema = z.email().trim().toLowerCase();

/** E.164 without the separators, e.g. +919876543210 or 9876543210. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{7,14}$/, "Invalid phone number");

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type IdParam = z.infer<typeof idParamSchema>;
export type Pagination = z.infer<typeof paginationSchema>;
