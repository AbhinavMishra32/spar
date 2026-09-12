import type { DeclaredSignature } from "../../language.js";
import type { EntryPoint, InputDraft, InputSpec } from "../../inputs.js";
import { composeSetup } from "./compose.js";
import { specFromAnalysis, specFromSignature, type PythonAnalysis } from "./shapes.js";

export { specFromAnalysis, specFromSignature, mergeSpecs, fieldFromAnnotation, guessFromName, pythonAnnotation } from "./shapes.js";
export type { PythonAnalysis, ClassShape } from "./shapes.js";
export { composeSetup, encodeValue } from "./compose.js";

/**
 * Everything about Python the renderer is allowed to know.
 *
 * Deliberately free of `node:` imports. The same package is bundled into the
 * sandboxed renderer and loaded in the main process, and the renderer needs the
 * half of the adapter that is pure text work — composing a call, naming a type,
 * spelling a value the way Python spells it. The half that names an executable
 * and a path on disk lives in `./host`, which the renderer never imports and
 * Vite therefore never has to shim `node:path` for.
 */

/**
 * Helpers the tracer injects into every run, and that an exported script has to
 * carry itself.
 *
 * These are LeetCode's own conventions rather than Spar's invention: a problem
 * that says "you are given the head of a linked list" means this `ListNode`, and
 * a problem that states its tree as `[3,9,20,null,null,15,7]` means this
 * level-order reading of it. The visualiser has to speak the same dialect as the
 * problems it visualises, or every pasted solution needs editing first.
 *
 * Kept as exactly the text the runtime defines, so Export produces a file that
 * runs unchanged outside Spar. A prelude that has drifted from the runtime is
 * worse than no prelude: the exported script then fails somewhere other than
 * where the learner is looking.
 */
export const PYTHON_PRELUDE = `from typing import *
from collections import deque, Counter, defaultdict, OrderedDict
import bisect
import functools
import heapq
import itertools
import math

class ListNode:
    def __init__(self, val=0, next=None):
        self.val, self.next = val, next

class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val, self.left, self.right = val, left, right

def linked_list(values):
    head = None
    for value in reversed(values):
        head = ListNode(value, head)
    return head

def tree(values):
    if not values or values[0] is None:
        return None
    root = TreeNode(values[0])
    queue = deque([root])
    items = iter(values[1:])
    while queue:
        parent = queue.popleft()
        for field in ('left', 'right'):
            value = next(items, None)
            if value is not None:
                node = TreeNode(value)
                setattr(parent, field, node)
                queue.append(node)
    return root

def show(value):
    """Render a result the way a problem states it: a chain as a list, a tree as
    its level-order array. Anything else is returned untouched."""
    if isinstance(value, TreeNode):
        levels, queue = [], deque([value])
        while queue:
            node = queue.popleft()
            if node is None:
                levels.append(None)
                continue
            levels.append(node.val)
            queue.append(node.left)
            queue.append(node.right)
        while levels and levels[-1] is None:
            levels.pop()
        return levels
    if isinstance(value, ListNode):
        items, node = [], value
        while node is not None:
            items.append(node.val)
            node = node.next
        return items
    if isinstance(value, (list, tuple)):
        return type(value)(show(item) for item in value)
    return value

`;

/** What an empty visualiser opens on. Chosen to show something immediately: it
 *  has a dictionary that grows, a loop that exits early, and a return value, so
 *  the first run a learner sees has all three panels doing something. */
export const PYTHON_STARTER = `class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:
        seen = {}
        for index, value in enumerate(nums):
            complement = target - value
            if complement in seen:
                return [seen[complement], index]
            seen[value] = index
        return []
`;

/** Python's spelling of the three literals JSON disagrees with. The inspector
 *  reads in the language the learner is writing, not in the wire format. */
export const PYTHON_LITERALS = { null: "None", true: "True", false: "False" } as const;

/** The pure half of the adapter, shared by both processes. */
export const pythonDialect = {
  id: "python" as const,
  label: "Python",
  fileName: "algorithm.py",
  editorLanguage: "python",
  prelude: PYTHON_PRELUDE,
  starter: PYTHON_STARTER,
  literals: PYTHON_LITERALS,
  specFromSignature: (signature: DeclaredSignature): InputSpec => specFromSignature(signature),
  specFromAnalysis: (analysis: PythonAnalysis): InputSpec => specFromAnalysis(analysis),
  composeSetup: (entry: EntryPoint, draft: InputDraft): string => composeSetup(entry, draft),
};
