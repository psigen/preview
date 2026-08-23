import { useRef } from 'react';
import { acceptAttribute } from '../lib/detect/detect';
import { filesFromList } from '../lib/dropEntries';
import type { DroppedFile } from '../lib/dnd';
import { SAMPLES } from '../lib/samples';

interface Props {
  onFiles(files: DroppedFile[]): void;
  onSample(id: string): void;
  disabled?: boolean;
}

/**
 * Shown when nothing is loaded.
 *
 * A CLICK target only, never a second drop target: the document-level listener already
 * accepts a drop anywhere on the page, and two overlapping handlers is how one drop gets
 * processed twice.
 */
export function EmptyState({ onFiles, onSample, disabled = false }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const pick = (input: HTMLInputElement | null) => input?.click();

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const list = event.target.files;
    if (list && list.length) onFiles(filesFromList(list));
    // Reset, so choosing the SAME file twice in a row still fires a change event.
    event.target.value = '';
  };

  return (
    <div className="empty-state-wrap">
      <section className="card empty-state">
        <h1>Open a 3D model</h1>
        <p className="hint">
          Drop a file anywhere on this page, or choose one below. Everything is read in your browser
          — nothing is uploaded.
        </p>

        <div className="empty-actions">
          <button
            type="button"
            className="primary"
            disabled={disabled}
            onClick={() => pick(fileInput.current)}
          >
            Choose file…
          </button>
          <button
            type="button"
            className="secondary"
            disabled={disabled}
            onClick={() => pick(folderInput.current)}
          >
            Choose folder…
          </button>
        </div>

        <input
          ref={fileInput}
          type="file"
          hidden
          multiple
          accept={acceptAttribute()}
          onChange={handleChange}
        />
        <input
          ref={folderInput}
          type="file"
          hidden
          // Non-standard but universally supported, and the only way to pick a directory.
          {...({ webkitdirectory: '' } as Record<string, string>)}
          onChange={handleChange}
        />

        <div className="divider">
          <span>or try a sample</span>
        </div>
        <div className="empty-samples">
          {SAMPLES.map((s) => (
            <button
              key={s.id}
              type="button"
              className="link"
              data-sample={s.id}
              disabled={disabled}
              onClick={() => onSample(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
