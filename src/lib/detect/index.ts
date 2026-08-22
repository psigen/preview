export { makeProbe, extensionOf, basenameOf, PROBE_BYTES } from './probe';
export type { Probe } from './probe';
export { firstZipEntryName, isZip, zipSignature } from './zip';
export {
  detectFormat,
  SNIFFERS,
  snifferFor,
  acceptAttribute,
  formatsForExtension,
} from './detect';
export type { Detection, Confidence, SniffResult, Sniffer } from './detect';
