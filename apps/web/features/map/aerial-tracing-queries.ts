'use client';

import { useMutation } from '@tanstack/react-query';

import {
  ApiFailureError,
  createBrowserApiClient,
  createMapGateway,
  isFailure,
  type WireAerialTracingResult,
} from '@/core/api/public';

export function useTraceAerial(gardenId: string) {
  return useMutation<WireAerialTracingResult, ApiFailureError>({
    mutationFn: async () => {
      const result = await createMapGateway(createBrowserApiClient()).traceAerial(gardenId);
      if (isFailure(result)) throw new ApiFailureError(result);
      return result.data;
    },
  });
}
