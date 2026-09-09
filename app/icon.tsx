import { ImageResponse } from "next/og";

/**
 * Temporary typographic favicon (Pottery Sage background, "P" in white).
 * The official logo (public/brand/pottery-logo.png) is a detailed
 * botanical wreath illustration — it doesn't read at 16–32px. This is a
 * simple placeholder using only the brand color, not an invented isotype;
 * swap it for an official favicon-optimized mark if/when Juli provides
 * one (see docs/architecture.md § Brand / Design System).
 */
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#687866",
          color: "#FFFFFF",
          fontSize: 20,
          fontWeight: 600,
          borderRadius: 7,
        }}
      >
        P
      </div>
    ),
    { ...size }
  );
}
