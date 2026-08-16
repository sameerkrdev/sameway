# `@repo/validator`

Shared zod schemas for the monorepo, plus a re-export of `zod` itself so every
app resolves the same version.

## Usage

```ts
// zod itself
import { z, ZodError } from "@repo/validator";

// shared schemas, via subpath
import { createUserSchema, type CreateUserInput } from "@repo/validator/user";
import { paginationSchema } from "@repo/validator/common";

// or everything from the root
import { z, createUserSchema } from "@repo/validator";
```

Add it to a workspace with `"@repo/validator": "*"` in `dependencies`.

## Adding a domain

1. Create `src/schemas/<domain>.ts`.
2. Add a subpath to `exports` in `package.json`.
3. Re-export it from `src/index.ts`.

Export an inferred type alongside each schema (`z.infer<typeof schema>`) so
consumers don't re-declare shapes.

## Notes

- The package ships raw TypeScript (`exports` points at `src/`), matching
  `@repo/db` and `@repo/logger`. Consumers compile it themselves; Next.js needs
  it listed in `transpilePackages`.
- Schemas are runtime-agnostic — no Express, Prisma, or React imports — so they
  work in `apps/api`, `apps/web`, and the Expo apps alike.
