/**
 * Hand-written types for occt-import-js, which ships none.
 *
 * Only the surface we actually use is declared; the module exposes rather more.
 */
declare module 'occt-import-js' {
  export interface OcctReadParams {
    /** OCCT converts from the file's DECLARED unit into this one. Default 'millimeter'. */
    linearUnit?: 'millimeter' | 'centimeter' | 'meter' | 'inch' | 'foot';
    linearDeflectionType?: 'bounding_box_ratio' | 'absolute_value';
    linearDeflection?: number;
    angularDeflection?: number;
  }

  export interface OcctAttribute {
    array: number[];
  }

  export interface OcctBrepFace {
    first: number;
    last: number;
    color: [number, number, number] | null;
  }

  export interface OcctMesh {
    name: string;
    color?: [number, number, number];
    brep_faces?: OcctBrepFace[];
    attributes: { position: OcctAttribute; normal?: OcctAttribute };
    index: OcctAttribute;
  }

  export interface OcctNode {
    name: string;
    meshes: number[];
    children: OcctNode[];
  }

  export interface OcctResult {
    success: boolean;
    root?: OcctNode;
    meshes: OcctMesh[];
  }

  export interface OcctModule {
    ReadFile(
      format: 'step' | 'iges' | 'brep',
      content: Uint8Array,
      params: OcctReadParams | null,
    ): OcctResult;
    ReadStepFile(content: Uint8Array, params: OcctReadParams | null): OcctResult;
    ReadIgesFile(content: Uint8Array, params: OcctReadParams | null): OcctResult;
    ReadBrepFile(content: Uint8Array, params: OcctReadParams | null): OcctResult;
  }

  export interface OcctFactoryOptions {
    /**
     * The wasm bytes, supplied directly.
     *
     * Not optional in practice: all three of emscripten's environment flags are false in a
     * module worker, so it cannot fetch its own wasm there. See docs/SPIKES.md S2.
     */
    wasmBinary?: ArrayBuffer;
    locateFile?: (path: string) => string;
    print?: (text: string) => void;
    printErr?: (text: string) => void;
  }

  const occtimportjs: (options?: OcctFactoryOptions) => Promise<OcctModule>;
  export default occtimportjs;
}
