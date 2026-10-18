// Crown types, derived from the Latin genus (first word of Antwerp's LATBOOMSOORT field). The map pipeline packs the
// index into city.trees; trees.ts picks a crown shape and colour per index. Keep the two in sync through this table.
export const TREE_KINDS = ['broadleaf', 'conifer', 'plane', 'blossom'] as const;

const GENUS_KIND: Record<string, number> = {
  platanus: 2, // plane trees — the big spreading avenue tree Antwerp is full of
  // conifers
  pinus: 1, picea: 1, abies: 1, taxus: 1, larix: 1, cedrus: 1, cupressus: 1, chamaecyparis: 1, thuja: 1,
  juniperus: 1, metasequoia: 1, sequoia: 1, sequoiadendron: 1, tsuga: 1, pseudotsuga: 1, cryptomeria: 1, calocedrus: 1,
  // small ornamental / blossom trees
  prunus: 3, malus: 3, crataegus: 3, pyrus: 3, sorbus: 3, amelanchier: 3, cercis: 3, parrotia: 3, magnolia: 3,
};

/** LATBOOMSOORT → TREE_KINDS index; everything unlisted (Tilia, Acer, Quercus, Fraxinus…) is a generic broadleaf (0). */
export function treeKind(latin: string | null | undefined): number {
  if (!latin) return 0;
  return GENUS_KIND[latin.trim().toLowerCase().split(/\s+/)[0]] ?? 0;
}
