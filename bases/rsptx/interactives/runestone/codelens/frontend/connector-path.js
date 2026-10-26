// Round routed corners without moving endpoints or cutting across object cards.
export function curvedConnectorPath(points, radius = 20) {
    const route = points.filter((point, index) => index === 0 ||
        point.x !== points[index - 1].x || point.y !== points[index - 1].y);
    if (route.length === 0) return "";
    let path = `M ${route[0].x} ${route[0].y}`;
    for (let index = 1; index < route.length - 1; index++) {
        const previous = route[index - 1];
        const corner = route[index];
        const next = route[index + 1];
        const before = Math.hypot(corner.x - previous.x, corner.y - previous.y);
        const after = Math.hypot(next.x - corner.x, next.y - corner.y);
        // Half-segment limits keep adjacent curves apart and leave a straight
        // final approach so the arrowhead stays aligned with its tail.
        const bend = Math.min(radius, before / 2, after / 2);
        const entry = {
            x: corner.x + (previous.x - corner.x) * bend / before,
            y: corner.y + (previous.y - corner.y) * bend / before,
        };
        const exit = {
            x: corner.x + (next.x - corner.x) * bend / after,
            y: corner.y + (next.y - corner.y) * bend / after,
        };
        path += ` L ${entry.x} ${entry.y} Q ${corner.x} ${corner.y} ${exit.x} ${exit.y}`;
    }
    const end = route[route.length - 1];
    return route.length === 1 ? path : `${path} L ${end.x} ${end.y}`;
}
