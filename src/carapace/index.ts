export { CarapaceClient, CarapaceError } from './client.js';
export type { CarapaceConfig, CarapaceQueryParams, CarapaceQueryResponse } from './client.js';
export {
  mapInsightToContribution,
  mapContributionToInsight,
  isPromotable,
} from './mapper.js';
export type {
  CarapaceContribution,
  CarapaceContributionResponse,
  PromotabilityResult,
  MapToContributionOptions,
  MapToInsightOptions,
} from './mapper.js';
