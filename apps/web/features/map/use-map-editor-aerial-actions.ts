'use client';

import type { AerialObjectSourceMetadata, CreateObjectSource } from '@verdery/geometry-contracts';
import { useCallback } from 'react';

import type { WireAerialTraceProposal } from '@/core/api/public';

import { buildAcceptProposedObjectCommand, generateMapId } from './commands';
import type { MapEditorActionDeps } from './map-editor-commit';

export function aerialProposalSource(proposal: WireAerialTraceProposal): CreateObjectSource {
  const metadata: AerialObjectSourceMetadata = {
    kind: 'aerialImageExtraction',
    proposalId: proposal.proposalId,
    processor: proposal.provenance.processor,
    model: proposal.provenance.model,
    promptTemplateVersion: proposal.provenance.promptTemplateVersion,
    boundaryEvidence: proposal.boundaryEvidence,
    limitations: proposal.limitations,
    imagery: proposal.provenance.imagery,
    imageryBounds: proposal.provenance.imageryBounds,
    imageryWidthPixels: proposal.provenance.imageryWidthPixels,
    imageryHeightPixels: proposal.provenance.imageryHeightPixels,
    imageryResolutionMetres: proposal.provenance.imageryResolutionMetres,
    imageryHorizontalAccuracyMetres: proposal.provenance.imageryHorizontalAccuracyMetres,
    georeferenceRevision: proposal.provenance.georeferenceRevision,
  };
  return { provenance: 'imageExtraction', confidence: proposal.confidence, metadata };
}

/** Accepts reviewed aerial proposals through the same canonical command path as plat proposals. */
export function useMapEditorAerialActions({ commit, store }: MapEditorActionDeps) {
  const acceptAerialProposals = useCallback(
    async (proposals: readonly WireAerialTraceProposal[], georeferenceRevision: number) => {
      if (
        proposals.some(
          (proposal) => proposal.provenance.georeferenceRevision !== georeferenceRevision,
        )
      ) {
        store.setStatus({ key: 'map.aerialTrace.stale', tone: 'alert' });
        return [] as readonly string[];
      }

      const acceptedIds: string[] = [];
      for (const proposal of proposals) {
        const objectId = generateMapId();
        const command = buildAcceptProposedObjectCommand(
          objectId,
          proposal.category,
          proposal.geometry,
          proposal.label,
          aerialProposalSource(proposal),
        );
        const affected = await commit(command, null);
        if (affected === null) break;
        acceptedIds.push(proposal.proposalId);
      }

      if (acceptedIds.length > 0) {
        store.setTool('select');
        store.setStatus({
          key: 'map.aerialTrace.accepted',
          args: { count: String(acceptedIds.length) },
          tone: 'status',
        });
      }
      return acceptedIds;
    },
    [commit, store],
  );

  return { acceptAerialProposals };
}
