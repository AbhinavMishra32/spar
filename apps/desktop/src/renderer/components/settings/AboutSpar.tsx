import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { SparWordmark } from "../common/SparWordmark";

/** Resolved in the main process before the window paints, so it is already here. */
const build = window.spar?.build;

/* Two backgrounds, both clipped to the glyphs. The one underneath is a vertical
   fade that gives the mark weight at this size — flat text at 5rem reads as a
   heading, not a logo. The one on top is a narrow band of full-strength
   foreground that travels across, so the sweep brightens the letters instead of
   washing them out: a white sheen would erase them against a light page, and
   barely register against a dark one. */
const SHEEN = "linear-gradient(100deg, transparent 40%, var(--foreground) 50%, transparent 60%)";
const DEPTH = "linear-gradient(to bottom, var(--foreground) 4%, color-mix(in oklab, var(--foreground) 34%, transparent) 98%)";

function Mark() {
  // A second sweep on hover, because the first one happens while you are still
  // scrolling towards it and half the point is that you get to see it.
  const [sweep, setSweep] = useState(0);
  const still = useReducedMotion();

  return (
    <div className="relative isolate inline-block" onPointerEnter={() => setSweep((n) => n + 1)}>
      {/* Barely there by design: enough to lift the mark off the page, not
          enough to read as a glow effect on a settings screen. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-12 -inset-y-10 -z-10 blur-2xl [background:radial-gradient(closest-side,color-mix(in_oklab,var(--foreground)_9%,transparent),transparent)]"
      />
      <motion.div
        className="bg-clip-text text-[5rem] leading-[0.95] text-transparent select-none"
        key={sweep}
        style={{
          backgroundImage: `${SHEEN}, ${DEPTH}`,
          backgroundSize: "260% 100%, 100% 100%",
          backgroundRepeat: "no-repeat",
          // Parked offstage, which is also where it stays when the sweep is off:
          // a band frozen mid-mark would read as a rendering fault.
          backgroundPosition: "170% 0%, 0% 0%",
        }}
        {...(still
          ? {}
          : {
              initial: { backgroundPosition: "170% 0%, 0% 0%" },
              animate: { backgroundPosition: "-60% 0%, 0% 0%" },
              transition: { duration: 1.15, ease: [0.33, 0, 0.15, 1], delay: sweep === 0 ? 0.45 : 0 },
            })}
      >
        <SparWordmark />
      </motion.div>
    </div>
  );
}

function Commit({ commit, branch }: { commit: string; branch: string | null }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard
      .writeText(commit)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1_600);
      })
      .catch(() => undefined);
  };

  return (
    <button
      className="group mt-2 inline-flex items-center gap-1.5 rounded-full border border-transparent px-2.5 py-1 font-mono text-ui-sm text-muted-foreground/85 transition-colors hover:border-border hover:bg-accent/50 hover:text-foreground"
      onClick={copy}
      title={`${commit}${branch ? ` on ${branch}` : ""} — click to copy the full SHA`}
      type="button"
    >
      {copied ? (
        <Check className="size-3 shrink-0 text-success" />
      ) : (
        <Copy className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-55" />
      )}
      <span>{commit.slice(0, 7)}</span>
      {branch && (
        <>
          <span aria-hidden className="text-muted-foreground/40">
            ·
          </span>
          <span className="max-w-[12rem] truncate text-muted-foreground/60">{branch}</span>
        </>
      )}
    </button>
  );
}

/**
 * The bottom of Settings, where you go to answer "which Spar am I actually
 * running". The version alone cannot answer that off a release channel — every
 * build from source calls itself the same number — so the commit sits with it
 * and is the identity when there is no packaged version behind it.
 */
export function AboutSpar() {
  if (!build) return null;

  return (
    <section className="mt-16 flex flex-col items-center pb-4 text-center">
      <Mark />
      <p className="mt-6 text-ui text-muted-foreground">
        Version {build.version}
        {!build.packaged && (
          <>
            <span aria-hidden className="mx-1.5 text-muted-foreground/40">
              ·
            </span>
            Development build
          </>
        )}
      </p>
      {build.commit && <Commit branch={build.branch} commit={build.commit} />}
    </section>
  );
}
