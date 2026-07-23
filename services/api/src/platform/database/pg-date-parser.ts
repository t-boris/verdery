/**
 * Makes `node-postgres` return `date` (OID 1082) columns as the raw
 * `'YYYY-MM-DD'` string PostgreSQL sends, not the timezone-sensitive JS
 * `Date` object `pg`'s own default date parser constructs (`new Date(year,
 * month, day)`, interpreted in the server process's *local* timezone, not
 * UTC) — a well-known footgun for a calendar-only value: reading it back
 * through `.getUTCDate()` (or `.toISOString()`) can silently land on the
 * wrong calendar day whenever the process's local offset is positive
 * (east of UTC).
 *
 * `plants_inventory.plant.acquisition_date` is a calendar date, not an
 * instant — nothing about it should ever be reinterpreted through a
 * timezone. Every Kysely row type for a `date` column in this service
 * declares it as `string`, matching this parser exactly, the same way
 * `pg-bigint-parser.ts` keeps the `bigint` row type and its own explicit
 * parser in lockstep.
 *
 * See `pg-bigint-parser.ts` for why importing this once, anywhere before a
 * connection is made, is both sufficient for the whole process and a real,
 * silent bug the first time it is *not* imported.
 */

import pg from 'pg';

const DATE_OID = 1082;

pg.types.setTypeParser(DATE_OID, (value: string) => value);
