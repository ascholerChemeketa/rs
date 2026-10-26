// Keep the layout engine out of the initial download, including in the unbuilt demo.
let enginePromise;

export function loadElk() {
    if (!enginePromise) {
        enginePromise = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = new URL("./vendor/elk.bundled.js", import.meta.url).href;
            // Emit the accompanying license with the engine in webpack builds.
            script.dataset.license = new URL("./vendor/ELK-LICENSE.md", import.meta.url).href;
            script.onload = () => {
                script.remove();
                if (typeof window.ELK === "function") resolve(new window.ELK());
                else reject(new Error("ELK did not initialize"));
            };
            script.onerror = () => {
                script.remove();
                reject(new Error("Could not load ELK"));
            };
            document.head.append(script);
        }).catch((error) => {
            enginePromise = undefined;
            throw error;
        });
    }
    return enginePromise;
}

// Use opaque ELK IDs; object IDs and reference keys remain in our snapshot model.
export function buildHeapGraph(nodes, references) {
    const ids = new Map(nodes.map((node, index) => [node.id, `node-${index}`]));
    const outgoing = new Map(nodes.map((node) => [node.id, []]));
    const edges = [];
    const edgeKeys = new Map();
    for (const reference of references) {
        if (!ids.has(reference.source) || !ids.has(reference.target)) continue;
        const id = `edge-${edges.length}`;
        const port = `${id}-source`;
        outgoing.get(reference.source).push({
            id: port, width: 1, height: 1,
            x: nodes.find((node) => node.id === reference.source).width,
            y: reference.y,
            layoutOptions: { "elk.port.side": "EAST" },
        });
        edges.push({ id, sources: [port], targets: [`${ids.get(reference.target)}-in`] });
        edgeKeys.set(id, reference.key);
    }
    return {
        graph: {
            id: "heap",
            layoutOptions: {
                "elk.algorithm": "layered",
                "elk.direction": "DOWN",
                // Prefer a tall canvas when packing disconnected heap objects too.
                "elk.aspectRatio": "0.6",
                "elk.edgeRouting": "ORTHOGONAL",
                // Leave room for broad curves and straight tails beside cards.
                "elk.spacing.edgeNode": "40",
                "elk.spacing.nodeSelfLoop": "40",
                "elk.spacing.edgeEdge": "16",
                "elk.spacing.nodeNode": "32",
                "elk.layered.spacing.nodeNodeBetweenLayers": "48",
                "elk.spacing.componentComponent": "40",
                "elk.padding": "[top=24,left=24,bottom=24,right=24]",
            },
            children: nodes.map((node) => ({
                id: ids.get(node.id), width: node.width, height: node.height,
                layoutOptions: { "elk.portConstraints": "FIXED_POS" },
                ports: [
                    {
                        id: `${ids.get(node.id)}-in`, width: 1, height: 1,
                        // Keep both ports on the right so downward chains don't
                        // become a wide staircase to connect east to west ports.
                        x: node.width, y: node.targetY,
                        layoutOptions: { "elk.port.side": "EAST" },
                    },
                    ...outgoing.get(node.id),
                ],
            })),
            edges,
        },
        ids,
        edgeKeys,
    };
}

export async function layoutWithElk(engine, nodes, references) {
    const { graph, ids, edgeKeys } = buildHeapGraph(nodes, references);
    const result = await engine.layout(graph);
    const objectIds = new Map([...ids].map(([object, id]) => [id, object]));
    return {
        positions: new Map(result.children.map((node) => [
            objectIds.get(node.id), { x: node.x, y: node.y },
        ])),
        routes: new Map(result.edges.map((edge) => [edgeKeys.get(edge.id),
            (edge.sections ?? []).flatMap((section) => [
                section.startPoint, ...(section.bendPoints ?? []), section.endPoint,
            ]),
        ])),
    };
}

export async function layoutHeap(nodes, references, isCurrent = () => true) {
    const engine = await loadElk();
    if (!isCurrent()) return null;
    return layoutWithElk(engine, nodes, references);
}
