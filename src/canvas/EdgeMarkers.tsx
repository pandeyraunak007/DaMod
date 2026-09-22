// Crow's-foot cardinality markers (FR-4.1), defined once and referenced from
// edges by url(#id). `auto-start-reverse` lets the same marker serve either end
// of a line.
export function EdgeMarkers() {
  return (
    <svg style={{ position: "absolute", width: 0, height: 0 }} aria-hidden>
      <defs>
        <marker
          id="damod-many"
          markerWidth="24"
          markerHeight="24"
          refX="20"
          refY="11"
          orient="auto-start-reverse"
          markerUnits="userSpaceOnUse"
        >
          <path
            d="M2,11 L20,3 M2,11 L20,11 M2,11 L20,19"
            stroke="#64748b"
            strokeWidth="1.5"
            fill="none"
          />
        </marker>
        <marker
          id="damod-one"
          markerWidth="20"
          markerHeight="24"
          refX="12"
          refY="11"
          orient="auto-start-reverse"
          markerUnits="userSpaceOnUse"
        >
          <path d="M12,4 L12,18" stroke="#64748b" strokeWidth="1.6" fill="none" />
        </marker>
        {/* IDEF1X child-end dot (filled circle) for the "many" cardinality. */}
        <marker
          id="damod-idef-dot"
          markerWidth="16"
          markerHeight="16"
          refX="8"
          refY="8"
          orient="auto-start-reverse"
          markerUnits="userSpaceOnUse"
        >
          <circle cx="8" cy="8" r="4.5" fill="#64748b" />
        </marker>
        {/* Subtype / category symbol (IDEF1X-style circle with an underline). */}
        <marker
          id="damod-subtype"
          markerWidth="22"
          markerHeight="22"
          refX="11"
          refY="11"
          orient="auto-start-reverse"
          markerUnits="userSpaceOnUse"
        >
          <circle cx="11" cy="10" r="6" fill="#fff" stroke="#64748b" strokeWidth="1.4" />
          <line x1="6" y1="18" x2="16" y2="18" stroke="#64748b" strokeWidth="1.4" />
        </marker>
      </defs>
    </svg>
  );
}

export const MARKER_MANY = "url(#damod-many)";
export const MARKER_ONE = "url(#damod-one)";
export const MARKER_SUBTYPE = "url(#damod-subtype)";
export const MARKER_IDEF_DOT = "url(#damod-idef-dot)";
