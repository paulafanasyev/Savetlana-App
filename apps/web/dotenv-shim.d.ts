/**
 * dotenv is declared only in the monorepo root package.json. When Vercel builds
 * with Root Directory = apps/web it is not installed, and `next build`
 * type-checks every *.ts in this folder (tests/setup.ts, prisma seeds) and
 * fails with "Cannot find module 'dotenv'".
 *
 * The app itself no longer uses dotenv (see src/lib/env.ts). Only dev/test
 * tooling does, and there the real package is installed from the root and
 * takes precedence over this fallback declaration.
 */
declare module "dotenv";
