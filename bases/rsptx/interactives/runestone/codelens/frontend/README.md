# CodeLens frontend prototype

This viewer consumes the existing `{code, trace, startingInstruction}` data. It
does not execute code or call a backend. The original three JSON fixtures were extracted
from `pretext/examples/sample-book/gen/trace` without changing their data.

From `bases/rsptx/interactives/runestone`, serve this directory with a local
static server (for example, `python -m http.server 8080`), then open
`http://localhost:8080/codelens/frontend/demo.html`.

For an existing book page, append `?codelensPrototype=<visualizer-id>` to its
URL. Only that CodeLens instance uses the prototype. Traces with embedded
questions or input prompts keep the legacy renderer.

The prototype displays source lines, forward/backward stepping, globals, stack
frames, heap objects, and stdout. Memory has Diagram, Graphical Diagram, and Text
layouts of the same semantic HTML. References link to stable object headings in all layouts;
an aria-hidden SVG layer adds arrows in Diagram mode. Following a reference moves
keyboard focus to the object heading. Switching layouts keeps focus and the current
step. Hovering or focusing a reference highlights its target and arrow.

Viewer layout defaults to Automatic: code, stepping controls, and program output
appear beside memory when the viewer has at least 64rem of content width, and above
memory otherwise. Side by side and Above/below manually override that choice.
Changing the layout preserves the current step, memory view, and heap positions.
Each viewer has its own layout setting. CSS container queries base Automatic on the
embedded viewer's width, rather than the whole browser window.

Graphical Diagram lazily loads the pinned ELK.js 0.12.0 browser bundle from
`vendor/` to arrange measured heap cards and route their references. Globals and
frames stay in their own column. The graphical viewport scrolls with native browser
controls and can be focused for keyboard scrolling.

Drag a card's Move button to reposition it, or use arrow keys on that button
(Shift increases the distance). The object selector and four movement buttons
provide a click/tap alternative to dragging. Escape or pointer cancellation restores
the position at the beginning of a drag. Movement is announced after a drag finishes
or a movement control is used, rather than on every pointer event.

Positions persist by object ID through forward/backward stepping and view changes,
including when an object disappears and is later revisited. New objects are placed
without moving existing cards. Arrange automatically rearranges the current heap;
Reset positions also clears cached positions for absent objects. After manual movement,
arrows use geometric routes; ELK routes are reused while their measured geometry
still matches. If layout loading fails, manual movement and the other views remain
available, and Arrange automatically retries. No pan/zoom gestures are implemented.

The vendor README records the library source, version, checksum, and license.
Webpack emits ELK as a separate asset, so it is not downloaded for Diagram/Text.

The memory adapter currently handles Python lists, tuples, sets, dictionaries,
instances, classes, functions (including default arguments and enclosing scopes),
and heap primitives. Unknown encodings show their raw trace data as escaped text.
Other languages need their own adapters, including frame ordering and pointer rules.

Each step announces up to three memory changes through the existing status region.
The expandable Changes this step list contains all changes; changed entries also
have visible text markers. The memory tree itself is not a live region. Empty
containers and missing reference targets are described explicitly.

Additional fixtures:

- `aliasing.json`: unchanged OnlinePythonTutor `v5-unity/tests/frontend-tests/py2/aliasing.trace`.
- `memory-graph.json`: hand-authored illustrative snapshots for the displayed Python
  program, covering a call, shared references, a self-reference, list mutation, and
  return. It starts inside the call so those relationships are visible immediately.
- `java-hello-world.json`, `java-sieve.json`, and `cpp-sieve.json`: extracted from
  the corresponding `java-hello-world-code-lens.js`, `sieve-codelens-java.js`, and
  `sieve-codelens-cpp.js` in `pretext/examples/sample-book/gen/trace`, preserving
  their snapshot data and starting instructions.
- `cpp-class-pointers.json`: OnlinePythonTutor
  `v5-unity/tests/frontend-tests/cpp/cpp-class-pointers.trace`, with unchanged data.
- `cpp-passing-pointers.json`: extracted without changing snapshot data from
  `rsbooks/welcomeprogramming/source/generated/trace/memory-management_passing-pointers-program-1.js`.
- `cpp-references-functions.json`: extracted without changing snapshot data from
  `rsbooks/welcomeprogramming/source/generated/trace/references-exceptions_references-functions-program-2.js`.

The testbed passes the selected sample's language to the viewer, so Java booleans
use `true`/`false`. Java arrays share the supported LIST encoding; Java VOID returns
use the explicit raw-data fallback. C_DATA displays its address and type beneath the variable name, with
only the stored value in the value cell; C_ARRAY displays indexed entries using
the same metadata. C_STRUCT values render as named nested field tables, including
embedded structs and arrays. Cards grow with nesting depth, and changes identify
individual fields. A C++ heap C_ARRAY with one top-level element is presented as
a single memory chunk: its element type and address label the card, followed by
its value or struct fields. Multi-element heap arrays and embedded arrays retain
their indexed tables. C_DATA pointers link their address text to heap allocations,
stack/global variables, or embedded fields at that address, with the same curved
connectors and keyboard focus behavior as REF links. Address matching ignores
hexadecimal case and leading zeroes. Missing targets and null pointers stay plain
text with accessible descriptions. A containing allocation or struct takes
precedence over its first member when their addresses coincide; the trace's
generic pointer type does not identify the intended pointee type. Java's
language-specific frame ordering still needs work. A notice appears for these
experimental samples.

Run the focused tests from `bases/rsptx/interactives` with
`npx vitest run runestone/codelens/test`.

This is an experimental first pass. It does not provide the complete CodeLens
feature set or claim WCAG AA conformance. Screen reader testing is still needed.
