// Declarations for the SmartSpectra SDK entry points.
// esbuild resolves the real package at build time; these keep `tsc --noEmit`
// working on a machine where the (large) native package is not installed yet.
declare module '@smartspectra/node-sdk';
declare module '@smartspectra/node-sdk/main';
declare module '@smartspectra/node-sdk/preload';
declare module '@smartspectra/node-sdk/renderer';
declare module '@smartspectra/node-sdk/messages';
