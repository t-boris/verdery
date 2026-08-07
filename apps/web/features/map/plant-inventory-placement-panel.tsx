'use client';

import type { Plant, PlantListResult } from '@verdery/api-contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useRouter } from 'next/navigation';

import {
  ApiFailureError,
  createBrowserApiClient,
  createPlantGateway,
  generateIdempotencyKey,
  isFailure,
  type ApiResult,
} from '@/core/api/public';
import { useLocalization } from '@/shared/localization/public';
import { Button, FailureAlert, ImageIcon, PlusIcon, SproutIcon } from '@/shared/ui/public';

import type { MapObjectRecord } from './types';
import type { MapEditorActions } from './use-map-editor-actions';
import styles from './plant-inventory-placement-panel.module.css';

export interface PlantInventoryPlacementPanelProps {
  readonly gardenId: string;
  readonly record: MapObjectRecord;
  readonly actions: MapEditorActions;
}

function unwrapPlantList(response: ApiResult<PlantListResult>): PlantListResult {
  if (isFailure(response)) throw new ApiFailureError(response);
  return response.data;
}

function unwrapPlant(response: ApiResult<Plant>): Plant {
  if (isFailure(response)) throw new ApiFailureError(response);
  return response.data;
}

/** Connects one traced plant area to the inventory record that owns it. */
export function PlantInventoryPlacementPanel({
  gardenId,
  record,
  actions,
}: PlantInventoryPlacementPanelProps) {
  const { t } = useLocalization();
  const router = useRouter();
  const queryClient = useQueryClient();
  const gateway = useMemo(() => createPlantGateway(createBrowserApiClient()), []);
  const linkedKey = ['map', gardenId, 'plant-placement', record.id] as const;
  const unassignedKey = ['map', gardenId, 'unassigned-plants'] as const;

  const linked = useQuery<PlantListResult, ApiFailureError>({
    queryKey: linkedKey,
    queryFn: async ({ signal }) =>
      unwrapPlantList(
        await gateway.search(gardenId, { placementMapObjectId: record.id, limit: 100 }, signal),
      ),
  });
  const unassigned = useQuery<PlantListResult, ApiFailureError>({
    queryKey: unassignedKey,
    queryFn: async ({ signal }) =>
      unwrapPlantList(
        await gateway.search(
          gardenId,
          {
            hasMapPlacement: false,
            status: ['active', 'dormant', 'archived'],
            limit: 100,
          },
          signal,
        ),
      ),
  });
  const assign = useMutation<Plant, ApiFailureError, Plant>({
    mutationFn: async (plant) =>
      unwrapPlant(
        await gateway.move(
          gardenId,
          plant.id,
          { placementMapObjectId: record.id },
          plant.revision,
          generateIdempotencyKey(),
        ),
      ),
    onSuccess: async (plant) => {
      const categoryDetails =
        record.category === 'tree'
          ? {
              category: 'tree' as const,
              details: {
                ...(record.categoryDetails?.category === 'tree'
                  ? record.categoryDetails.details
                  : {}),
                commonName: plant.displayName,
              },
            }
          : record.categoryDetails?.category === 'plant'
            ? {
                category: 'plant' as const,
                details: {
                  ...record.categoryDetails.details,
                  commonName: plant.displayName,
                  quantity: plant.quantity ?? 1,
                },
              }
            : {
                category: 'plant' as const,
                details: { commonName: plant.displayName, quantity: 1 },
              };
      await actions.changeProperties(record.id, plant.displayName, categoryDetails);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: linkedKey }),
        queryClient.invalidateQueries({ queryKey: unassignedKey }),
        queryClient.invalidateQueries({ queryKey: ['plants', gardenId, 'search'] }),
      ]);
    },
  });

  const createHref = (method: 'manual' | 'photo') => {
    const query = new URLSearchParams({
      create: method,
      placementMapObjectId: record.id,
      returnTo: 'map',
    });
    return `/application/gardens/${gardenId}/plants?${query.toString()}`;
  };

  if (linked.isError) return <FailureAlert failure={linked.error.failure} />;

  const linkedPlants = linked.data?.items ?? [];

  return (
    <section className={styles['panel']} aria-labelledby={`inventory-link-${record.id}`}>
      <div>
        <h3 id={`inventory-link-${record.id}`} className={styles['title']}>
          {t('map.plantInventory.title')}
        </h3>
        <p className={styles['description']}>{t('map.plantInventory.description')}</p>
      </div>

      {linked.isPending ? (
        <p className={styles['status']}>{t('map.plantInventory.loading')}</p>
      ) : linkedPlants.length > 0 ? (
        <div className={styles['linked']}>
          <span>{t('map.plantInventory.linked')}</span>
          {linkedPlants.map((plant) => (
            <Button
              key={plant.id}
              variant="secondary"
              onClick={() => router.push(`/application/gardens/${gardenId}/plants/${plant.id}`)}
            >
              <SproutIcon />
              {plant.displayName}
            </Button>
          ))}
        </div>
      ) : (
        <>
          <div className={styles['choices']}>
            <Button variant="secondary" onClick={() => router.push(createHref('manual'))}>
              <PlusIcon />
              {t('map.plantInventory.createManual')}
            </Button>
            <Button variant="secondary" onClick={() => router.push(createHref('photo'))}>
              <ImageIcon />
              {t('map.plantInventory.createFromPhoto')}
            </Button>
          </div>

          <div className={styles['unassigned']}>
            <h4>{t('map.plantInventory.unassignedTitle')}</h4>
            {unassigned.isPending && (
              <p className={styles['status']}>{t('map.plantInventory.loading')}</p>
            )}
            {unassigned.isError && <FailureAlert failure={unassigned.error.failure} />}
            {unassigned.data?.items.length === 0 && (
              <p className={styles['status']}>{t('map.plantInventory.unassignedEmpty')}</p>
            )}
            {unassigned.data?.items.map((plant) => (
              <Button
                key={plant.id}
                variant="secondary"
                busy={assign.isPending && assign.variables?.id === plant.id}
                disabled={assign.isPending}
                onClick={() => assign.mutate(plant)}
              >
                <SproutIcon />
                {plant.displayName}
              </Button>
            ))}
          </div>
        </>
      )}
      {assign.isError && <FailureAlert failure={assign.error.failure} />}
    </section>
  );
}
