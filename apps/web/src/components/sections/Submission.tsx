"use client";

import { useEffect, useRef } from "react";
import { Reveal } from "@/components/Reveal";
import { Section, SectionHead } from "@/components/Section";

/**
 * The check from the section above, happening.
 *
 * Every other proof on this page is drawn — dots standing in for cases, a field
 * standing in for a ladder — and drawing is the right register for an argument.
 * It is the wrong one for a claim about what the app literally does when you
 * press Submit. So this is the recording, unedited: the tests run, each case
 * reports back, and the first failure is opened with its input, your output and
 * the expected value beside each other.
 *
 * No controls, because there is nothing here to seek to — it is nineteen seconds
 * and it repeats. A control bar would make it look like something you are meant
 * to sit and watch rather than something you glance at on the way past.
 */
export function Submission() {
  const video = useRef<HTMLVideoElement | null>(null);

  /* Played only while it is on screen. A muted autoplaying video is cheap but it
     is not free, and one looping in a section three screens above the reader is
     decoding frames nobody is looking at. */
  useEffect(() => {
    const node = video.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const watcher = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void node.play().catch(() => {});
        else node.pause();
      },
      { threshold: 0.25 },
    );
    watcher.observe(node);
    return () => watcher.disconnect();
  }, []);

  return (
    <Section bloom="br">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-16">
        <SectionHead
          index="08"
          label="Submitting"
          title="What that looks like from your side."
          lede={
            <>
              You press Submit and the committed tests run. No model is asked, nothing is interpreted — the
              suite either passes or it names the case that broke you.
            </>
          }
        />

        <Reveal className="lg:pt-4">
          <div className="frame">
            <video
              ref={video}
              src="/clips/submission.mp4"
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
              aria-label="A submission in Spar: the tests run, each case reports its verdict, and the first failing case opens with its input, the output produced and the expected value."
              className="h-auto w-full"
            />
          </div>
          <p className="mt-5 max-w-[52ch] text-[0.92rem] leading-relaxed text-muted">
            The first failure is selected for you rather than left in a list to hunt through, and it is the
            same panel whether the grader was Spar&rsquo;s own suite or LeetCode&rsquo;s.
          </p>
        </Reveal>
      </div>
    </Section>
  );
}
