import type { ComponentProps } from "react";
import type { Language } from "@spar/domain";
import cSvg from "simple-icons/icons/c.svg?raw";
import cppSvg from "simple-icons/icons/cplusplus.svg?raw";
import goSvg from "simple-icons/icons/go.svg?raw";
import rubySvg from "simple-icons/icons/ruby.svg?raw";
import rustSvg from "simple-icons/icons/rust.svg?raw";
import swiftSvg from "simple-icons/icons/swift.svg?raw";
import javaOriginal from "@/assets/languages/java-original.svg";
import pythonOriginal from "@/assets/languages/python-original.svg";
import { cn } from "@/lib/utils";
import { LANGUAGE_BRAND_COLOR } from "@/lib/brand";

/**
 * The languages' own marks, on the same terms as `ProviderGlyph`: the vendor
 * path in its canonical colour. JavaScript and TypeScript use their actual
 * two-tone tiles; the other marks come from Simple Icons' maintained vendor
 * paths rather than letter tiles invented by Spar.
 *
 * The glyph itself carries no visible label. Compact chrome can use the mark
 * alone with an accessible name; choice surfaces may pair it with visible text
 * so choosing a language never becomes a logo-memory test.
 */
type GlyphProps = ComponentProps<"svg">;

export const LANGUAGE_LABEL: Record<Language, string> = {
  javascript: "JavaScript",
  typescript: "TypeScript",
  python:"Python",java:"Java",c:"C",
  cpp: "C++",
  go:"Go",rust:"Rust",swift:"Swift",ruby:"Ruby",
};
/** Simple Icons publishes one path per vendor SVG. Importing each SVG directly
 * keeps Vite from loading the package's multi-megabyte all-icons registry. */
function iconPath(svg: string): string {
  return /<path d="([^"]+)"/.exec(svg)?.[1] ?? "";
}

const LANGUAGE_ICON_PATH: Partial<Record<Language, string>> = {
  c: iconPath(cSvg),
  cpp: iconPath(cppSvg),
  go: iconPath(goSvg),
  rust: iconPath(rustSvg),
  swift: iconPath(swiftSvg),
  ruby: iconPath(rubySvg),
};

const JAVASCRIPT_LETTERS = "M22.034 18.276c-.175-1.095-.888-2.015-3.003-2.873-.736-.345-1.554-.585-1.797-1.14-.091-.33-.105-.51-.046-.705.15-.646.915-.84 1.515-.66.39.12.75.42.976.9 1.034-.676 1.034-.676 1.755-1.125-.27-.42-.404-.601-.586-.78-.63-.705-1.469-1.065-2.834-1.034l-.705.089c-.676.165-1.32.525-1.71 1.005-1.14 1.291-.811 3.541.569 4.471 1.365 1.02 3.361 1.244 3.616 2.205.24 1.17-.87 1.545-1.966 1.41-.811-.18-1.26-.586-1.755-1.336l-1.83 1.051c.21.48.45.689.81 1.109 1.74 1.756 6.09 1.666 6.871-1.004.029-.09.24-.705.074-1.65l.046.067zM13.051 11.031h-2.248c0 1.938-.009 3.864-.009 5.805 0 1.232.063 2.363-.138 2.711-.33.689-1.18.601-1.566.48-.396-.196-.597-.466-.83-.855-.063-.105-.11-.196-.127-.196l-1.825 1.125c.305.63.75 1.172 1.324 1.517.855.51 2.004.675 3.207.405.783-.226 1.458-.691 1.811-1.411.51-.93.402-2.07.397-3.346.012-2.054 0-4.109 0-6.179l.004-.056z";

const TYPESCRIPT_LETTERS = "M18.488 9.75c.612 0 1.154.037 1.627.111a6.38 6.38 0 0 1 1.306.34v2.458a3.95 3.95 0 0 0-.643-.361 5.093 5.093 0 0 0-.717-.26 5.453 5.453 0 0 0-1.426-.2c-.3 0-.573.028-.819.086a2.1 2.1 0 0 0-.623.242c-.17.104-.3.229-.393.374a.888.888 0 0 0-.14.49c0 .196.053.373.156.529.104.156.252.304.443.444s.423.276.696.41c.273.135.582.274.926.416.47.197.892.407 1.266.628.374.222.695.473.963.753.268.279.472.598.614.957.142.359.214.776.214 1.253 0 .657-.125 1.21-.373 1.656a3.033 3.033 0 0 1-1.012 1.085 4.38 4.38 0 0 1-1.487.596c-.566.12-1.163.18-1.79.18a9.916 9.916 0 0 1-1.84-.164 5.544 5.544 0 0 1-1.512-.493v-2.63a5.033 5.033 0 0 0 3.237 1.2c.333 0 .624-.03.872-.09.249-.06.456-.144.623-.25.166-.108.29-.234.373-.38a1.023 1.023 0 0 0-.074-1.089 2.12 2.12 0 0 0-.537-.5 5.597 5.597 0 0 0-.807-.444 27.72 27.72 0 0 0-1.007-.436c-.918-.383-1.602-.852-2.053-1.405-.45-.553-.676-1.222-.676-2.005 0-.614.123-1.141.369-1.582.246-.441.58-.804 1.004-1.089a4.494 4.494 0 0 1 1.47-.629 7.536 7.536 0 0 1 1.77-.201zM3.375 9.938h9.563v2.166H9.506v9.646H6.789v-9.646H3.375z";

export function LanguageGlyph({ className, language, style, ...props }: GlyphProps & { language: Language }) {
  const iconPath = LANGUAGE_ICON_PATH[language];
  return (
    <svg
      focusable="false"
      role="img"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
      aria-label={LANGUAGE_LABEL[language]}
      className={cn("size-full", className)}
      style={{ color: LANGUAGE_BRAND_COLOR[language], ...style }}
    >
      {language === "javascript" && <><path d="M0 0h24v24H0z" fill="currentColor" /><path d={JAVASCRIPT_LETTERS} fill="#111111" /></>}
      {language === "typescript" && <><rect fill="currentColor" height="24" rx="1.125" width="24" /><path d={TYPESCRIPT_LETTERS} fill="#ffffff" /></>}
      {language === "python" && <image height="24" href={pythonOriginal} width="24" />}
      {language === "java" && <image height="24" href={javaOriginal} width="24" />}
      {iconPath && <path d={iconPath} fill="currentColor" />}
    </svg>
  );
}

/** Selection surfaces use colour as state. Unselected marks stay fully present
 *  and recognisable, but lose their chroma; the chosen mark gets its real brand
 *  colour back. Keeping the filter here prevents Settings and onboarding from
 *  drifting into two different meanings for the same glyph treatment. */
export function SelectableLanguageGlyph({
  className,
  language,
  selected,
}: {
  className?: string;
  language: Language;
  selected: boolean;
}) {
  return (
    <LanguageGlyph
      className={cn(
        "transition-[filter,opacity] duration-150",
        !selected && "grayscale contrast-[0.7] brightness-[1.45] opacity-90",
        className,
      )}
      language={language}
    />
  );
}

/** The language a path or a fence tag names, or null when it is one Spar does not
 *  train in — a `json` fence or a `.md` file has no mark, and inventing one would
 *  be the stand-in glyph this module exists to avoid. */
export function languageOf(value: string): Language | null {
  const token = value.trim().toLowerCase();
  if (/\.(ts|tsx|mts)$/.test(token) || token === "typescript" || token === "ts" || token === "tsx") return "typescript";
  if (/\.(js|mjs|cjs|jsx)$/.test(token) || token === "javascript" || token === "js" || token === "jsx" || token === "node") return "javascript";
  if (/\.(cpp|cc|cxx|hpp|h)$/.test(token) || token === "cpp" || token === "c++" || token === "cxx") return "cpp";
  if (/\.py$/.test(token)||token==="python"||token==="py")return"python";
  if (/\.java$/.test(token)||token==="java")return"java";
  if (/\.c$/.test(token)||token==="c")return"c";
  if (/\.go$/.test(token)||token==="go"||token==="golang")return"go";
  if (/\.rs$/.test(token)||token==="rust"||token==="rs")return"rust";
  if (/\.swift$/.test(token)||token==="swift")return"swift";
  if (/\.rb$/.test(token)||token==="ruby"||token==="rb")return"ruby";
  return null;
}

/** The mark at chrome size, with the name reaching the pointer but not the layout. */
export function LanguageMark({ className, language }: { className?: string; language: Language }) {
  return (
    <span className={cn("inline-grid size-3.5 shrink-0 place-items-center", className)} title={LANGUAGE_LABEL[language]}>
      <LanguageGlyph language={language} />
    </span>
  );
}

/** A file's own mark, falling back to the generic file icon for everything Spar
 *  has no logo for. Takes the fallback as a prop so each caller keeps the icon
 *  its surroundings already use. */
export function FileGlyph({
  className,
  fallback: Fallback,
  path,
}: {
  className?: string;
  fallback: React.ComponentType<{ className?: string }>;
  path: string;
}) {
  const language = languageOf(path);
  return language
    ? <LanguageGlyph className={cn("size-3.5", className)} language={language} />
    : <Fallback className={cn("size-3.5", className)} />;
}
