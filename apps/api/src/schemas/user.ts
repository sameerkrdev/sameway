import { z } from "@repo/zod";

export const userIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional(),
});

export const updateUserSchema = z
  .object({
    email: z.string().email().optional(),
    name: z.string().min(1).nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });
