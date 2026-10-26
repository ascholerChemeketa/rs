# ELK.js

`elk.bundled.js` is the unmodified browser bundle from **elkjs 0.12.0**, downloaded
from the npm registry with `npm pack elkjs@0.12.0 --ignore-scripts`.

- Project: https://github.com/kieler/elkjs
- License: see `ELK-LICENSE.md`, copied from the same package.
- Bundle SHA-256: `1222e44f953ce7746af23801e723708f8e6f436b8b377a6a5fc7552f34a307b3`

The bundle is loaded only when Graphical Diagram is selected. Keeping the pinned
browser artifact here lets the standalone demo and webpack build use the same
engine, without a CDN or an npm install for the demo. Webpack emits it as a separate
asset through `new URL(..., import.meta.url)` in `elk-layout.js`.
