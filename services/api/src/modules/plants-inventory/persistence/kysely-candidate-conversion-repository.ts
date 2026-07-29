import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { CandidateConversionRepository } from '../application/candidate-conversion-repository.js';
import type { CandidateConversion } from '../domain/candidate-conversion.js';

export class KyselyCandidateConversionRepository implements CandidateConversionRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async insert(conversion: CandidateConversion): Promise<void> {
    await this.db
      .insertInto('plants_inventory.candidate_conversion')
      .values({
        id: conversion.id,
        candidate_id: conversion.candidateId,
        plant_id: conversion.plantId,
        converted_by_profile_id: conversion.convertedByProfileId,
        converted_at: conversion.convertedAt,
      })
      .execute();
  }

  async findByCandidateId(candidateId: Uuid): Promise<CandidateConversion | null> {
    const row = await this.db
      .selectFrom('plants_inventory.candidate_conversion')
      .selectAll()
      .where('candidate_id', '=', candidateId)
      .executeTakeFirst();

    return row === undefined
      ? null
      : {
          id: row.id,
          candidateId: row.candidate_id,
          plantId: row.plant_id,
          convertedByProfileId: row.converted_by_profile_id,
          convertedAt: row.converted_at,
        };
  }
}
