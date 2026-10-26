import { describe, expect, it } from "vitest";
import { normalizeMemory, memoryChanges, valueText } from "../frontend/memory-model.js";
import graph from "../frontend/fixtures/memory-graph.json";

describe("CodeLens memory snapshots", () => {
    it("labels singleton C++ heap allocations by their element type and address while retaining real arrays", () => {
        const entry = { heap: {
            "0x10": ["C_ARRAY", "0x10", ["C_DATA", "0x10", "int", 5]],
            "0x20": ["C_ARRAY", "0x20", ["C_DATA", "0x20", "int", 1], ["C_DATA", "0x24", "int", 2]],
        } };
        const original = JSON.stringify(entry);
        const memory = normalizeMemory(entry, "cpp");
        const single = memory.objects.get("0x10");
        expect(single.singleElement).toBe(true);
        expect(single.label).toBe("int at 0x10");
        expect(single.entries[0].name.text).toBe("Value");
        const array = memory.objects.get("0x20");
        expect(array.singleElement).toBeUndefined();
        expect(array.label).toBe("Array 0x20");
        expect(array.entries.map((row) => row.name.text)).toEqual(["0", "1"]);
        expect(JSON.stringify(entry)).toBe(original);
    });

    it("tracks nested struct fields individually without expanding pointer references", () => {
        const snapshot = (x) => ({ globals: { record: ["C_STRUCT", "0x10", "Record",
            ["point", ["C_STRUCT", "0x10", "Point", ["x", ["C_DATA", "0x10", "int", x]]]],
            ["next", ["REF", "0x10"]],
        ] }, heap: { "0x10": ["C_STRUCT", "0x10", "Record", ["next", ["REF", "0x10"]]] } });
        const original = snapshot(1);
        const raw = JSON.stringify(original);
        const before = normalizeMemory(original, "cpp");
        const after = normalizeMemory(snapshot(9), "cpp");
        expect(before.globals[0].value.fields[1].value).toEqual({ kind: "reference", id: "0x10" });
        expect(before.objects.get("0x10").label).toBe("Record at 0x10");
        expect(memoryChanges(before, after).map((change) => change.text)).toEqual([
            "Global variables, record, point, x changed from 1 to 9.",
        ]);
        expect(JSON.stringify(original)).toBe(raw);
    });

    it("decodes C_DATA values and retains variable metadata in globals, frames, and arrays", () => {
        const pointer = ["C_DATA", "0xFFF0000C8", "pointer", "0xFFF0000E0"];
        const memory = normalizeMemory({
            globals: { ptr: pointer },
            stack_to_render: [{ func_name: "main", encoded_locals: {
                pending: ["C_DATA", "0x10", "int", "<UNINITIALIZED>"],
            } }],
            heap: { "0xFFF0000E0": ["C_ARRAY", "0xFFF0000E0",
                ["C_DATA", "0xFFF0000E0", "int", 5]],
            },
        }, "cpp");
        expect(memory.globals[0].value).toEqual({
            kind: "pointer", id: "0xfff0000e0", text: "0xFFF0000E0", address: "0xFFF0000C8", type: "pointer",
        });
        expect(memory.frames[0].bindings[0].value.text).toBe("<UNINITIALIZED>");
        expect(memory.objects.get("0xFFF0000E0").entries[0].value).toEqual({
            kind: "literal", text: "5", address: "0xFFF0000E0", type: "int",
        });
    });

    it("tracks fields in embedded arrays of structs and keeps malformed structs readable", () => {
        const snapshot = (value) => ({ globals: { item: ["C_STRUCT", "0x10", "Container",
            ["points", ["C_ARRAY", "0x10", ["C_STRUCT", "0x10", "Point",
                ["x", ["C_DATA", "0x10", "int", value]],
            ]]],
        ], invalid: ["C_STRUCT", "0x20", "Broken", ["missing-value"]] } });
        const before = normalizeMemory(snapshot(1), "cpp");
        const after = normalizeMemory(snapshot(2), "cpp");
        expect(memoryChanges(before, after).map((change) => change.text)).toEqual([
            "Global variables, item, points, index 0, x changed from 1 to 2.",
        ]);
        expect(before.globals[1].value.text).toContain("Unsupported value:");
    });

    it("preserves ordering, values, graph identity, and raw snapshot data", () => {
        const raw = structuredClone(graph.trace[6]);
        raw.globals.extra = null; // an omitted ordered_globals name must not disappear
        const original = JSON.stringify(raw);
        const memory = normalizeMemory(raw);
        expect(memory.globals.map((row) => row.name)).toEqual(["visit", "shared", "node", "extra"]);
        expect(memory.globals[3].value.text).toBe("None");
        expect(memory.frames[0].bindings.map((row) => row.name)).toEqual(["node", "alias"]);
        expect(memory.objects.size).toBe(3);
        expect(memory.objects.get("3").entries[1].value).toEqual({ kind: "reference", id: "3" });
        expect(valueText(memory.frames[0].bindings[1].value, memory)).toBe("Reference to Dictionary 3");
        expect(JSON.stringify(raw)).toBe(original);
    });

    it("decodes Python instances, classes, functions, sets, and special scalars", () => {
        const memory = normalizeMemory({
            globals: { n: ["SPECIAL_FLOAT", "inf"], imported: ["IMPORTED_FAUX_PRIMITIVE", "math"] },
            heap: {
                1: ["INSTANCE", "Node", ["next", ["REF", 1]]],
                2: ["CLASS", "Node", ["Base"], ["count", 2]],
                3: ["INSTANCE_PPRINT", "Node", "Node(1)", ["value", 1]],
                4: ["FUNCTION", "make(x=1)", 5, [["x", 1]]],
                5: ["SET", 2, 3],
                6: ["HEAP_PRIMITIVE", "str", "hello"],
            },
        });
        expect(memory.objects.get("1").label).toBe("Node instance 1");
        expect(memory.objects.get("1").entries[0].name.text).toBe("next");
        expect(memory.objects.get("2").entries[0].value.text).toBe('"Base"');
        expect(memory.objects.get("3").entries).toHaveLength(2);
        expect(memory.objects.get("4").enclosingFrame).toBe("5");
        expect(memory.objects.get("4").entries[1].name.text).toBe("Default argument x");
        expect(memory.objects.get("5").entries).toHaveLength(2);
        expect(memory.objects.get("6").entries[0].value.text).toBe('"hello"');
        expect(memory.globals.map((row) => row.value.text)).toEqual(["inf", "math"]);
    });

    it("describes dictionary keys that are references without flattening their identity", () => {
        const old = normalizeMemory({ heap: { 1: ["DICT", [["REF", 2], 1]], 2: ["TUPLE", 4] } });
        const next = normalizeMemory({ heap: { 1: ["DICT", [["REF", 2], 9]], 2: ["TUPLE", 4] } });
        expect(memoryChanges(old, next).map((change) => change.text)).toEqual([
            "Dictionary 1, Reference to Tuple 2 changed from 1 to 9.",
        ]);
    });

    it("reports heap mutations and frame/object lifetimes without replaying their contents", () => {
        const start = normalizeMemory(graph.trace[6]);
        const mutated = normalizeMemory(graph.trace[7]);
        expect(memoryChanges(start, mutated).map((change) => change.text)).toEqual(["List 2, index 2 added: 3."]);
        const empty = normalizeMemory({});
        const added = memoryChanges(empty, start);
        expect(added.filter((change) => change.text === "List 2 added.")).toHaveLength(1);
        expect(added.filter((change) => change.text === "visit — frame 1 added.")).toHaveLength(1);
        expect(memoryChanges(start, empty).map((change) => change.text)).toContain("Dictionary 3 removed.");
        expect(memoryChanges(start, normalizeMemory(graph.trace[6]))).toEqual([]);
    });

    it("keeps set member identity across reordering and reports removals", () => {
        const before = normalizeMemory({ heap: { 1: ["SET", 1, 2] } });
        const reordered = normalizeMemory({ heap: { 1: ["SET", 2, 1] } });
        expect(memoryChanges(before, reordered)).toEqual([]);
        const removed = normalizeMemory({ heap: { 1: ["SET", 2] } });
        expect(memoryChanges(before, removed).map((change) => change.text)).toEqual(["Set 1, member 1 removed (was 1)."]);
    });
});
