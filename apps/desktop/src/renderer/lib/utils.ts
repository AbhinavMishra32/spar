import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * This app's type scale, declared to tailwind-merge.
 *
 * Without this list every one of these sizes is silently deleted from any class
 * string that also carries an arbitrary-value text colour — which is most rows
 * in the thread. tailwind-merge resolves conflicts by class *group*, and it
 * infers the group from the name: `text-sm` it knows is a font size, an
 * arbitrary value in brackets it guesses is a colour, and a custom token like
 * `text-thread` it has never heard of, so it files that under colour too. Two
 * classes in one group means the later one wins, so a row built from a size
 * constant plus a colour shipped the colour and dropped the size, and fell back
 * to whatever it inherited.
 *
 * That is invisible in the stylesheet: the `.text-thread` rule compiles
 * correctly and is simply never applied, which is why the thread could be one
 * size in the CSS and two sizes on screen. Naming the scale here is what makes
 * the two agree — a token added to `@theme` in theme.css has to be added here
 * too, or it will behave the same way.
 *
 * Class names are spelled without bracket syntax in this comment on purpose:
 * Tailwind scans comments for candidates, and an illustrative one in brackets
 * compiles to a real, broken rule.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{
        text: [
          "ui", "ui-sm",
          "content", "content-sm", "content-title",
          "source", "source-sm",
          "thread", "thread-tool",
        ],
      }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
