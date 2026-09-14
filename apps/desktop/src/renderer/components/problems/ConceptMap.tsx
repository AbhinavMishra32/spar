import { useMemo, useRef, useState } from "react";
import { Waypoints } from "lucide-react";
import type { AbilityHistorySummary, ConceptSummary, LearnerProgress } from "@spar/domain";
import { cn } from "@/lib/utils";
import { CONCEPT_KIND_SHORT, CONCEPT_KIND_VAR, standingOf } from "@/lib/concepts";
import { EmptyState } from "../common/EmptyState";
import { STATUS } from "../progress/status";

/**
 * The library from above: every concept Spar has met, and the abilities it has
 * claimed over them.
 *
 * Worth being explicit about what this is drawn from, because a graph is the
 * easiest thing in an interface to fake. Three edge sets, all real and none of
 * them invented here:
 *
 * - concept to concept, from `ConceptSummary.parentSlug` — the subject tree the
 *   store already keeps and `conceptTree` already renders as a list;
 * - ability to concept, from `AbilityHistorySummary.concepts` — many to many,
 *   and the only thing in the model that links one branch of that tree to
 *   another;
 * - size from `challengeCount`, and the arc from the pass counts behind
 *   `standingOf`.
 *
 * What does *not* exist is a concept-to-concept edge other than parent and
 * child: nothing in the model says one concept is a prerequisite for another.
 * So this is a tree with cross-links and it is drawn as one — a force-directed
 * hairball would be claiming a network the data does not contain.
 *
 * A view of Problems rather than a page. Problems is the list you pick from and
 * this is the shape that list has; giving the same library two destinations
 * would be the third place in this app to answer one question.
 *
 * **It is drawn in the app's own vocabulary, not a charting library's.** A
 * concept is a ring with an arc on it — the same figure `StatusRing` draws
 * beside every ability in the app, for the same reason, so a reader who worked
 * out once that a fuller arc means more settled never has to do it again. The
 * edges are hairlines on the same token every rule in the window uses, and they
 * curve, because a straight line between two circles is a diagram and this is
 * meant to be a drawing of somebody's knowledge. Nothing here has a drop shadow,
 * a gradient, or a colour that is not already a concept kind or a status.
 *
 * The layout is a deterministic relaxation rather than a live simulation. Same
 * data in, same picture out, every time it is opened — a map whose landmarks
 * move between visits is not a map, and nobody can build a memory of one. It
 * settles before first paint and never animates.
 */
export function ConceptMap({
  abilities,
  concepts,
  onOpenAbility,
  onOpenConcept,
  progress,
  query,
}: {
  abilities: AbilityHistorySummary[];
  concepts: ConceptSummary[];
  onOpenAbility(abilityId: string): void;
  onOpenConcept(slug: string): void;
  progress: LearnerProgress;
  /** The page's own search, applied as emphasis rather than as a filter: a map
   *  you have removed half of is not a map any more, so a search dims what it
   *  does not match and leaves the terrain where it was. */
  query: string;
}) {
  const graph = useMemo(() => layout(concepts, abilities, progress), [concepts, abilities, progress]);
  const [hovered, setHovered] = useState<string | null>(null);
  /* Pan and zoom as one transform on the scene rather than on the viewBox, so
     hairlines and type keep their weight while the geometry moves. */
  const [view, setView] = useState(IDENTITY);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);

  if (!concepts.length) {
    return (
      <EmptyState
        description="Spar files every problem it sets under the concepts it is about. Solve something and this fills in."
        icon={Waypoints}
        title="Nothing mapped yet"
      />
    );
  }

  const needle = query.trim().toLowerCase();
  /* What the pointer is on, and everything one edge away from it. Dimming the
     rest is the only way a graph answers "what touches this" — the alternative
     is tracing lines by eye under everything drawn over them. */
  const near = new Set<string>();
  if (hovered) {
    near.add(hovered);
    for (const edge of graph.edges) {
      if (edge.from === hovered) near.add(edge.to);
      if (edge.to === hovered) near.add(edge.from);
    }
  }
  const lit = (node: Node) => {
    if (hovered) return near.has(node.id);
    if (needle) return node.label.toLowerCase().includes(needle);
    return true;
  };
  const focus = hovered ? graph.index.get(hovered) : undefined;
  const moved = view.x !== 0 || view.y !== 0 || view.scale !== 1;

  /* Screen pixels are not user units. The viewBox is cut to the drawing, so how
     many units a pixel is worth depends on the panel's size and changes with
     the window — and `preserveAspectRatio` letterboxes the short axis, which
     offsets the origin as well as scaling it. Dragging and zooming both have to
     go through this or the canvas slides at the wrong speed and the pointer
     zooms about the wrong point. */
  const frame = (svg: SVGSVGElement) => {
    const rect = svg.getBoundingClientRect();
    const [bx, by, bw, bh] = graph.viewBox.split(" ").map(Number) as [number, number, number, number];
    const fit = Math.min(rect.width / bw, rect.height / bh);
    return {
      fit,
      /* Where the drawing's top-left actually lands, in user units. */
      left: bx - (rect.width - bw * fit) / 2 / fit,
      top: by - (rect.height - bh * fit) / 2 / fit,
      rect,
    };
  };

  return (
    <div className="relative overflow-hidden rounded-[var(--radius-xl)] border-[length:var(--hairline)] border-[var(--border-surface-strong)] bg-[var(--surface-primary)]">
      <svg
        className={cn("block h-[clamp(20rem,calc(100vh-17rem),36rem)] w-full select-none", drag.current ? "cursor-grabbing" : "cursor-grab")}
        onMouseDown={(event) => { drag.current = { x: event.clientX, y: event.clientY, ox: view.x, oy: view.y, moved: false }; }}
        onMouseLeave={() => { drag.current = null; }}
        onMouseMove={(event) => {
          const held = drag.current;
          if (!held) return;
          const dx = event.clientX - held.x;
          const dy = event.clientY - held.y;
          /* A drag is not a click. Without this, nudging the canvas by two
             pixels on the way to letting go opens whatever was underneath. */
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) held.moved = true;
          const { fit } = frame(event.currentTarget);
          setView((current) => ({ ...current, x: held.ox + dx / fit, y: held.oy + dy / fit }));
        }}
        onMouseUp={() => { drag.current = null; }}
        onWheel={(event) => {
          /* Zoom about the pointer rather than about the origin, so the thing
             under the cursor is the thing that stays still. */
          const { fit, left, top, rect } = frame(event.currentTarget);
          const px = left + (event.clientX - rect.left) / fit;
          const py = top + (event.clientY - rect.top) / fit;
          setView((current) => {
            const scale = Math.min(3, Math.max(0.5, current.scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
            const ratio = scale / current.scale;
            return { scale, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
          });
        }}
        role="img"
        aria-label="A map of every concept Spar has met and the abilities claimed over them"
        viewBox={graph.viewBox}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          <g className="text-[var(--border-surface-strong)]" fill="none" stroke="currentColor">
            {graph.edges.map((edge) => {
              const from = graph.index.get(edge.from)!;
              const to = graph.index.get(edge.to)!;
              const on = !hovered || (near.has(edge.from) && near.has(edge.to));
              return (
                <path
                  d={curve(from, to)}
                  key={`${edge.from}-${edge.to}`}
                  opacity={on ? (edge.kind === "claim" ? 0.55 : 0.9) : 0.1}
                  strokeDasharray={edge.kind === "claim" ? "2 4" : undefined}
                  strokeLinecap="round"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </g>

          {graph.nodes.map((node) => {
            const on = lit(node);
            const active = hovered === node.id;
            return (
              <g
                className="cursor-pointer transition-opacity duration-150"
                key={node.id}
                onClick={() => {
                  if (drag.current?.moved) return;
                  node.kind === "concept" ? onOpenConcept(node.slug!) : onOpenAbility(node.abilityId!);
                }}
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered((current) => (current === node.id ? null : current))}
                opacity={on ? 1 : 0.14}
              >
                {/* The halo. A ring of the page's own accent rather than a glow:
                    the app has no glows in it, and the one thing this has to say
                    is "this is the one you are pointing at". */}
                {active && (
                  <circle cx={node.x} cy={node.y} fill="currentColor" className="text-foreground" fillOpacity={0.07} r={node.r + 9} />
                )}

                {node.kind === "concept" ? <ConceptNode node={node} /> : <AbilityNode node={node} />}

                {/* Concepts are always named and abilities are named on hover.
                    The terrain keeps its labels and the claims over it give
                    theirs up until you go looking — and sizing that rule by
                    radius, which is what it was, left half the subject tree as
                    anonymous dots.

                    The halo behind the type is what makes it readable where an
                    edge runs under it. `paint-order: stroke` draws the outline
                    first and the ink over it, so the letterforms keep their
                    weight instead of being thinned by their own outline. */}
                {(node.kind === "concept" || active) && (
                  <text
                    className={cn("pointer-events-none", node.attempted ? "fill-foreground" : "fill-muted-foreground")}
                    fontSize={10.5}
                    fontWeight={500}
                    paintOrder="stroke"
                    stroke="var(--surface-primary)"
                    strokeLinejoin="round"
                    strokeWidth={3.5}
                    textAnchor="middle"
                    x={node.x}
                    y={node.y + node.r + 12}
                  >
                    {node.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Back to where it started. Only once there is somewhere to come back
          from — a control that does nothing on arrival is a control you have to
          learn to ignore. */}
      {moved && (
        <button
          className="absolute right-3 top-3 rounded-[var(--radius-md)] border-[length:var(--hairline)] border-[var(--border-surface-strong)] bg-[var(--surface-tertiary)] px-2 py-1 text-ui-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => setView(IDENTITY)}
          type="button"
        >
          Reset view
        </button>
      )}

      {/* What the pointer is on, pinned rather than chasing the cursor: a label
          that moves with the pointer covers the neighbours you hovered the node
          to see. It holds its height whether or not anything is hovered, so the
          map does not resize under you on the way in. */}
      <div className="pointer-events-none absolute bottom-14 left-4 max-w-[22rem]">
        {focus && (
          <div className="rounded-[var(--radius-lg)] border-[length:var(--hairline)] border-[var(--border-surface-strong)] bg-[var(--surface-tertiary)] px-3 py-2">
            <p className="truncate text-ui font-semibold tracking-[-0.01em]">{focus.label}</p>
            <p className="mt-0.5 text-ui-sm text-muted-foreground">{focus.note}</p>
          </div>
        )}
      </div>

      {/* The key, on the panel's own footer rule — the same place `RatingHero`
          hangs its counts, for the same reason: it belongs to the surface above
          it rather than being a second thing under it. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t-[length:var(--hairline)] border-[var(--border-surface-strong)] bg-[var(--surface-tertiary)] px-3.5 py-2 text-ui-sm text-muted-foreground">
        <Key>
          <svg aria-hidden className="size-3.5" viewBox="0 0 16 16">
            <circle cx="8" cy="8" fill="currentColor" fillOpacity="0.18" r="5.4" />
            <circle cx="8" cy="8" fill="none" opacity="0.35" r="5.4" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="8" cy="8" fill="none" r="5.4" stroke="currentColor" strokeDasharray="25 34" strokeLinecap="round" strokeWidth="1.6" transform="rotate(-90 8 8)" />
          </svg>
          concept — arc is what you have passed
        </Key>
        <Key>
          <svg aria-hidden className="size-3.5" viewBox="0 0 16 16"><rect fill="currentColor" height="8" rx="2" transform="rotate(45 8 8)" width="8" x="4" y="4" /></svg>
          ability
        </Key>
        <Key>
          <svg aria-hidden className="size-3.5" viewBox="0 0 16 16"><circle cx="8" cy="8" fill="none" opacity="0.6" r="5.4" stroke="currentColor" strokeDasharray="2 2.5" strokeWidth="1.4" /></svg>
          never attempted
        </Key>
        <span className="ml-auto tabular-nums">
          {concepts.length} concepts · {graph.claims} abilities{graph.untouched > 0 && ` · ${graph.untouched} untouched`}
        </span>
      </div>
    </div>
  );
}

/**
 * A concept, as a ring with an arc on it.
 *
 * The same figure the app already draws beside every ability — see `StatusRing`
 * — because it is the same claim: how far round is this, and how sure are we.
 * The track is the whole subject, the arc is what has been passed, and the disc
 * inside carries the kind's colour so a glance down the map separates algorithms
 * from craft without reading a word.
 *
 * Never attempted is the state that has to survive being glanced at — it is the
 * whole reason to look at a map of a subject rather than a list of it — so it is
 * the one node with no fill and a broken rim.
 */
function ConceptNode({ node }: { node: Node }) {
  const circumference = 2 * Math.PI * node.r;

  if (!node.attempted) {
    return (
      <circle
        cx={node.x}
        cy={node.y}
        fill="none"
        opacity={0.55}
        r={node.r}
        stroke={node.colour}
        strokeDasharray="2.5 3"
        strokeWidth={1.4}
      />
    );
  }

  return (
    <>
      <circle cx={node.x} cy={node.y} fill={node.colour} fillOpacity={0.16} r={node.r} />
      <circle cx={node.x} cy={node.y} fill="none" opacity={0.28} r={node.r} stroke={node.colour} strokeWidth={1.6} />
      <circle
        cx={node.x}
        cy={node.y}
        fill="none"
        r={node.r}
        stroke={node.colour}
        strokeDasharray={`${circumference * node.strength} ${circumference}`}
        strokeLinecap="round"
        strokeWidth={1.6}
        /* Started at twelve o'clock, like every other arc in the app. */
        transform={`rotate(-90 ${node.x} ${node.y})`}
      />
    </>
  );
}

/** An ability, as a rounded tile stood on its corner.
 *
 *  A different shape rather than a different colour: the two kinds of node are
 *  different kinds of thing — a subject, and a claim about the learner — and
 *  shape is the one channel that separates them at this size without competing
 *  with the kind tints. Rounded rather than a sharp diamond, because nothing
 *  else in this window has a hard corner on it. */
function AbilityNode({ node }: { node: Node }) {
  const side = node.r * 1.65;
  return (
    <g className={STATUS[node.status!].text}>
      <rect
        fill="currentColor"
        fillOpacity={0.92}
        height={side}
        rx={side * 0.28}
        transform={`rotate(45 ${node.x} ${node.y})`}
        width={side}
        x={node.x - side / 2}
        y={node.y - side / 2}
      />
    </g>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return <span className="flex items-center gap-1.5">{children}</span>;
}

/** A slight bow on every edge. Straight lines between circles read as a
 *  schematic; a consistent curve reads as something drawn — and where two nodes
 *  share several links the bow is what stops them landing on top of each other. */
function curve(from: Node, to: Node) {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(Math.hypot(dx, dy), 0.01);
  const bow = Math.min(length * 0.09, 26);
  return `M${from.x} ${from.y} Q${mx - (dy / length) * bow} ${my + (dx / length) * bow} ${to.x} ${to.y}`;
}

const IDENTITY = { x: 0, y: 0, scale: 1 };

type Node = {
  id: string;
  kind: "concept" | "ability";
  label: string;
  note: string;
  r: number;
  x: number;
  y: number;
  strength: number;
  attempted: boolean;
  /* Concepts only. */
  slug?: string;
  colour?: string;
  /* Abilities only. */
  abilityId?: string;
  status?: AbilityHistorySummary["status"];
};

type Edge = { from: string; to: string; kind: "tree" | "claim" };

const WIDTH = 1200;
const HEIGHT = 640;

/**
 * Where everything sits.
 *
 * A relaxation, not a simulation: repulsion between every pair, springs along
 * the edges, and a weak pull to the middle so nothing that is connected to
 * nothing drifts off the canvas. It runs to completion here and hands back a set
 * of coordinates — there is no animation frame and no state.
 *
 * Seeded off a counter through a fixed generator rather than `Math.random`,
 * which is what makes the picture reproducible. Two visits have to produce the
 * same map or it is not one.
 */
function layout(concepts: ConceptSummary[], abilities: AbilityHistorySummary[], progress: LearnerProgress): {
  claims: number;
  edges: Edge[];
  index: Map<string, Node>;
  nodes: Node[];
  untouched: number;
  viewBox: string;
} {
  const slugs = new Set(concepts.map((concept) => concept.slug));
  const machine = new Map(progress.abilities.map((ability) => [ability.abilityId, ability]));
  let seed = 1;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

  const nodes: Node[] = [];
  const edges: Edge[] = [];

  for (const concept of concepts) {
    const standing = standingOf(concept);
    const attempted = concept.challengeCount > 0;
    nodes.push({
      id: `c:${concept.slug}`,
      kind: "concept",
      label: concept.title,
      note: attempted
        ? `${CONCEPT_KIND_SHORT[concept.kind]} · ${standing.label} · ${concept.passedCount} of ${concept.challengeCount} passed`
        : `${CONCEPT_KIND_SHORT[concept.kind]} · never attempted`,
      /* Area by count, so a landmark is a concept you have actually spent time
         in. Square-rooted, because a concept with forty challenges under it is
         not forty times the landmark the one with a single challenge is. */
      r: 8 + Math.min(Math.sqrt(concept.challengeCount) * 3.2, 14),
      strength: standing.strength ?? 0,
      attempted,
      colour: CONCEPT_KIND_VAR[concept.kind],
      slug: concept.slug,
      x: WIDTH / 2 + (random() - 0.5) * 420,
      y: HEIGHT / 2 + (random() - 0.5) * 280,
    });
    if (concept.parentSlug && slugs.has(concept.parentSlug)) {
      edges.push({ from: `c:${concept.parentSlug}`, to: `c:${concept.slug}`, kind: "tree" });
    }
  }

  for (const ability of abilities) {
    const state = machine.get(ability.id);
    nodes.push({
      id: `a:${ability.id}`,
      kind: "ability",
      label: ability.title,
      note: state
        ? `${STATUS[ability.status].label} · ${Math.round(state.proficiency * 100)}% · ${ability.evidenceCount} evidence`
        : `${STATUS[ability.status].label} · ${ability.evidenceCount} evidence`,
      r: 7 + Math.min(ability.evidenceCount * 0.8, 5),
      strength: state?.proficiency ?? 0,
      attempted: true,
      abilityId: ability.id,
      status: ability.status,
      x: WIDTH / 2 + (random() - 0.5) * 420,
      y: HEIGHT / 2 + (random() - 0.5) * 280,
    });
    for (const tag of ability.concepts) {
      if (slugs.has(tag.slug)) edges.push({ from: `a:${ability.id}`, to: `c:${tag.slug}`, kind: "claim" });
    }
  }

  const index = new Map(nodes.map((node) => [node.id, node]));
  const links = edges.filter((edge) => index.has(edge.from) && index.has(edge.to));

  const ITERATIONS = 420;
  for (let step = 0; step < ITERATIONS; step += 1) {
    const cooling = 1 - step / ITERATIONS;

    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distance = Math.hypot(dx, dy);
        /* Two nodes on exactly the same point have no direction to separate
           along, so they are given one rather than dividing by zero. */
        if (distance < 0.01) { dx = random() - 0.5; dy = random() - 0.5; distance = 0.01; }
        const push = (9500 / (distance * distance)) * cooling;
        a.x += (dx / distance) * push;
        a.y += (dy / distance) * push;
        b.x -= (dx / distance) * push;
        b.y -= (dy / distance) * push;
      }
    }

    for (const link of links) {
      const a = index.get(link.from)!;
      const b = index.get(link.to)!;
      const rest = link.kind === "tree" ? 100 : 74;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.max(Math.hypot(dx, dy), 0.01);
      const pull = ((distance - rest) / distance) * 0.09 * cooling;
      a.x += dx * pull;
      a.y += dy * pull;
      b.x -= dx * pull;
      b.y -= dy * pull;
    }

    for (const node of nodes) {
      node.x += (WIDTH / 2 - node.x) * 0.012 * cooling;
      node.y += (HEIGHT / 2 - node.y) * 0.012 * cooling;
    }
  }

  /* The canvas is cut to the drawing rather than the drawing scaled into a
     canvas. Fitting into a fixed 1200x640 box was the wrong way round: the
     relaxation settles into whatever shape the data has, and a box of a
     different proportion letterboxes it — on a wide panel that was a small
     graph marooned in the middle with a third of the surface empty either side.
     A viewBox cut to the node bounds lets `preserveAspectRatio` fill whatever
     the panel actually is.

     Bottom padding is larger than the rest because every concept carries a
     label under it, and a label is not part of a node's radius. */
  const pad = 28;
  const minX = Math.min(...nodes.map((node) => node.x - node.r)) - pad;
  const maxX = Math.max(...nodes.map((node) => node.x + node.r)) + pad;
  const minY = Math.min(...nodes.map((node) => node.y - node.r)) - pad;
  const maxY = Math.max(...nodes.map((node) => node.y + node.r + 18)) + pad;

  return {
    claims: abilities.length,
    edges: links,
    index,
    nodes,
    untouched: concepts.filter((concept) => concept.challengeCount === 0).length,
    viewBox: `${minX} ${minY} ${Math.max(maxX - minX, 1)} ${Math.max(maxY - minY, 1)}`,
  };
}
