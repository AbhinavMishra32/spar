import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ActiveQuestion } from "@spar/domain";
import { LanguageGlyph, LANGUAGE_LABEL } from "../common/LanguageGlyph";
import { ChallengeEmblem } from "./ChallengeEmblem";
import { DifficultyPill } from "./Difficulty";

/**
 * The moment a challenge starts. The emblem is struck, the title resolves, and
 * the whole thing dissolves into the workspace behind it — so entering a
 * challenge feels like a mode change rather than a re-render.
 *
 * It dismisses itself; it is a transition, not a dialog.
 */
export function ChallengeIntro({
  question,
  onDone,
}: {
  question: ActiveQuestion | null;
  onDone(): void;
}) {
  useEffect(() => {
    if (!question) return;
    const timer = setTimeout(onDone, 2_100);
    const skip = () => onDone();
    addEventListener("keydown", skip);
    addEventListener("mousedown", skip);
    return () => {
      clearTimeout(timer);
      removeEventListener("keydown", skip);
      removeEventListener("mousedown", skip);
    };
  }, [question, onDone]);

  return (
    <AnimatePresence>
      {question && (
        <motion.div
          animate={{ opacity: 1 }}
          className="absolute inset-0 z-30 grid place-items-center"
          exit={{ opacity: 0, filter: "blur(10px)" }}
          initial={{ opacity: 0 }}
          transition={{ duration: 0.42, ease: [0.22, 0.61, 0.36, 1] }}
        >
          <div className="absolute inset-0 bg-[var(--app-window-fill)]/92 backdrop-blur-2xl" />

          <motion.div
            animate={{ scale: 1, y: 0 }}
            className="relative flex flex-col items-center px-10 text-center"
            exit={{ scale: 1.04, y: -8 }}
            initial={{ scale: 0.94, y: 10 }}
            transition={{ type: "spring", stiffness: 260, damping: 26, mass: 0.8 }}
          >
            <motion.div
              animate={{ scale: 1, opacity: 1, filter: "blur(0px)" }}
              initial={{ scale: 0.6, opacity: 0, filter: "blur(16px)" }}
              transition={{ type: "spring", stiffness: 220, damping: 20, delay: 0.05 }}
            >
              <ChallengeEmblem question={question} size={132} />
            </motion.div>

            <motion.p
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 text-ui-sm font-medium tracking-[0.22em] text-muted-foreground"
              initial={{ opacity: 0, y: 8 }}
              transition={{ delay: 0.32, duration: 0.4 }}
            >
              CHALLENGE {question.ordinal}
            </motion.p>

            <motion.h1
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              className="mt-2 max-w-[28ch] text-[1.7rem] font-semibold leading-[1.15] tracking-[-0.035em]"
              initial={{ opacity: 0, y: 12, filter: "blur(8px)" }}
              transition={{ delay: 0.42, duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }}
            >
              {question.title}
            </motion.h1>

            <motion.div
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 flex items-center gap-2"
              initial={{ opacity: 0, y: 8 }}
              transition={{ delay: 0.56, duration: 0.4 }}
            >
              <DifficultyPill difficulty={question.difficulty} />
              <span
                className="grid size-6 place-items-center rounded-md bg-[var(--color-background-elevated-secondary)] text-foreground/70"
                title={LANGUAGE_LABEL[question.language]}
              >
                <LanguageGlyph className="size-3.5" language={question.language} />
              </span>
            </motion.div>

            <motion.p
              animate={{ opacity: 1 }}
              className="mt-7 text-ui-sm text-muted-foreground/60"
              initial={{ opacity: 0 }}
              transition={{ delay: 1.1, duration: 0.5 }}
            >
              {question.abilityTitle}
            </motion.p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
