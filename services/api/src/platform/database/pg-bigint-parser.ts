/**
 * Makes `node-postgres` return `bigint` (OID 20) columns as JS numbers.
 *
 * `pg`'s default is a string, because a JS number cannot safely represent
 * the full int8 range. Every `bigint` column this service defines
 * (`revision` on `profile`/`garden`/`membership`, `platform.sync_change.
 * sequence`) is a counter that increments by one per accepted mutation and
 * cannot approach `Number.MAX_SAFE_INTEGER` (2^53) within the service's
 * realistic lifetime — the Kysely row types already declare these columns
 * as `number`, matching this parser, not the driver's own default.
 *
 * `pg.types` is a single registry shared by every `Pool`/`Client` in the
 * process, so importing this module once, anywhere before a connection is
 * made, is enough for the whole process — but that also makes it a real,
 * silent bug the first time it is *not* imported (found directly: revision
 * comparisons failed as spuriously "stale" every time, because the DB read
 * came back as `"1"` and never `===` the numeric `expectedRevision` a caller
 * passed in). Importing it explicitly, rather than relying on it being a
 * transitive side effect of some other import, is deliberate.
 */

import pg from 'pg';

const BIGINT_OID = 20;

pg.types.setTypeParser(BIGINT_OID, (value: string) => Number.parseInt(value, 10));
