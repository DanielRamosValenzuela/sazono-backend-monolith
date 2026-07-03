export const API_V1_PREFIX = 'v1';

export function buildVersionedControllerPath(resource: string): string {
  return `${API_V1_PREFIX}/${resource}`;
}
