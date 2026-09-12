"""Spar's Python tracer.

Two jobs, one program, chosen by the `mode` field of the JSON request on stdin.

`trace` runs the learner's code under `sys.settrace` and emits one snapshot per
step: locals, the call stack, everything reachable on the heap, and stdout so
far. Object identity is preserved across snapshots — the same list is the same
`@n` in every frame it survives into — which is the whole reason the canvas can
hold a node still while the pointer beside it moves, and the reason a detached
half of a linked list stays on screen instead of vanishing when nothing points
at it any more.

`analyze` never executes anything. It parses the source and reports what could
be called and what the learner's own classes look like, so the input form can be
generated from code that has not been run and might not even terminate.
Annotation strings are reported verbatim rather than interpreted: mapping a type
onto a form control happens once, in TypeScript, so the path through a source
problem's declared signature and the path through parsed source cannot drift.

Bounds are not optional. A visualiser is pointed at unfinished code by
definition, so a run that does not terminate is the normal case rather than the
exceptional one, and every limit here (steps, seconds, objects, container
length, output bytes) exists to make that produce a truncated trace instead of a
hung process. The host enforces its own wall clock on top of these.

Runnable directly under CPython, which is what Spar does, and importable for
tests.
"""
import ast
import bisect
import collections
import contextlib
import functools
import heapq
import io
import itertools
import json
import math
import sys
import time
import types
import typing


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
    queue = collections.deque([root])
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


def show(value, _seen=None):
    """Render a result the way a problem states it.

    Without this, a solution that returns a linked list prints
    `<__main__.ListNode object at 0x104...>`, which tells a learner comparing
    against an expected output of `[5,4,3,2,1]` precisely nothing. Chains become
    lists and trees become the level-order array with the trailing holes
    trimmed, which is the notation every statement uses — so the console line
    can be read straight across against the problem.

    Everything else is returned untouched: `show` must never be the reason a
    printed value differs from what the function actually returned. Cycles are
    tracked because a half-finished reversal is very often a loop, and printing
    the answer should not be the thing that hangs.
    """
    _seen = _seen or set()
    if value is None or id(value) in _seen:
        return value if value is None else '<cycle>'
    if isinstance(value, TreeNode):
        _seen = _seen | {id(value)}
        levels, queue = [], collections.deque([value])
        while queue and len(levels) < 4096:
            node = queue.popleft()
            if node is None or id(node) in _seen and node is not value:
                levels.append(None)
                continue
            _seen = _seen | {id(node)}
            levels.append(node.val)
            queue.append(node.left)
            queue.append(node.right)
        while levels and levels[-1] is None:
            levels.pop()
        return levels
    if isinstance(value, ListNode):
        items, node = [], value
        while node is not None and len(items) < 4096:
            if id(node) in _seen:
                items.append('<cycle>')
                break
            _seen = _seen | {id(node)}
            items.append(node.val)
            node = node.next
        return items
    if isinstance(value, (list, tuple)):
        return type(value)(show(item, _seen) for item in value)
    return value


class TraceLimit(Exception):
    pass


class Output(io.StringIO):
    def write(self, text):
        remaining = max(0, 12000 - self.tell())
        super().write(text[:remaining])
        return len(text)


def trace_json(source, setup, max_steps=1500):
    started = time.monotonic()
    frames, registry, identities, pending = [], {}, {}, {}
    notes, error, truncated = {}, None, False
    class_locations = set()
    failed_frames = set()
    output = Output()
    # The standard library a solution is written against without thinking about
    # it. A problem that says "count the characters" is solved with a Counter,
    # and being made to import one first is friction that teaches nothing —
    # LeetCode's own judge pre-imports the same set. Must stay in step with the
    # exported prelude, which a test checks by running both.
    env = {'__name__': '__main__', 'ListNode': ListNode, 'TreeNode': TreeNode,
           'linked_list': linked_list, 'tree': tree, 'show': show,
           'deque': collections.deque, 'Counter': collections.Counter,
           'defaultdict': collections.defaultdict, 'OrderedDict': collections.OrderedDict,
           'heapq': heapq, 'math': math, 'bisect': bisect, 'itertools': itertools,
           'functools': functools}
    env.update({name: getattr(typing, name) for name in typing.__all__})

    def visible(values):
        result = {}
        for key, value in values.items():
            if key.startswith('__') or isinstance(value, (types.ModuleType, types.FunctionType, type)):
                continue
            if key in typing.__all__ and value is getattr(typing, key):
                continue
            if key == 'self':
                try:
                    fields = object.__getattribute__(value, '__dict__')
                except (AttributeError, TypeError):
                    fields = {}
                if not fields and not any(cls.__dict__.get('__slots__') for cls in type(value).__mro__):
                    continue  # Empty Solution wrappers add no useful state.
            result[key] = value
        return result

    def snapshot(frame, line, event, result=None, condition=None):
        if len(frames) >= max_steps or time.monotonic() - started > 8:
            raise TraceLimit('Trace limit reached. Use a smaller input or a terminating algorithm.')
        heap = {}

        def encode(value, depth=0):
            if value is None or type(value) in (bool, int, str):
                if isinstance(value, str):
                    return value[:500]
                if isinstance(value, int) and abs(value) > 9007199254740991:
                    return str(value) + ' (int)'
                return value
            if type(value) is float:
                return value if math.isfinite(value) else str(value)
            if isinstance(value, (types.ModuleType, types.FunctionType, type)):
                return '<' + type(value).__name__ + '>'
            identity = id(value)
            if identity not in identities:
                if len(registry) >= 160:
                    return '<object limit>'
                identities[identity] = 'n' + str(len(identities) + 1)
                registry[identity] = value  # Retain identity, including disconnected nodes.
            key = identities[identity]
            if key in heap:
                return {'ref': key}
            item = {'id': key, 'type': type(value).__name__, 'kind': 'object'}
            heap[key] = item
            if depth > 20:
                item['truncated'] = True
                return {'ref': key}
            if isinstance(value, (list, tuple, collections.deque, set, frozenset)):
                item['kind'] = 'set' if isinstance(value, (set, frozenset)) else 'array'
                items = list(value)[:80]
                item['items'] = [encode(v, depth + 1) for v in items]
                item['truncated'] = len(value) > 80
            elif isinstance(value, dict):
                item['kind'] = 'dict'
                item['entries'] = [[encode(k, depth + 1), encode(v, depth + 1)] for k, v in list(value.items())[:80]]
                item['truncated'] = len(value) > 80
            else:
                try:
                    fields = dict(object.__getattribute__(value, '__dict__'))
                except (AttributeError, TypeError):
                    fields = {}
                for cls in type(value).__mro__:
                    slots = cls.__dict__.get('__slots__', ())
                    for slot in ([slots] if isinstance(slots, str) else slots):
                        if slot.startswith('__'):
                            continue
                        try:
                            fields[slot] = object.__getattribute__(value, slot)
                        except AttributeError:
                            pass
                if 'left' in fields or 'right' in fields:
                    item['kind'] = 'tree'
                elif 'next' in fields:
                    item['kind'] = 'linked'
                item['fields'] = {k: encode(v, depth + 1) for k, v in list(fields.items())[:30]
                                  if not k.startswith('__')}
            return {'ref': key}

        stack, cursor = [], frame
        while cursor:
            if cursor.f_code.co_filename == 'algorithm.py':
                stack.append({'name': cursor.f_code.co_name, 'line': cursor.f_lineno,
                              'locals': {k: encode(v) for k, v in visible(cursor.f_locals).items()}})
            cursor = cursor.f_back
        local_values = {k: encode(v) for k, v in visible(frame.f_locals).items()}
        encoded_result = encode(result) if event == 'return' else None
        # Include retained objects so detached list halves stay on the canvas.
        for value in list(registry.values()):
            encode(value)
        frames.append({'line': line, 'event': event, 'function': frame.f_code.co_name,
                       'locals': local_values, 'heap': heap, 'stack': list(reversed(stack)),
                       'output': output.getvalue(), 'result': encoded_result, 'condition': condition})

    def trace(frame, event, arg):
        if frame.f_code.co_filename != 'algorithm.py' or (frame.f_code.co_name, frame.f_code.co_firstlineno) in class_locations:
            return trace
        if time.monotonic() - started > 8:
            raise TraceLimit('Execution exceeded 8 seconds.')
        key = id(frame)
        if event == 'call' and frame.f_code.co_name != '<module>':
            snapshot(frame, frame.f_lineno, 'call')
        elif event == 'line':
            failed_frames.discard(key)
            if key in pending:
                snapshot(frame, pending[key], 'step')
            pending[key] = frame.f_lineno
        elif event == 'return':
            if key in failed_frames:
                failed_frames.discard(key)
                pending.pop(key, None)
                return trace
            line = pending.pop(key, frame.f_lineno)
            snapshot(frame, line, 'return', arg)
        elif event == 'exception':
            failed_frames.add(key)
            snapshot(frame, frame.f_lineno, 'exception')
        return trace

    def capture_condition(value, line, expression, kind):
        # Truth conversion happens exactly once, including custom __bool__ methods.
        outcome = bool(value)
        caller = sys._getframe(1)
        pending.pop(id(caller), None)
        snapshot(caller, line, 'condition', condition={
            'expression': expression, 'result': outcome, 'kind': kind,
            'branch': ('Enter loop body' if outcome else 'Exit loop') if kind == 'while'
                      else ('Take true branch' if outcome else 'Take false branch')})
        return outcome

    class Conditions(ast.NodeTransformer):
        def instrument(self, node, kind):
            self.generic_visit(node)
            original = node.test
            node.test = ast.copy_location(ast.Call(
                func=ast.Name(id=condition_hook, ctx=ast.Load()),
                args=[original, ast.Constant(node.lineno), ast.Constant(ast.unparse(original)), ast.Constant(kind)],
                keywords=[]), original)
            return node

        def visit_If(self, node):
            return self.instrument(node, 'if')

        def visit_While(self, node):
            return self.instrument(node, 'while')

    try:
        parsed = ast.parse(source, filename='algorithm.py')
        class_locations = {(node.name, node.lineno) for node in ast.walk(parsed) if isinstance(node, ast.ClassDef)}
        for node in ast.walk(parsed):
            if isinstance(node, ast.stmt):
                targets = []
                for target in getattr(node, 'targets', [getattr(node, 'target', None)]):
                    if target is not None:
                        targets.append(ast.unparse(target))
                notes[str(node.lineno)] = {'kind': type(node).__name__,
                    'text': ast.get_source_segment(source, node).split('\n')[0][:200], 'targets': targets}
        used_names = {node.id for node in ast.walk(parsed) if isinstance(node, ast.Name)}
        condition_hook = '__frame_condition__'
        while condition_hook in used_names or condition_hook in setup:
            condition_hook = '_' + condition_hook
        env[condition_hook] = capture_condition
        parsed = ast.fix_missing_locations(Conditions().visit(parsed))
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            sys.settrace(trace)
            exec(compile(parsed, 'algorithm.py', 'exec'), env)
            exec(compile(setup, 'input.py', 'exec'), env)
    except TraceLimit as exc:
        truncated, error = True, str(exc)
    except BaseException as exc:
        error = type(exc).__name__ + ': ' + str(exc)
    finally:
        sys.settrace(None)
    # Definition-only snapshots do not help explain the algorithm.
    frames = [f for f in frames if f['locals'] or f['function'] != '<module>' or f['output']]
    # Stdout is also reported once at the top level. A snapshot only carries the
    # output that existed when it was taken, and the entry-point call lives in
    # the setup slot, which is not traced — so everything the run printed after
    # the final traced line, including the printed return value, exists nowhere
    # else. Without this the console goes blank at exactly the step a learner
    # looks at it.
    return json.dumps({'frames': frames, 'error': error, 'truncated': truncated, 'notes': notes,
                       'output': output.getvalue(),
                       'durationMs': round((time.monotonic() - started) * 1000)}, allow_nan=False)


# --- Static analysis -------------------------------------------------------
# Nothing below here executes the learner's code. It runs before a first trace,
# on source that may be half-written, so every failure has to come back as a
# reportable fact rather than an exception.

BUILTIN_NODES = {'ListNode': 'linked', 'TreeNode': 'tree'}


def _annotation(node):
    """The annotation exactly as written, or None. Verbatim on purpose: the
    mapping from a type to a form control lives in TypeScript so that a declared
    signature and parsed source cannot disagree about what `List[int]` means."""
    if node is None:
        return None
    try:
        return ast.unparse(node)
    except Exception:
        return None


def _class_shape(name, fields):
    """How a learner's class should be entered. A class with a `next` is a chain
    and a class with `left`/`right` is a tree whatever it is called, because that
    is what the code says about it — matching on the LeetCode names alone would
    fail every learner who wrote `Node`."""
    if name in BUILTIN_NODES:
        return BUILTIN_NODES[name]
    names = {field['name'] for field in fields}
    if 'left' in names or 'right' in names:
        return 'tree'
    if 'next' in names:
        return 'linked'
    return 'record'


def _init_fields(class_node):
    """Fields as the constructor declares them: parameters first, because they
    are ordered and annotated, then any `self.x = ...` the body adds that the
    signature did not already name."""
    fields, required, seen = [], 0, set()
    initializer = next((item for item in class_node.body
                        if isinstance(item, ast.FunctionDef) and item.name == '__init__'), None)
    if initializer is not None:
        arguments = initializer.args
        positional = arguments.posonlyargs + arguments.args
        defaults = list(arguments.defaults)
        offset = len(positional) - len(defaults)
        for index, argument in enumerate(positional):
            if argument.arg == 'self':
                continue
            has_default = index >= offset
            if not has_default:
                required += 1
            seen.add(argument.arg)
            fields.append({'name': argument.arg, 'annotation': _annotation(argument.annotation),
                           'hasDefault': has_default})
        for argument in arguments.kwonlyargs:
            seen.add(argument.arg)
            fields.append({'name': argument.arg, 'annotation': _annotation(argument.annotation),
                           'hasDefault': True})
        for statement in ast.walk(initializer):
            if not isinstance(statement, (ast.Assign, ast.AnnAssign)):
                continue
            targets = statement.targets if isinstance(statement, ast.Assign) else [statement.target]
            for target in targets:
                for attribute in ([target] if isinstance(target, ast.Attribute) else
                                  getattr(target, 'elts', [])):
                    if (isinstance(attribute, ast.Attribute) and isinstance(attribute.value, ast.Name)
                            and attribute.value.id == 'self' and attribute.attr not in seen):
                        seen.add(attribute.attr)
                        fields.append({'name': attribute.attr, 'annotation': None, 'hasDefault': True})
    return fields, required


def _entry_params(function_node):
    parameters, arguments = [], function_node.args
    positional = arguments.posonlyargs + arguments.args
    defaults = list(arguments.defaults)
    offset = len(positional) - len(defaults)
    for index, argument in enumerate(positional):
        if argument.arg in ('self', 'cls'):
            continue
        parameters.append({'name': argument.arg, 'annotation': _annotation(argument.annotation),
                           'hasDefault': index >= offset})
    for argument, default in zip(arguments.kwonlyargs, arguments.kw_defaults):
        parameters.append({'name': argument.arg, 'annotation': _annotation(argument.annotation),
                           'hasDefault': default is not None})
    return parameters


def analyze_json(source):
    try:
        parsed = ast.parse(source, filename='algorithm.py')
    except SyntaxError as exc:
        # A syntax error is the expected state of code someone is still typing.
        # It is reported with its position so the form can say "line 12" and go
        # quiet, rather than the run button failing later with the same message.
        return json.dumps({'entryPoints': [], 'classes': [], 'preferred': None,
                           'error': 'Line ' + str(exc.lineno or 0) + ': ' + (exc.msg or 'invalid syntax')})

    classes, entry_points = [], []
    for node in parsed.body:
        if isinstance(node, ast.ClassDef):
            fields, required = _init_fields(node)
            classes.append({'name': node.name, 'fields': fields,
                            'shape': _class_shape(node.name, fields),
                            'constructible': required == 0})
            for item in node.body:
                if not isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                if item.name.startswith('_'):
                    continue
                unsupported = None
                if isinstance(item, ast.AsyncFunctionDef):
                    unsupported = 'Async functions cannot be traced.'
                elif required:
                    unsupported = node.name + ' needs constructor arguments, so Spar cannot build one for you.'
                entry_points.append({'name': item.name, 'receiver': node.name,
                                     'params': _entry_params(item),
                                     'returnType': _annotation(item.returns),
                                     'unsupported': unsupported})
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and not node.name.startswith('_'):
            entry_points.append({'name': node.name, 'receiver': None,
                                 'params': _entry_params(node),
                                 'returnType': _annotation(node.returns),
                                 'unsupported': ('Async functions cannot be traced.'
                                                 if isinstance(node, ast.AsyncFunctionDef) else None)})

    # A LeetCode submission is a Solution class with one method, and that method
    # is what the learner wants to watch. Failing that, the last thing they
    # defined is the thing they are working on.
    runnable = [entry for entry in entry_points if not entry['unsupported']]
    solution = next((entry for entry in runnable if entry['receiver'] == 'Solution'), None)
    preferred = solution or (runnable[-1] if runnable else None)
    return json.dumps({'entryPoints': entry_points, 'classes': classes,
                       'preferred': None if preferred is None else
                       ((preferred['receiver'] + '.' if preferred['receiver'] else '') + preferred['name']),
                       'error': None})


def main():
    request = json.loads(sys.stdin.read() or '{}')
    if request.get('mode') == 'analyze':
        sys.stdout.write(analyze_json(request.get('code') or ''))
        return
    sys.stdout.write(trace_json(request.get('code') or '', request.get('setup') or '',
                                int(request.get('maxSteps') or 1500)))


if __name__ == '__main__':
    main()
