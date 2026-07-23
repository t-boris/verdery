import type {
  PlantAcquisitionDateType,
  PlantGroupingKind,
  PlantLifecycleStage,
  PlantStatus,
} from '@verdery/api-contracts';
import { describe, expect, it } from 'vitest';

import {
  acquisitionDateTypeLabel,
  groupingKindLabel,
  lifecycleStageLabel,
  statusLabel,
  statusTone,
} from './labels';

describe('groupingKindLabel', () => {
  it.each<[PlantGroupingKind, string]>([
    ['individual', 'plants.enum.groupingKind.individual'],
    ['row', 'plants.enum.groupingKind.row'],
    ['group', 'plants.enum.groupingKind.group'],
  ])('maps %s to %s', (kind, key) => {
    expect(groupingKindLabel(kind)).toBe(key);
  });
});

describe('acquisitionDateTypeLabel', () => {
  it.each<[PlantAcquisitionDateType, string]>([
    ['planted', 'plants.enum.acquisitionDateType.planted'],
    ['sown', 'plants.enum.acquisitionDateType.sown'],
    ['acquired', 'plants.enum.acquisitionDateType.acquired'],
  ])('maps %s to %s', (type, key) => {
    expect(acquisitionDateTypeLabel(type)).toBe(key);
  });
});

describe('lifecycleStageLabel', () => {
  it.each<[PlantLifecycleStage, string]>([
    ['planned', 'plants.enum.lifecycleStage.planned'],
    ['seed', 'plants.enum.lifecycleStage.seed'],
    ['seedling', 'plants.enum.lifecycleStage.seedling'],
    ['transplanted', 'plants.enum.lifecycleStage.transplanted'],
    ['growing', 'plants.enum.lifecycleStage.growing'],
    ['flowering', 'plants.enum.lifecycleStage.flowering'],
    ['fruiting', 'plants.enum.lifecycleStage.fruiting'],
    ['ready_to_harvest', 'plants.enum.lifecycleStage.readyToHarvest'],
  ])('maps %s to %s', (stage, key) => {
    expect(lifecycleStageLabel(stage)).toBe(key);
  });
});

describe('statusLabel', () => {
  it.each<[PlantStatus, string]>([
    ['active', 'plants.enum.status.active'],
    ['dormant', 'plants.enum.status.dormant'],
    ['archived', 'plants.enum.status.archived'],
    ['removed', 'plants.enum.status.removed'],
    ['dead', 'plants.enum.status.dead'],
  ])('maps %s to %s', (status, key) => {
    expect(statusLabel(status)).toBe(key);
  });
});

describe('statusTone', () => {
  it.each<[PlantStatus, string]>([
    ['active', 'positive'],
    ['dormant', 'neutral'],
    ['archived', 'neutral'],
    ['removed', 'negative'],
    ['dead', 'negative'],
  ])('maps %s to %s', (status, tone) => {
    expect(statusTone(status)).toBe(tone);
  });
});
