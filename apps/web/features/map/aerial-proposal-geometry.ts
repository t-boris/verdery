import type { Geometry, Position } from '@verdery/geometry-contracts';

import type { WireAerialTraceProposal } from '@/core/api/public';

import type { MapObjectRecord } from './types';

export function aerialProposalRecord(proposal: WireAerialTraceProposal): MapObjectRecord {
  return {
    id: proposal.proposalId,
    gardenId: '',
    category: proposal.category,
    geometry: proposal.geometry,
    label: proposal.label,
    lifecycleState: 'active',
    revision: 0,
    createdAt: '',
    updatedAt: '',
  };
}

export function translateProposalGeometry(geometry: Geometry, dx: number, dy: number): Geometry {
  const translate = (position: Position): Position => [position[0] + dx, position[1] + dy];
  switch (geometry.type) {
    case 'Point':
      return { type: 'Point', coordinates: translate(geometry.coordinates) };
    case 'LineString':
      return { type: 'LineString', coordinates: geometry.coordinates.map(translate) };
    case 'Polygon':
      return {
        type: 'Polygon',
        coordinates: geometry.coordinates.map((ring) => ring.map(translate)),
      };
    case 'MultiLineString':
      return {
        type: 'MultiLineString',
        coordinates: geometry.coordinates.map((line) => line.map(translate)),
      };
    case 'MultiPolygon':
      return {
        type: 'MultiPolygon',
        coordinates: geometry.coordinates.map((polygon) =>
          polygon.map((ring) => ring.map(translate)),
        ),
      };
  }
}

export function moveProposalVertex(
  geometry: Geometry,
  vertexIndex: number,
  position: Position,
): Geometry {
  if (geometry.type === 'LineString') {
    return { type: 'LineString', coordinates: geometry.coordinates.with(vertexIndex, position) };
  }
  if (geometry.type !== 'Polygon' || geometry.coordinates[0] === undefined) {
    return geometry;
  }
  const exterior = [...geometry.coordinates[0]];
  exterior[vertexIndex] = position;
  if (vertexIndex === 0) exterior[exterior.length - 1] = position;
  return { type: 'Polygon', coordinates: [exterior, ...geometry.coordinates.slice(1)] };
}

export function insertProposalVertex(
  geometry: Geometry,
  vertexIndex: number,
  position: Position,
): Geometry {
  if (geometry.type === 'LineString') {
    const coordinates = [...geometry.coordinates];
    coordinates.splice(vertexIndex, 0, position);
    return { type: 'LineString', coordinates };
  }
  if (geometry.type !== 'Polygon' || geometry.coordinates[0] === undefined) return geometry;
  const exterior = [...geometry.coordinates[0]];
  exterior.splice(vertexIndex, 0, position);
  return { type: 'Polygon', coordinates: [exterior, ...geometry.coordinates.slice(1)] };
}

export function removeProposalVertex(geometry: Geometry, vertexIndex: number): Geometry {
  if (geometry.type === 'LineString' && geometry.coordinates.length > 2) {
    return {
      type: 'LineString',
      coordinates: geometry.coordinates.filter((_point, index) => index !== vertexIndex),
    };
  }
  if (
    geometry.type !== 'Polygon' ||
    geometry.coordinates[0] === undefined ||
    geometry.coordinates[0].length <= 4 ||
    vertexIndex === 0
  ) {
    return geometry;
  }
  const exterior = geometry.coordinates[0].filter((_point, index) => index !== vertexIndex);
  return { type: 'Polygon', coordinates: [exterior, ...geometry.coordinates.slice(1)] };
}
