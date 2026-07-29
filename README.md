# TN Nalavaariyam Backend

Express + Prisma + MySQL API scaffold for the TN Nalavaariyam rebuild.

## Setup

1. Copy `.env.example` to `.env`.
2. Set `DATABASE_URL` and `JWT_SECRET`.
3. Run `npm run prisma:generate`.
4. Run `npm run dev`.

## Scripts

- `npm run dev` - start API with nodemon.
- `npm start` - start API with node.
- `npm run prisma:generate` - generate Prisma client.
- `npm run prisma:migrate` - run local migrations.
- `npm run prisma:studio` - open Prisma Studio.
