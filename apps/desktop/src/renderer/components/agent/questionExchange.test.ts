import { expect, it } from "vitest";
import { isAnsweredQuestion, questionExchange } from "./questionExchange";

it("reads an answered current question from the stored tool payload", () => {
  const questions = [{ header: "Direction", question: "What should we practise?", options: [{ label: "Stacks" }, { label: "Trees" }] }];
  const input = JSON.stringify({ questions });
  const output = JSON.stringify({ status: "answered", request: { questions }, answer: "Stacks" });
  expect(questionExchange(input, output)).toEqual([{ question: "What should we practise?", answer: "Stacks", choices: ["Stacks", "Trees"] }]);
  expect(isAnsweredQuestion(input, output)).toBe(true);
});

it("keeps multi-question custom answers attached to their questions", () => {
  const input = JSON.stringify({ questions: [
    { header: "Goal", question: "What is the goal?", options: [] },
    { header: "Context", question: "What happened?", options: [] },
  ] });
  const output = JSON.stringify({ status: "answered", answer: "Goal: Practise monotonic stacks\nContext: I solved next greater.\nI want another direction." });
  expect(questionExchange(input, output).map((item) => item.answer)).toEqual(["Practise monotonic stacks", "I solved next greater.\nI want another direction."]);
});

it("keeps older single-question turns and excludes pending or cancelled questions", () => {
  const input = JSON.stringify({ question: "Which language?", choices: ["Python", "JavaScript"] });
  expect(questionExchange(input, JSON.stringify("Python"))).toEqual([{ question: "Which language?", answer: "Python", choices: ["Python", "JavaScript"] }]);
  expect(isAnsweredQuestion(input, "")).toBe(false);
  expect(isAnsweredQuestion(input, JSON.stringify({ status: "cancelled" }))).toBe(false);
});
