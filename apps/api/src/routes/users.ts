import { Router } from "express";
import createHttpError from "http-errors";
import { prisma } from "@repo/db";
import { validate } from "../middleware/validate";
import {
  createUserSchema,
  updateUserSchema,
  userIdParamSchema,
} from "../schemas/user";

export const usersRouter = Router();

usersRouter.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { id: "asc" },
  });
  res.json(users);
});

usersRouter.get(
  "/:id",
  validate({ params: userIdParamSchema }),
  async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: Number(req.params.id) },
    });

    if (!user) {
      throw createHttpError(404, "User not found");
    }

    res.json(user);
  },
);

usersRouter.post(
  "/",
  validate({ body: createUserSchema }),
  async (req, res) => {
    const user = await prisma.user.create({ data: req.body });
    res.status(201).json(user);
  },
);

usersRouter.patch(
  "/:id",
  validate({ params: userIdParamSchema, body: updateUserSchema }),
  async (req, res) => {
    const user = await prisma.user.update({
      where: { id: Number(req.params.id) },
      data: req.body,
    });
    res.json(user);
  },
);

usersRouter.delete(
  "/:id",
  validate({ params: userIdParamSchema }),
  async (req, res) => {
    await prisma.user.delete({
      where: { id: Number(req.params.id) },
    });
    res.status(204).send();
  },
);
