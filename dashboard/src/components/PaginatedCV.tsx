import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CVData } from '../types';
import { getTemplate } from './templates';
import { paginateSheet } from '../utils/paginate';

interface Props {
  cv: CVData;
  templateId?: string;
  /** Called once a page count is known (also re-fired on remeasure). */
  onPages?: (pageCount: number) => void;
  /** Called when text is edited in-place on a preview page frame. The path is
   * the same dot-path the Editable component stamped (`data-field`), so the
   * caller can write it straight into the store and the left panel reflects
   * the change. */
  onEdit?: (path: string, value: string) => void;
  /** Called when an item is removed from a list in the preview (the ✕ on a
   * skill row). Path is the item's dot path ending in a numeric index. */
  onRemove?: (path: string) => void;
}

/**
 * Renders a CV template as discrete A4 page frames instead of one endless
 * sheet. The template is laid out off-screen at full size, measured, split at
 * block boundaries into page-height chunks (`utils/paginate.ts`), and each
 * chunk is cloned into its own fixed 210×297mm .cv-page frame with a
 * "Page N" caption. These frames are the single source of truth for both the
 * editor preview and the PDF export, so what you see is exactly what prints.
 *
 * The frames are plain cloned DOM (React only renders the off-screen measurer),
 * so in-place editing is wired imperatively: a delegated `input` listener on
 * the frames container reads `textContent` from the `[data-field]` element the
 * edit happened in, reports it via `onEdit`, and after the store update
 * triggers a rebuild the caret is restored to the same character offset so
 * typing never jumps.
 */
export const PaginatedCV: React.FC<Props> = ({ cv, templateId, onPages, onEdit, onRemove }) => {
  const [measured, setMeasured] = useState(false);
  const measurerRef = useRef<HTMLDivElement>(null);
  const framesRef = useRef<HTMLDivElement>(null);
  const onPagesRef = useRef(onPages);
  onPagesRef.current = onPages;
  const onEditRef = useRef(onEdit);
  onEditRef.current = onEdit;
  const onRemoveRef = useRef(onRemove);
  onRemoveRef.current = onRemove;
  // Caret position to restore after a preview edit rebuilds the frames —
  // path + plain-text character offset, which survives the DOM swap.
  const editCaretRef = useRef<{ path: string; offset: number } | null>(null);

  const Template = getTemplate(templateId).component;

  const rebuild = useCallback(() => {
    const measurer = measurerRef.current;
    const frames = framesRef.current;
    if (!measurer || !frames) return;

    const sheet = measurer.querySelector<HTMLElement>('.cv-sheet') ?? (measurer.firstElementChild as HTMLElement | null);
    if (!sheet) return;

    // A page grows its own local flex/block context from the measurer's sheet
    // root, so cloned fragments render at identical metrics to the measuring
    // pass even though they've been split across frames.
    const pages = paginateSheet(sheet);

    const slots = pages.map((frame, i) => {
      frame.style.boxShadow = '0 12px 34px rgba(30, 22, 10, 0.14)';
      const slot = document.createElement('div');
      slot.className = 'cv-page-slot';
      slot.style.display = 'flex';
      slot.style.flexDirection = 'column';
      slot.style.alignItems = 'center';
      slot.style.gap = '14px';
      slot.appendChild(frame);
      const caption = document.createElement('div');
      caption.className = 'cv-page-caption';
      caption.textContent = pages.length > 1 ? `Page ${i + 1} of ${pages.length}` : 'A4 · fits on one page';
      caption.style.fontSize = '11px';
      caption.style.color = '#9e9a91';
      caption.style.fontFamily = "'DM Sans', sans-serif";
      slot.appendChild(caption);
      return slot;
    });

    frames.replaceChildren(...slots);
    setMeasured(true);
    onPagesRef.current?.(pages.length);

    // A preview edit just triggered this rebuild — hand the caret back to the
    // same field at the same character offset so typing stays continuous.
    const caret = editCaretRef.current;
    if (caret) {
      editCaretRef.current = null;
      const el = frames.querySelector<HTMLElement>(`[data-field="${caret.path}"]`);
      if (el) restoreCaret(el, caret.offset);
    }
  }, []);

  useLayoutEffect(() => {
    rebuild();
  }, [rebuild, cv, templateId]);

  useEffect(() => {
    let cancelled = false;
    // Fonts load async from Google Fonts; measuring before they land gives
    // wrong line heights, so re-measure once they're ready.
    if (typeof document !== 'undefined' && 'fonts' in document) {
      document.fonts.ready.then(() => {
        if (!cancelled) rebuild();
      }).catch(() => {});
    }
    const onResize = () => rebuild();
    window.addEventListener('resize', onResize);
    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
    };
  }, [rebuild]);

  useEffect(() => {
    const frames = framesRef.current;
    if (!frames) return;
    const onInput = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target || typeof target.closest !== 'function') return;
      const el = target.closest<HTMLElement>('[data-field]');
      if (!el) return;
      const path = el.getAttribute('data-field');
      if (!path) return;
      // Read back what the user actually sees. `textContent` only joins text
      // nodes, so the empty block elements a contentEditable inserts on Enter
      // vanish from the value — the store never changes and the page never
      // re-flows, clipping whatever grew past the frame. `innerText` reflects
      // the rendered breaks instead.
      editCaretRef.current = { path, offset: caretOffsetIn(el) };
      onEditRef.current?.(path, el.innerText ?? '');
    };
    const onClick = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target || typeof target.closest !== 'function') return;
      const btn = target.closest<HTMLElement>('[data-remove-field]');
      if (!btn) return;
      const path = btn.getAttribute('data-remove-field');
      if (!path) return;
      onRemoveRef.current?.(path);
    };
    frames.addEventListener('input', onInput);
    frames.addEventListener('click', onClick);
    return () => {
      frames.removeEventListener('input', onInput);
      frames.removeEventListener('click', onClick);
    };
  }, []);

  return (
    <div className="cv-paginated" style={{ position: 'relative' }}>
      <style>{`
        .cv-paginated [data-field] { cursor: text; outline: none; border-radius: 2px; }
        .cv-paginated [data-field]:hover { box-shadow: 0 0 0 1px rgba(80, 110, 240, 0.4); }
        .cv-paginated [data-field]:focus { box-shadow: 0 0 0 1.5px rgba(80, 110, 240, 0.75); }
        .cv-paginated [data-remove-field] { visibility: hidden; opacity: 0; transition: opacity 0.12s ease; }
        .cv-paginated [data-remove-field]:hover { color: #b0403c !important; background: #f5f2ee; }
        .cv-paginated:hover [data-remove-field] { visibility: visible; opacity: 1; }
        /* Long words must wrap at the column edge instead of widening the flex
           layout — a ballooned column would clip on the fixed-width page and
           corrupt the pagination split until the text is cleared. */
        .cv-paginated [data-field] { overflow-wrap: anywhere; word-break: break-word; min-width: 0; }
        .cv-paginated .cv-column { min-width: 0; }
        .cv-paginated .cv-flow { min-width: 0; }
      `}</style>
      {!measured && (
        <div className="mb-3 text-center text-xs text-ink-muted">Arranging A4 pages…</div>
      )}
      <div className="cv-pages" ref={framesRef} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '34px' }} />
      <div
        ref={measurerRef}
        aria-hidden
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '800px',
          overflow: 'hidden',
          zIndex: -1,
          pointerEvents: 'none',
          transform: 'translateX(-200vw)',
        }}
      >
        <Template cv={cv} />
      </div>
    </div>
  );
};

/** Character offset of the caret within an editable element, counting text
 * nodes from the start. Stable across the DOM swap (but approximate for IME). */
function caretOffsetIn(el: HTMLElement): number {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const node = sel.anchorNode;
  const offset = sel.anchorOffset;
  if (!node || !el.contains(node)) return 0;
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.setEnd(node, offset);
    return range.toString().length;
  } catch {
    return 0;
  }
}

function restoreCaret(el: HTMLElement, offset: number) {
  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
  if (typeof document.getSelection !== 'function') return;
  const sel = document.getSelection();
  if (!sel) return;
  let remaining = Math.max(0, offset);
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let target: Node | null = null;
  let targetOffset = 0;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const len = node.textContent?.length ?? 0;
    if (remaining <= len) {
      target = node;
      targetOffset = remaining;
      remaining = 0;
      break;
    }
    remaining -= len;
  }
  if (!target) target = el;
  try {
    const range = document.createRange();
    range.setStart(target, target === el ? el.childNodes.length : targetOffset);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {
    // ignore — selection restore is best-effort
  }
}