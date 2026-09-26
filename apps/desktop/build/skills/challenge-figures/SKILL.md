---
name: challenge-figures
description: Draw diagrams in challenge statements — binary trees, linked lists, graphs, grids and arrays — the way LeetCode shows a picture beside its examples. Use when writing a challenge whose input is a structure a learner understands faster by seeing it.
---

# Challenge figures

A statement can carry pictures. You do not draw them: you write a fenced block with the language `figure` whose body is one JSON spec, and Spar lays it out and draws it in the app's style, in light and dark. You cannot see the result, so the spec is built so that a figure that validates looks right. A figure that does not validate is refused when you publish, with the field at fault named — fix that field and publish again.

## When to use one

- The input is a tree, list, graph, grid or array whose shape is the problem: lone children, a cycle, a route, walls, a window.
- One figure per example that needs it, placed directly above that example's `Input:` line. Usually only Example 1 needs one.
- Not for plain numbers or strings, and not for anything the example line already makes obvious.
- Only in challenge statements. Do not put figures in chat replies or hints unless the learner asks to see a structure drawn.

## The rule that matters most

Use the same values as the example line. An example written `root = [3,9,20,null,null,15,7]` gets `"values": [3,9,20,null,null,15,7]` — the exact LeetCode serialisation, nulls included. Never draw a different instance from the one the example states.

## Specs

Every spec is one JSON object with a `type`. Unknown keys are rejected. Keep the JSON on one line.

Highlighting uses four tones, each an array of node keys: `mark` (look here), `good` (the answer or the route), `bad` (removed or wrong), `info` (a region). Keys are indexes for trees, lists and arrays, and node labels for graphs. Use them sparingly — one idea per figure.

### tree — a binary tree

```figure
{"type":"tree","values":[3,9,20,null,null,15,7]}
```

- `values`: the level-order array with `null` for missing children, at most 63 entries.
- `removed`: indexes drawn faded and dashed, for pruned or deleted nodes.
- `path`: indexes of a root-to-node route; the edges between them are drawn as the route.
- Every index is a position in `values`, counting the nulls.

### list — a linked list

```figure
{"type":"list","values":[3,2,0,-4],"cycle":1,"labels":{"0":"head"}}
```

- `cycle`: the index the tail points back to, LeetCode's `pos`. Leave it out when there is no cycle.
- `labels`: short names above nodes, keyed by index as a string.

### graph — nodes and edges

```figure
{"type":"graph","edges":[["A","B",4],["A","C",2],["C","B",1]],"path":["A","C","B"],"good":["A","B"]}
```

- `edges`: `[from, to]` or `[from, to, weight]`. Labels are numbers or short strings.
- `directed`: `true` draws arrows. Undirected by default.
- `nodes`: only needed for nodes with no edges.
- `path`: a walk through the graph; every consecutive pair must be an edge.
- Laid out left to right automatically. Keep it to about 12 nodes.

### grid — a matrix, board or maze

```figure
{"type":"grid","cells":[[0,0,1],[1,0,1],[1,0,0]],"wall":1,"showValues":false,"path":[[0,0],[0,1],[1,1],[2,1],[2,2]]}
```

- `cells`: rows of equal length, at most 12 by 12.
- `wall`: the cell value drawn as a solid wall.
- `fill`: cell value to tone, for example `{"1":"info"}` to shade land in an islands problem.
- `path`: `[row, col]` cells, each a neighbour of the one before. With `showValues` false the ends are marked S and E.

### array — values with indexes, a window and pointers

```figure
{"type":"array","values":[4,6,5,5,7,8],"window":[1,4],"pointers":{"left":1,"right":4}}
```

- `window`: an inclusive `[from, to]` range, shaded.
- `pointers`: a name for each index, drawn as arrows under the cells.

### row — before and after

```figure
{"type":"row","captions":["root","after pruning"],"items":[{"type":"tree","values":[8,3,10,1,6],"removed":[3]},{"type":"tree","values":[8,3,10,null,6]}]}
```

- Two or three of the specs above side by side, with arrows between them. Set `"arrows": false` to leave the arrows out.

## Placing a figure in a statement

Put the fence on its own lines inside the Examples section, directly above the example it illustrates:

- a line `**Example 1**`
- the ```figure fence with the spec
- the `Input:` line, then `Output:` and `Explanation:` as usual

The figure is drawn inside that example's card, above its input.
