import { memo, useEffect, useMemo, useState } from "react";
import { checkFigure, figureNeedsLayout, graphDot, readGraphvizLayout, renderFigure, type GraphLayout } from "../../../shared/figure";

/* Graphviz is ~1 MB of WASM, loaded the first time a graph is drawn and never
   again. Trees, lists, grids and arrays never touch it. */
let graphviz: Promise<GraphLayout> | null = null;
function loadLayout(): Promise<GraphLayout> {
  graphviz ??= import("@hpcc-js/wasm-graphviz").then(async ({ Graphviz }) => {
    const engine = await Graphviz.load();
    return (spec) => readGraphvizLayout(engine.layout(graphDot(spec), "json", "dot"));
  });
  return graphviz;
}

/**
 * A ```figure fence, drawn.
 *
 * The body is a figure spec (see shared/figure.ts). While a message is still
 * streaming the JSON is incomplete, so a body that does not parse yet draws a
 * quiet placeholder rather than an error — the error is only worth showing once
 * the spec is whole and still wrong.
 */
export const Figure = memo(function Figure({ source, bare = false }: {
  source: string;
  /** Drawn straight onto its container, with no frame of its own — for a place
   *  that is already a card, like a statement's example. */
  bare?: boolean;
}) {
  const check = useMemo(() => checkFigure(source), [source]);
  const [layout, setLayout] = useState<GraphLayout | null>(null);
  const needsLayout = check.ok && figureNeedsLayout(check.spec);

  useEffect(() => {
    if (!needsLayout || layout) return;
    let alive = true;
    void loadLayout().then((next) => { if (alive) setLayout(() => next); }).catch(() => {});
    return () => { alive = false; };
  }, [needsLayout, layout]);

  const svg = useMemo(() => {
    if (!check.ok || (needsLayout && !layout)) return null;
    try {
      return renderFigure(check.spec, layout ?? undefined);
    } catch {
      return null;
    }
  }, [check, needsLayout, layout]);

  if (!check.ok) {
    const incomplete = check.error.startsWith("The figure is not valid JSON");
    return (
      <div className={bare ? "figure-bare figure-frame-empty" : "figure-frame figure-frame-empty"} role="note">
        {incomplete ? "Drawing figure…" : `This figure could not be drawn — ${check.error}`}
      </div>
    );
  }
  return (
    <figure className={bare ? "figure-bare" : "figure-frame"}>
      {svg ? <div className="figure-canvas" dangerouslySetInnerHTML={{ __html: svg }} /> : <span className="figure-frame-empty">Drawing figure…</span>}
    </figure>
  );
});
