/**
 * Minimal environment shims for the Node test tier.
 *
 * Deliberately tiny, and deliberately NOT a general browser polyfill: the point of the Node
 * tier is that the loader stack really does run without a DOM, so anything shimmed here is
 * an admission and should be justified.
 *
 * ProgressEvent is the only one. three's FileLoader constructs one to report download
 * progress while resolving a glTF's external .bin through the LoadingManager. Node has
 * Blob, URL.createObjectURL and a fetch that resolves blob: URLs — everything except this
 * one constructor — and without it the manager throws mid-flight, never completes, and the
 * parse promise hangs forever rather than failing.
 */
if (typeof globalThis.ProgressEvent === 'undefined') {
  class NodeProgressEvent extends Event {
    readonly lengthComputable: boolean;
    readonly loaded: number;
    readonly total: number;
    constructor(type: string, init: ProgressEventInit = {}) {
      super(type, init);
      this.lengthComputable = init.lengthComputable ?? false;
      this.loaded = init.loaded ?? 0;
      this.total = init.total ?? 0;
    }
  }
  globalThis.ProgressEvent = NodeProgressEvent as unknown as typeof ProgressEvent;
}
