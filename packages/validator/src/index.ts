/**
 * Shared validation package.
 *
 * Re-exports zod so every app in the monorepo resolves the same instance and
 * version, and exposes the shared domain schemas. Domain schemas are also
 * available under subpaths, e.g. `@repo/validator/user`.
 */
export * from "zod";

export * from "./schemas/common";
export * from "./schemas/user";
