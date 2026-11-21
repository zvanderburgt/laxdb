/**
 * Raw assets esbuild inlines into the function bundles (`loader: { ".ttf": "binary", ".wasm":
 * "binary" }` in scripts/build-functions.mjs). The import yields a Uint8Array at runtime; the
 * declarations exist so `tsc -p tsconfig.server.json` can typecheck a function that ships a font or
 * a wasm module.
 */
declare module "*.ttf" {
  const bytes: Uint8Array;
  export default bytes;
}

declare module "*.wasm" {
  const bytes: Uint8Array;
  export default bytes;
}
