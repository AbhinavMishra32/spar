---
name: challenge-figures
description: Draw figures — trees, linked lists, graphs (any arity, state machines, recursion trees, tries), grids and DP tables, arrays and bars, stacks, intervals and tables — with highlights, notes, routes, arrows and before/after steps, in a reply, a lesson page or a challenge statement. Load it whenever a picture would make a structure, a state or a step of an algorithm faster to understand than words.
---

# Figures

You can draw. Write a fenced block with the language `figure` whose body is one JSON spec, and Spar lays it out and draws it in the app's style, in light and dark. You never see the result, so the spec is built so that a figure that validates looks right: layout, spacing and colour are Spar's job, and yours is to say what is in the picture and what matters in it.

Every figure is checked before anyone sees it. In a statement or a lesson a broken figure is refused with the field at fault; in a reply, the reply comes back to you with the reason. Fix that field and send again.

## When to draw

Draw whenever the learner would otherwise have to build the picture in their head. That is often, in this work:

- the input is a structure whose shape is the point — a tree with a lone child, a list with a cycle, a graph, a grid with walls;
- you are explaining a state — where two pointers sit, what is on the stack, which window is live, which DP cells a cell is built from;
- something changes — before and after a rotation, the steps of a merge, a list mid-reversal;
- they are confused about what their code does to a structure: draw what it actually does next to what they expected;
- a challenge statement's example is a tree, list, graph, grid or anything with a shape.

Leave it out when the words already carry it: a plain number or string, a one-line fact, a picture that would only repeat the sentence beside it, or the same structure you drew two messages ago with nothing new marked. One good figure beats three. Each figure should make one point, and its highlights should be the point.

In a reply, put the figure where it answers the question and say in a sentence what to look at. In a lesson, a figure per state change is often the lesson. In a statement, see the placement section below.

## The rule that matters most

Draw the real instance. A figure for `root = [3,9,20,null,null,15,7]` uses `"values": [3,9,20,null,null,15,7]` — the exact serialisation, nulls included. Never draw a different instance from the one the text states, and when you trace an algorithm, trace it on the values you are talking about.

## One vocabulary for every figure

Every spec is one JSON object with a `type`. Keep it on one line. Unknown keys are refused. Every key a field names is checked against the structure, so a highlight can never silently miss.

- **Tones**: `mark` (look here), `good` (the answer, the route, what is done), `bad` (wrong, removed, the violation), `info` (a region, a frontier, a pointer's reach). Each is an array of element keys. An element takes one tone.
- **Keys**: indexes for trees (level-order position, counting nulls), lists, arrays, stacks and intervals; node ids for graphs; `[row, col]` for grid cells; `[row, col]` or a row number for tables.
- **labels**: a few words beside one element (up to 28 characters) — a running sum, a distance, `lo`, `LCA`, `memo hit`. Keyed by the element's key as a string: `{"3": "sum 20"}`, or `{"2,1": "3+3"}` for a grid.
- **removed**: elements drawn faded and dashed — deleted, pruned, popped, skipped.
- **edgeTones**: for trees and graphs, the same four tones on edges, each a list of `[a, b]` pairs of node keys.
- **caption**: one or two sentences under the figure saying what it shows.

A `path` (trees, graphs, grids) tones its nodes and edges `good` for you; an explicit tone on a node on the path wins, so you can `mark` where the route ends.

## Specs

### tree — a binary tree

```figure
{"type":"tree","values":[5,4,8,11,null,13,4,7,2],"path":[0,1,3,8],"mark":[8],"labels":{"8":"sum 22"}}
```

- `values`: level-order with `null` for a missing child, up to 127 entries. As in LeetCode, a null has no children listed after it.
- `path`: indexes in walking order, each the parent or child of the one before — root-to-leaf, or up through a common ancestor and down again.
- `removed`, `labels`, `edgeTones` (pairs of parent and child indexes), tones, `caption`.
- Heaps, BSTs, segment trees and tries-as-binary are all trees: put ranges or bounds in `labels`.

### list — a linked list

```figure
{"type":"list","values":[1,2,3,4,5],"reversed":[0,1],"cut":[2],"pointers":{"prev":2,"cur":3}}
```

- `cycle`: the index the tail points back to (LeetCode's `pos`).
- `pointers`: name → index, drawn as arrows down onto a node: `slow`, `fast`, `prev`, `cur`, `dummy`.
- `labels`: short names above nodes, like `head`.
- `reversed`: indexes whose next link points backward, for a list mid-reversal. `cut`: indexes whose next link is severed.
- `links`: extra arrows under the list, `[from, to]` or `[from, to, tone]` — random pointers, a splice, where a node will be re-linked.
- `removed`, tones, `caption`. Up to 16 nodes.

### graph — nodes and edges, any shape

```figure
{"type":"graph","edges":[["A","B",4],["A","C",2],["C","B",1],["B","D",5]],"path":["A","C","B","D"],"labels":{"A":"0","C":"2","B":"3","D":"8"}}
```

- `edges`: `[from, to]` or `[from, to, label]`; the label is a weight, a character, a condition. Self-loops (`["q","q","a"]`) and edges both ways are drawn properly.
- `directed`: `true` draws arrows. `nodes`: isolated nodes, or to fix declaration order.
- `layout`: `"LR"` (default) or `"TB"` — top to bottom for anything tree-like with more than two children: n-ary trees, recursion trees, tries, union-find forests, DAG levels.
- `names`: text drawn inside a node instead of its id, so ids stay unique while nodes read the same — `{"n4":"fib(2)","n7":"fib(2)"}`.
- `shape`: `"box"` for states or longer names; nodes whose text does not fit a circle become boxes on their own.
- `path`, `labels` (above the node, or beside it in `TB`), `removed` (fades the node and its edges), `edgeTones`, tones, `caption`. Up to 40 nodes and 80 edges; keep it to what the point needs.

### grid — a matrix, board, maze or DP table

```figure
{"type":"grid","rows":["","a","b","c"],"cols":["","a","c","e"],"cells":[[0,0,0,0],[0,1,1,1],[0,1,1,1],[0,1,2,2]],"mark":[[2,1]],"good":[[3,2]],"arrows":[[[2,1],[3,2],"good"]]}
```

- `cells`: rows of equal length, up to 20 × 20.
- `rows`, `cols`: headers down the left and along the top (blank allowed) — the two strings of an LCS table, the capacities of a knapsack.
- `arrows`: cell → cell, `[[r,c],[r,c]]` or with a tone — what a DP cell is built from, a move, a jump.
- `wall`: the value drawn as a solid wall. `fill`: value → tone, like `{"1":"info"}` for land.
- `path`: `[row, col]` cells, each a neighbour of the one before. With `"showValues": false` its ends read S and E.
- `labels` (`"row,col"` → words in the cell's corner, or its middle when values are hidden), tones on `[row, col]`, `caption`.

### array — values, windows, pointers, spans, arcs, bars

```figure
{"type":"array","values":[4,6,5,5,7,8],"window":[1,4],"pointers":{"left":1,"right":4},"bad":[5],"labels":{"5":"too big"}}
```

- `values`: up to 32; strings work for characters.
- `window`: an inclusive `[from, to]`, shaded. `pointers`: name → index, arrows under the cells.
- `ranges`: brackets under the cells, `{"from":1,"to":3,"label":"sum 7","tone":"good"}` — subarrays, partitions, prefix spans.
- `arrows`: arcs over the cells, `[from, to]` or with a tone — next-greater links, jumps, swaps.
- `bars`: `true` draws numbers as bars, for heights, histograms and rain water.
- `indexes`: `false` hides the index row. `removed` strikes a cell. `labels`, tones, `caption`.

### stack — values bottom to top

```figure
{"type":"stack","values":[1,3,5,6],"mark":[3],"labels":{"3":"pushed"}}
```

- The last value is the top; it is pointed at. Empty is allowed. `removed` for a pop, `labels` beside entries, tones, `caption`.
- A queue or deque is an `array` with `front` and `back` pointers.

### intervals — spans on a number line

```figure
{"type":"intervals","items":[[1,3],[2,6],[8,10],[15,18]],"good":[0,1],"markers":{"t=5":5}}
```

- `items`: `[start, end]` pairs, one lane each; `packed: true` shares lanes between intervals that do not overlap (meeting rooms).
- `markers`: name → position, a dashed line across every lane — a sweep line, a query point.
- `labels` replace the `[start,end]` text. `removed`, tones, `caption`.

### table — rows of text

```figure
{"type":"table","columns":["i","x","cur","best"],"rows":[[0,-2,-2,-2],[1,1,1,1],[2,-3,-2,1],[3,4,4,4]],"mark":[[3,3]]}
```

- A step-by-step trace, a hash map's contents, a comparison. `columns` is the header; cells hold up to 40 characters.
- Tones take `[row, col]` for a cell or a row number for the whole row (counting from 0, header not counted).

### row and column — several figures in order

```figure
{"type":"row","captions":["delete 3","after"],"items":[{"type":"tree","values":[5,3,6,2,4,null,7],"bad":[1]},{"type":"tree","values":[5,4,6,2,null,null,7],"good":[1]}]}
```

- `items`: two to four of the specs above, side by side (`row`) or stacked (`column`), with arrows between. `"arrows": false` leaves them out.
- `captions`: a short title over each item; each item can also carry its own `caption`.
- Use it for before → after, and for the steps of an algorithm when each step changes the picture.

## Choosing a figure

| To show | Draw |
| --- | --- |
| a tree's shape, a root-to-leaf route, where recursion is | `tree` with `path`, `labels` for returned values |
| an n-ary tree, a trie, a recursion tree, memo hits | `graph` with `"layout":"TB"`, `names`, `removed` for pruned calls |
| BFS layers, Dijkstra distances, a topological order | `graph` with `labels` per node, `info` for the frontier |
| a cycle, a bad edge, a cut | `edgeTones` with `bad` |
| a state machine or automaton | `graph`, `directed`, `"shape":"box"`, edge labels, self-loops |
| union-find parents | `graph`, `directed`, `"layout":"TB"`, roots in `good` |
| two pointers, a sliding window, binary search `lo`/`mid`/`hi` | `array` with `pointers` and `window` |
| prefix sums, partitions, a subarray's sum | `array` with `ranges` |
| monotonic stack links, jumps | `array` with `arrows`, or `stack` |
| heights, histograms, trapped water | `array` with `bars` |
| a DP table and where a cell comes from | `grid` with `rows`/`cols`, `arrows`, the answer cell `good` |
| islands, flood fill, maze routes | `grid` with `fill`, `wall`, `path`, `"showValues": false` |
| list reversal, fast/slow pointers, splicing | `list` with `reversed`, `pointers`, `links` |
| merging or scheduling intervals | `intervals`, `packed`, `markers` |
| a variable trace over iterations, a hash map | `table` |
| what changed | `row` of the before and after |

## Placing a figure in a challenge statement

Put the fence on its own lines inside the Examples section, directly above the example it illustrates:

- a line `**Example 1**`
- the ```figure fence with the spec
- the `Input:` line, then `Output:` and `Explanation:` as usual

The figure is drawn inside that example's card, above its input. Usually Example 1 is the one that needs it; add one to another example only when its shape is different in a way that matters. Mark the answer in a statement figure when the example's output is a route, a node or a region, the way LeetCode highlights it.
