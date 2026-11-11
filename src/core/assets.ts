declare const __ASSET_VERSIONS__: Record<string, string>;

const versions: Record<string, string> = typeof __ASSET_VERSIONS__ === 'undefined' ? {} : __ASSET_VERSIONS__;

/** Adds the content hash in builds; vercel.json caches ?v= URLs for a year. */
export const asset = (path: string) => (versions[path] ? `${path}?v=${versions[path]}` : path);
