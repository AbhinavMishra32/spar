import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Language } from "@spar/domain";
import { LanguageGlyph, LANGUAGE_LABEL } from "./LanguageGlyph";

const LANGUAGES: Language[] = ["javascript", "typescript", "python", "java", "c", "cpp", "go", "rust", "swift", "ruby"];

describe("language glyphs", () => {
  it.each(LANGUAGES)("renders the real %s mark rather than a text monogram", (language) => {
    const markup = renderToStaticMarkup(<LanguageGlyph language={language} />);

    expect(markup).toContain(`<svg`);
    expect(markup).toContain(`aria-label="${LANGUAGE_LABEL[language]}"`);
    expect(markup).toContain("<path");
    expect(markup).not.toContain("<text");
  });
});
