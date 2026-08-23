import type { FormatId } from '../format-id';
import type { FormatDescriptor, Registry } from './types';

export function createRegistry(descriptors: readonly FormatDescriptor[]): Registry {
  const byId = new Map<FormatId, FormatDescriptor>();
  for (const d of descriptors) {
    if (byId.has(d.id)) throw new Error(`duplicate format descriptor: ${d.id}`);
    byId.set(d.id, d);
  }
  const list = [...byId.values()];
  return {
    list: () => list,
    get: (id) => byId.get(id),
    has: (id) => byId.has(id),
    ids: () => list.map((d) => d.id),
  };
}
