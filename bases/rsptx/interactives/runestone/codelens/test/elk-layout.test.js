import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { buildHeapGraph, layoutWithElk } from "../frontend/elk-layout.js";

const require = createRequire(import.meta.url);
const ELK = require("../frontend/vendor/elk.bundled.js");

describe("ELK heap layout adapter", () => {
    it("leaves long horizontal tails for curved connections and self references", async () => {
        const nodes = ["one", "two"].map((id) => ({ id, width: 224, height: 160, targetY: 24 }));
        const result = await layoutWithElk(new ELK(), nodes, [
            { key: "out", source: "one", target: "two", y: 96 },
            { key: "self", source: "one", target: "one", y: 128 },
        ]);
        for (const points of result.routes.values()) {
            const start = points[0];
            const firstBend = points[1];
            const lastBend = points[points.length - 2];
            const end = points[points.length - 1];
            expect(firstBend.y).toBe(start.y);
            expect(firstBend.x - start.x).toBeGreaterThanOrEqual(40);
            expect(lastBend.y).toBe(end.y);
            expect(lastBend.x - end.x).toBeGreaterThanOrEqual(40);
        }
    });

    it("favors vertical spread for linked and disconnected heap objects", async () => {
        const nodes = Array.from({ length: 4 }, (_, index) => ({
            id: String(index), width: 272, height: 160, targetY: 24,
        }));
        for (const references of [[], [
            { key: "first", source: "0", target: "1", y: 64 },
            { key: "second", source: "1", target: "2", y: 64 },
            { key: "third", source: "2", target: "3", y: 64 },
        ]]) {
            const result = await layoutWithElk(new ELK(), nodes, references);
            const width = Math.max(...nodes.map((node) => result.positions.get(node.id).x + node.width));
            const height = Math.max(...nodes.map((node) => result.positions.get(node.id).y + node.height));
            expect(height).toBeGreaterThan(width);
        }
    });

    it("lays out measured cards, cycles, aliases, and isolated objects without changing the input", async () => {
        const nodes = [
            { id: "list/one", width: 272, height: 220, targetY: 24 },
            { id: "two", width: 272, height: 160, targetY: 24 },
            { id: "isolated", width: 272, height: 120, targetY: 24 },
        ];
        const edges = [
            { key: "self", source: "list/one", target: "list/one", y: 64 },
            { key: "out", source: "list/one", target: "two", y: 96 },
            { key: "alias", source: "list/one", target: "two", y: 128 },
            { key: "back", source: "two", target: "list/one", y: 64 },
            { key: "missing", source: "two", target: "missing", y: 96 },
        ];
        const original = JSON.stringify({ nodes, edges });
        const graph = buildHeapGraph(nodes, edges).graph;
        expect(graph.edges).toHaveLength(4);
        expect(graph.children[0].ports).toHaveLength(4);
        const result = await layoutWithElk(new ELK(), nodes, edges);

        expect(result.positions.size).toBe(3);
        for (const node of nodes) {
            const position = result.positions.get(node.id);
            expect(Number.isFinite(position.x) && Number.isFinite(position.y)).toBe(true);
            for (const other of nodes) {
                if (other === node) continue;
                const next = result.positions.get(other.id);
                expect(position.x + node.width <= next.x || next.x + other.width <= position.x ||
                    position.y + node.height <= next.y || next.y + other.height <= position.y).toBe(true);
            }
        }
        for (const key of ["self", "out", "alias", "back"]) {
            const points = result.routes.get(key);
            expect(points.length).toBeGreaterThan(1);
            expect(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
        }
        expect(JSON.stringify({ nodes, edges })).toBe(original);
    });
});
