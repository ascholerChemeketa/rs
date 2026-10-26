import { describe, expect, it } from "vitest";
import { curvedConnectorPath } from "../frontend/connector-path.js";

describe("curved reference connectors", () => {
    it("rounds a routed corner while preserving endpoints and a straight arrowhead approach", () => {
        expect(curvedConnectorPath([
            { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 },
        ])).toBe("M 0 0 L 80 0 Q 100 0 100 20 L 100 100");
    });

    it("limits bends on short segments and tolerates duplicate route points", () => {
        expect(curvedConnectorPath([
            { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 6 },
        ])).toBe("M 0 0 L 5 0 Q 8 0 8 3 L 8 6");
        expect(curvedConnectorPath([{ x: 1, y: 2 }, { x: 1, y: 2 }])).toBe("M 1 2");
    });
});
