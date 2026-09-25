import type { Recording } from "./bridge";
import { Cancelled, type Clock } from "./clock";
import type { Cursor } from "./cursor";
import { filmEditor } from "./StaticEditor";

/**
 * The film's script: what the learner does, and when.
 *
 * Only the learner is scripted. Everything that answers them — the run, the
 * verdict, the agent's turn — is the recording arriving through the bridge, and
 * the renderer drawing it the way it always does. The beats are the recording's
 * own virtual timestamps, so the director waits on the clock rather than on
 * timers and the two cannot drift apart.
 */
export async function direct({ recording, clock, cursor, shift, signal }: { recording: Recording; clock: Clock; cursor: Cursor; shift(): number; signal: AbortSignal }) {
  const beats = recording.clock.beats as Record<"typeStart" | "typeEnd" | "run" | "runSettles" | "submit" | "submitSettles" | "composeStart" | "send", number>;
  const pause = (ms: number) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Cancelled()); }, { once: true });
  });
  const until = async (epoch: number) => { await clock.until(epoch); if (signal.aborted) throw new Cancelled(); };

  /* Open the session from the sidebar, the way anyone would: its Track first. */
  const track = await find(() => sidebarRow("teach me trees", true), signal);
  await pause(700);
  if (track.getAttribute("aria-expanded") !== "true") {
    await cursor.moveTo(track, { ax: 0.35 });
    await pause(160);
    await cursor.click(track);
    await pause(380);
  }
  /* A session's row is titled by the challenge it has open. */
  const session = recording.states.opening.bootstrap.sessions.find((entry) => entry.id === recording.source.session);
  const row = await find(() => sidebarRow((session?.activeQuestion?.title ?? "").toLowerCase(), false), signal);
  await cursor.moveTo(row, { ax: 0.35 });
  await pause(160);
  await cursor.click(row);
  const editor = await find(() => document.querySelector("[data-film=editor]"), signal);
  await pause(400);

  /* The clock starts when the challenge is on screen. */
  clock.rate(1);
  await until(beats.typeStart);
  await cursor.moveTo(editor, { ax: 0.42, ay: 0.12, beam: true });
  await pause(220);

  /* Replace the starter's body with the attempt, a keystroke at a time. */
  const starter = recording.files.before[recording.learner.path] ?? "";
  const header = `${starter.split("\n")[0]}\n`;
  let text = starter;
  filmEditor.current?.type(text, text.trimEnd().length);
  await pause(260);
  /* Two line deletions, as ⌘⇧K does them. */
  const lines = starter.replace(/\n$/, "").split("\n");
  for (let keep = lines.length - 1; keep >= 1; keep -= 1) {
    text = `${lines.slice(0, keep).join("\n")}\n`;
    filmEditor.current?.type(text, text.length - 1);
    await pause(180);
  }
  text = header;
  const body = recording.learner.code.slice(header.length);
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]!;
    text += char;
    filmEditor.current?.type(text, text.length);
    /* Indentation arrives with the newline, the way the editor inserts it. */
    const indenting = char === " " && (body[index - 1] === "\n" || body[index - 1] === " ") && /^ *$/.test(body.slice(body.lastIndexOf("\n", index - 1) + 1, index + 1));
    if (indenting) continue;
    await pause(char === "\n" ? 180 : /[a-z]/i.test(char) ? 26 + Math.random() * 34 : 60 + Math.random() * 60);
  }
  await pause(500);

  /* Run the visible cases. */
  await until(Math.min(clock.now(), beats.run));
  const runButton = await find(() => toolbarButton("Run"), signal);
  await cursor.moveTo(runButton);
  await pause(140);
  await cursor.click(runButton);
  filmEditor.current?.blur();
  await pause(2100);

  /* All four pass. Submit. */
  const submitButton = await find(() => toolbarButton("Submit"), signal);
  await cursor.moveTo(submitButton);
  await pause(180);
  await cursor.click(submitButton);
  /* Judged; then let the failing hidden case be read. The panel names the case
     that broke, so that name on screen is the verdict having landed. */
  const failedCase = /^not ok - (.+)$/m.exec(recording.submission.output)?.[1] ?? "";
  const verdict = await find(() => leafWithText(failedCase), signal);
  await pause(700);
  await cursor.moveTo(verdict, { ax: 0.2, ay: 0.5 });
  await pause(2400);

  /* Ask for something simpler. */
  const composer = await find(() => document.querySelector<HTMLTextAreaElement>("textarea[placeholder]"), signal);
  await cursor.moveTo(composer, { ax: 0.25, beam: true });
  await pause(160);
  await cursor.click(composer);
  let draft = "";
  for (const char of recording.learner.message) {
    draft += char;
    typeInto(composer, draft);
    await pause(char === " " ? 90 : 45 + Math.random() * 55);
  }
  await pause(420);
  const send = sendButton(composer);
  if (send) {
    await cursor.moveTo(send);
    await pause(140);
    await cursor.click(send);
  } else {
    composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  }
  cursor.setShape("arrow");
  await cursor.moveToPoint(window.innerWidth * 0.66, window.innerHeight * 0.62, 900);

  /* The turn. Time is compressed where the real one only waited on a model —
     a model writing, a reviewer reading, a repair — and not where there is
     something to read. */
  const stream = recording.stream;
  const draftStarts = stream.find((entry) => entry.event.type === "draft")?.at ?? recording.clock.agent.start;
  const staging = stream.find((entry) => entry.event.type === "tool" && entry.event.phase === "start" && entry.event.tool === "replace_current_question")?.at ?? draftStarts;
  const replying = stream.find((entry) => entry.event.type === "text")?.at ?? recording.clock.agent.end;
  const late = shift();
  clock.rate(1.6);
  await until(draftStarts + late);
  clock.rate(3.2);
  await until(staging + late);
  clock.rate(5.5);
  await until(replying + late - 300);
  clock.rate(1.4);
  await until(recording.clock.agent.end + late);
  clock.rate(1);

  /* The new challenge is on screen. Hold on it. */
  await pause(7_500);
}

/** Waits for the renderer to draw something, a frame at a time. */
function find<T extends Element>(lookup: () => T | null | undefined, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const frame = () => {
      if (signal.aborted) return reject(new Cancelled());
      const found = lookup();
      if (found) return resolve(found);
      if (performance.now() - started > 15_000) return reject(new Error("The film lost its place"));
      requestAnimationFrame(frame);
    };
    frame();
  });
}

/** The innermost visible element whose text is exactly `text`. */
function leafWithText(text: string) {
  return [...document.querySelectorAll<HTMLElement>("#root *")]
    .find((element) => element.childElementCount === 0 && element.textContent?.trim() === text && element.offsetParent !== null) ?? null;
}

/** A Track's trigger carries `aria-expanded`; a session row does not. */
function sidebarRow(title: string, trigger: boolean) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.hasAttribute("aria-expanded") === trigger && button.offsetParent !== null && button.textContent?.trim().toLowerCase().startsWith(title)) ?? null;
}

function toolbarButton(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.replace(/⌘.*/, "").trim() === label && button.offsetParent !== null) ?? null;
}

function sendButton(composer: HTMLElement) {
  const form = composer.closest("form") ?? composer.parentElement?.parentElement?.parentElement;
  const buttons = [...(form?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
  return buttons.find((button) => /send|submit/i.test(`${button.getAttribute("aria-label") ?? ""} ${button.title} ${button.type}`)) ?? buttons.at(-1) ?? null;
}

/** A controlled textarea only hears what React's own input listener hears. */
function typeInto(field: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  setter.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}
