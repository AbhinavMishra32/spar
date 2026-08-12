import Image from "next/image";
import { cn } from "@/lib/cn";

/** The real screenshots, at their real sizes. Nothing here is a mockup. */
export const shots = {
  workspace: { src: "/shots/workspace.png", width: 1800, height: 1082 },
  ability: { src: "/shots/ability-detail.png", width: 1800, height: 1232 },
  history: { src: "/shots/challenge-history.png", width: 1800, height: 1068 },
  concept: { src: "/shots/concept-sheet.png", width: 1554, height: 1568 },
  hovercard: { src: "/shots/concept-hovercard.png", width: 616, height: 500 },
} as const;

/**
 * A screenshot in a frame.
 *
 * `priority` is off everywhere but the first one: these are large PNGs of a
 * dark UI and loading all five up front would cost more than the rest of the
 * page put together.
 */
export function Shot({
  shot,
  alt,
  sizes = "(max-width: 900px) 100vw, 1160px",
  priority = false,
  className,
}: {
  shot: keyof typeof shots;
  alt: string;
  sizes?: string;
  priority?: boolean;
  className?: string;
}) {
  const source = shots[shot];
  return (
    <div className={cn("frame", className)}>
      <Image
        src={source.src}
        width={source.width}
        height={source.height}
        alt={alt}
        sizes={sizes}
        priority={priority}
        quality={88}
        className="h-auto w-full"
      />
    </div>
  );
}
