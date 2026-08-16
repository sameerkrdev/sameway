import { z } from "zod";
import { emailSchema, idParamSchema } from "./common";

export const userIdParamSchema = idParamSchema;

export const userNameSchema = z.string().trim().min(1);

export const createUserSchema = z.object({
  email: emailSchema,
  name: userNameSchema.optional(),
});

export const updateUserSchema = z
  .object({
    email: emailSchema.optional(),
    name: userNameSchema.nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

export type UserIdParam = z.infer<typeof userIdParamSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
