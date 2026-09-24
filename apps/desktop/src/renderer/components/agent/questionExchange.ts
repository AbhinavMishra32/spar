type Exchange = { question: string; answer: string; choices: string[] };

function json(value: string): unknown {
  try { return JSON.parse(value); } catch { return value; }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Read both the current questions[] tool and older single-question turns. */
export function questionExchange(input: string, output: string): Exchange[] {
  const args = object(json(input));
  const result = json(output);
  const outcome = object(result);
  if (outcome.status === "cancelled") return [];
  const answer = typeof result === "string" ? result : typeof outcome.answer === "string" ? outcome.answer : "";
  const rawQuestions = Array.isArray(args.questions) ? args.questions : Array.isArray(object(outcome.request).questions) ? object(outcome.request).questions as unknown[] : [];
  const questions = rawQuestions.map(object).filter((item) => typeof item.question === "string" && item.question.trim());
  if (questions.length) {
    const answers = splitAnswers(questions.map((item) => String(item.header ?? "")), answer);
    if (answers.length !== questions.length) return [{ question: questions.map((item) => String(item.question)).join("\n"), answer, choices: [] }];
    return questions.map((item, index) => ({
      question: String(item.question),
      answer: answers[index] ?? "",
      choices: Array.isArray(item.options) ? item.options.map((option) => String(object(option).label ?? "")).filter(Boolean) : [],
    }));
  }
  const question = typeof args.question === "string" ? args.question : "";
  return question ? [{ question, answer, choices: Array.isArray(args.choices) ? args.choices.filter((choice): choice is string => typeof choice === "string") : [] }] : [];
}

export function isAnsweredQuestion(input: string, output: string): boolean {
  return questionExchange(input, output).some((item) => item.answer.trim().length > 0);
}

function splitAnswers(headers: string[], answer: string): string[] {
  if (headers.length === 1) return [answer];
  const answers: string[] = [];
  let cursor = 0;
  for (const [index, header] of headers.entries()) {
    const prefix = `${header}: `;
    if (!answer.startsWith(prefix, cursor)) return [answer];
    const start = cursor + prefix.length;
    const next = headers[index + 1];
    const end = next === undefined ? answer.length : answer.indexOf(`\n${next}: `, start);
    if (end < 0) return [answer];
    answers.push(answer.slice(start, end).trim());
    cursor = end + 1;
  }
  return answers;
}
