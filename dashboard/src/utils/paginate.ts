/**
 * A4 pagination for the CV templates.
 *
 * The templates render as one continuous A4-width sheet (`.cv-sheet`) with
 * unbounded height. The browser has no paged-media layout for arbitrary DOM,
 * so this module supplies a small fragmentation pass:
 *
 *   1. Measure the rendered sheet off-screen at real size.
 *   2. Walk its structure using marker classes and split it into page-sized
 *      clumps of unbreakable fragments.
 *   3. Clone those fragments into fixed 210×297mm page frames — exactly what
 *      the editor shows and what `exportPDF.ts` prints, so the exported PDF
 *      always matches the on-screen preview and is never stretched.
 *
 * Marker classes templates use (see Modern/Embedded/ClassicTemplate):
 *   cv-sheet    the template root — one A4-width sheet.
 *   cv-columns  a row of side-by-side columns; each `.cv-column` inside it
 *               paginates independently and the results are zipped by page.
 *   cv-column   one column inside `.cv-columns`.
 *   cv-flow     a container whose DIRECT element children are the pagination
 *               units (e.g. the entries inside a section). Can be nested.
 *
 * Fragmentation rule: a unit is never sliced mid-block (break-inside: avoid)
 * — if it doesn't fit, it moves whole to the next page. The one exception is
 * a unit taller than a full page, which is broken at its own child boundary
 * so content is never silently dropped.
 */

const CLS = {
  sheet: 'cv-sheet',
  columns: 'cv-columns',
  column: 'cv-column',
  flow: 'cv-flow',
  page: 'cv-page',
};

type Slot =
  | { kind: 'node'; node: HTMLElement; height: number }
  | { kind: 'flow'; parent: HTMLElement; items: Slot[] };

interface FlatItem {
  node: HTMLElement;
  height: number;
  /** Original flow hosts, outermost first — cloned per page when mounting. */
  chain: HTMLElement[];
}

type Band =
  | { kind: 'full'; items: Slot[] }
  | { kind: 'columns'; row: HTMLElement; columns: { col: HTMLElement; items: Slot[] }[] };

function elementChildren(el: HTMLElement): HTMLElement[] {
  return Array.from(el.children) as HTMLElement[];
}

/** Vertical extent an element actually occupies in its block flow — border
 * box plus its own top/bottom margins. The fit tests use this instead of the
 * bare rect height: previously margins cost no vertical space, so a page
 * silently accepted one item too many and the overflow was clipped by the
 * fixed 297mm frame instead of carted onto the next page. */
function flowAdvance(el: HTMLElement): number {
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const mt = parseFloat(style.marginTop);
  const mb = parseFloat(style.marginBottom);
  return rect.height + (Number.isFinite(mt) ? mt : 0) + (Number.isFinite(mb) ? mb : 0);
}

/** Top padding of a flow host — the first item inside it starts below that,
 * so it must count toward that item's advance to keep fit checks honest. */
function paddingTopOf(el: HTMLElement): number {
  const p = parseFloat(getComputedStyle(el).paddingTop);
  return Number.isFinite(p) ? p : 0;
}

function slotOf(el: HTMLElement, pageHeightPx: number, extraTop = 0): Slot {
  if (el.classList.contains(CLS.flow)) {
    const kids = elementChildren(el);
    return {
      kind: 'flow',
      parent: el,
      // The first item also pays the host's own top padding.
      items: kids.map((c, i) => slotOf(c, pageHeightPx, i === 0 ? extraTop + paddingTopOf(el) : 0)),
    };
  }
  const height = flowAdvance(el) + extraTop;
  const kids = elementChildren(el);
  if (height > pageHeightPx && kids.length > 0) {
    // Too tall to keep intact — break it at its own child boundary instead.
    return { kind: 'flow', parent: el, items: kids.map((c, i) => slotOf(c, pageHeightPx, i === 0 ? extraTop + paddingTopOf(el) : 0)) };
  }
  return { kind: 'node', node: el, height };
}

function buildBands(root: HTMLElement, pageHeightPx: number): Band[] {
  const bands: Band[] = [];
  let full: Slot[] = [];
  const flush = () => {
    if (full.length > 0) {
      bands.push({ kind: 'full', items: full });
      full = [];
    }
  };

  const rootPadTop = paddingTopOf(root);
  for (const [i, child] of elementChildren(root).entries()) {
    if (child.classList.contains(CLS.columns)) {
      flush();
      const columns = elementChildren(child)
        .filter((c) => c.classList.contains(CLS.column))
        .map((col) => ({ col, items: elementChildren(col).map((c) => slotOf(c, pageHeightPx)) }));
      bands.push({ kind: 'columns', row: child, columns });
    } else {
      full.push(slotOf(child, pageHeightPx, i === 0 ? rootPadTop : 0));
    }
  }
  flush();
  return bands;
}

function flatten(slots: Slot[], chain: HTMLElement[]): FlatItem[] {
  const out: FlatItem[] = [];
  for (const s of slots) {
    if (s.kind === 'node') out.push({ node: s.node, height: s.height, chain });
    else out.push(...flatten(s.items, [...chain, s.parent]));
  }
  return out;
}

/** Fragment the rendered `root` sheet into fixed A4 page frames. */
export function paginateSheet(root: HTMLElement): HTMLDivElement[] {
  const rect = root.getBoundingClientRect();
  const pageHeightPx = rect.width * (297 / 210);
  const bands = buildBands(root, pageHeightPx);

  const pages: HTMLDivElement[] = [];
  let surface: HTMLElement;
  let hosts = new Map<HTMLElement, HTMLElement>(); // original host el -> clone on current page
  let touched = false;
  let usedY = 0;

  const makeSurface = () => {
    const s = root.cloneNode(false) as HTMLElement;
    s.style.minHeight = '';
    s.style.height = '297mm';
    s.style.overflow = 'hidden';
    return s;
  };

  const makePage = () => {
    const frame = document.createElement('div');
    frame.className = CLS.page;
    const st = frame.style;
    st.width = '210mm';
    st.height = '297mm';
    st.overflow = 'hidden';
    st.position = 'relative';
    st.background = '#fff';
    st.flex = '0 0 auto';
    const s = makeSurface();
    frame.appendChild(s);
    pages.push(frame);
    surface = s;
    hosts = new Map();
    touched = false;
    usedY = 0;
    return frame;
  };

  const ensureHost = (original: HTMLElement, parent: HTMLElement): HTMLElement => {
    let clone = hosts.get(original);
    if (!clone) {
      clone = original.cloneNode(false) as HTMLElement;
      hosts.set(original, clone);
      parent.appendChild(clone);
    }
    return clone;
  };

  makePage();

  const runFull = (band: Band & { kind: 'full' }) => {
    const consume = (slot: Slot, chain: HTMLElement[]) => {
      if (slot.kind === 'node') {
        const fits = usedY + slot.height <= pageHeightPx + 0.5;
        if (!fits && touched) makePage();
        let target: HTMLElement = surface;
        for (const original of chain) target = ensureHost(original, target);
        target.appendChild(slot.node.cloneNode(true) as HTMLElement);
        usedY += slot.height;
        touched = true;
      } else {
        for (const item of slot.items) consume(item, [...chain, slot.parent]);
      }
    };
    for (const slot of band.items) consume(slot, []);
  };

  const runColumns = (band: Band & { kind: 'columns' }) => {
    const cols = band.columns.map(({ col, items }) => ({ col, flats: flatten(items, []), cursor: 0 }));
    const done = () => cols.every((c) => c.cursor >= c.flats.length);
    if (cols.length === 0 || done()) {
      usedY = pageHeightPx;
      return;
    }

    const scaffold = () => {
      // Materialise every column on the current page so side-by-side layouts
      // keep their rails (background rails, borders, gutters) on continuation
      // pages even when one column has exhausted its content.
      let rowClone = hosts.get(band.row);
      if (!rowClone) {
        rowClone = band.row.cloneNode(false) as HTMLElement;
        hosts.set(band.row, rowClone);
        surface.appendChild(rowClone);
      }
      for (const c of cols) {
        let colClone = hosts.get(c.col);
        if (!colClone) {
          colClone = c.col.cloneNode(false) as HTMLElement;
          hosts.set(c.col, colClone);
          rowClone.appendChild(colClone);
        }
      }
      return rowClone;
    };

    const mountColumn = (colEl: HTMLElement, item: FlatItem) => {
      const rowClone = hosts.get(band.row) as HTMLElement;
      const colClone = hosts.get(colEl) as HTMLElement;
      let target: HTMLElement = colClone;
      for (const original of item.chain) target = ensureHost(original, target);
      target.appendChild(item.node.cloneNode(true) as HTMLElement);
      touched = true;
    };

    while (!done()) {
      const budget = pageHeightPx - usedY;
      scaffold();
      for (const c of cols) {
        if (c.cursor >= c.flats.length) continue;
        let colUsed = paddingTopOf(c.col);
        while (c.cursor < c.flats.length) {
          const item = c.flats[c.cursor];
          const overflowsFullPage = item.height > pageHeightPx - 0.5;
          if (colUsed + item.height <= budget + 0.5 || overflowsFullPage) {
            mountColumn(c.col, item);
            colUsed += item.height;
            c.cursor++;
          } else break;
        }
      }
      if (done()) break;
      makePage();
    }
    usedY = pageHeightPx;
  };

  for (const band of bands) {
    if (band.kind === 'full') runFull(band);
    else runColumns(band);
  }

  return pages;
}