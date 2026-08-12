import { ImageResponse } from "next/og";
import { markDots, markRadius } from "@/components/Mark";
import { site } from "@/lib/site";

export const alt = `${site.name} — ${site.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The card that shows up in a link preview: the mark, the line, black.
 *
 * Satori (what `next/og` renders with) supports a subset of CSS and no SVG
 * `transform` on individual elements, so the mark is rebuilt here as absolutely
 * positioned circles off the same `markDots` geometry the site uses. It is the
 * one place the grid is drawn twice, and it is drawn from the same numbers.
 */
export default function OpengraphImage() {
  const MARK = 132;
  const scale = MARK / 100;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#000000",
          padding: 80,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", position: "relative", width: MARK, height: MARK }}>
          {markDots.map((dot) => (
            <div
              key={dot.key}
              style={{
                position: "absolute",
                left: (dot.cx - markRadius * dot.rest) * scale,
                top: (dot.cy - markRadius * dot.rest) * scale,
                width: markRadius * 2 * dot.rest * scale,
                height: markRadius * 2 * dot.rest * scale,
                borderRadius: "50%",
                background: `rgba(255,255,255,${dot.tone})`,
              }}
            />
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 92,
              lineHeight: 1,
              letterSpacing: "-0.04em",
              color: "#ffffff",
            }}
          >
            Practice that fights back.
          </div>
          <div
            style={{
              marginTop: 28,
              fontSize: 30,
              lineHeight: 1.35,
              letterSpacing: "-0.01em",
              color: "rgba(255,255,255,0.62)",
              maxWidth: 900,
            }}
          >
            {site.tagline}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
