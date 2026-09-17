import { config as reactInternalConfig } from "@repo/eslint-config/react-internal";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...reactInternalConfig,
  {
    ignores: ["dist/**", "src/components/ui/**"],
  },
  {
    rules: {
      // Prop shapes are enforced by TypeScript, not by runtime propTypes.
      "react/prop-types": "off",
      "@typescript-eslint/consistent-type-imports": "off",
    },
  },
  {
    // The matching engine must stay portable to Node and to a future backend
    // service, so h3-js access is funnelled through the single lib/h3.ts wrapper.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/h3.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "h3-js",
              message: "Import H3 helpers from '@/lib/h3' instead of h3-js directly.",
            },
          ],
        },
      ],
    },
  },
];
