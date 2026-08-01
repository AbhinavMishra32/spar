import { describe,expect,it } from "vitest";
import { compileQuestion } from "./compiler.js";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const design={title:"Repair the queue",language:"typescript",kind:"repair",statement:"Repair the event queue so work enqueued while draining is never lost.",starterFiles:{"queue.ts":"broken"},referenceFiles:{"queue.ts":"correct"},visibleTests:{"visible.test.ts":"visible"},hiddenTests:{"hidden.test.ts":"hidden"},knownIncorrectFiles:[{"queue.ts":"incorrect"}],runCommand:"test",accidentalDifficulty:["basic TypeScript"],expectedFailureSignatures:["stops after current batch"]};
const actual={title:"Normalize event batches",language:"javascript" as const,kind:"function" as const,statement:"Return the first stable batch whose accumulated weight reaches the requested threshold.",starterFiles:{"src/batch.js":"export function firstStableBatch(events, threshold) { throw new Error(\"implement\") }"},referenceFiles:{"src/batch.js":"export function firstStableBatch(events, threshold) { let total=0; for(let i=0;i<events.length;i++){ total+=events[i]; if(total>=threshold)return events.slice(0,i+1) } return [] }"},visibleTests:{"tests/visible.test.js":"import test from \"node:test\";import assert from \"node:assert/strict\";import {firstStableBatch} from \"../src/batch.js\";test(\"direct threshold\",()=>assert.deepEqual(firstStableBatch([2,3],5),[2,3]));"},hiddenTests:{"tests/hidden.test.js":"import test from \"node:test\";import assert from \"node:assert/strict\";import {firstStableBatch} from \"../src/batch.js\";test(\"must stop at first valid invariant\",()=>assert.deepEqual(firstStableBatch([3,3,9],5),[3,3]));"},knownIncorrectFiles:[{"src/batch.js":"export function firstStableBatch(events, threshold) { let total=0; for(const event of events) total+=event; return total>=threshold?events:[] }"}],runCommand:"node --test",accidentalDifficulty:[],expectedFailureSignatures:["accumulates the complete input after the invariant is already satisfied"]};
const run=async(files:Record<string,string>)=>{const root=await mkdtemp(path.join(tmpdir(),"spar-compiler-"));const started=Date.now();try{for(const[file,content]of Object.entries(files)){const target=path.join(root,file);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,content);}try{const result=await promisify(execFile)(process.execPath,["--test",...Object.keys(files).filter(file=>file.endsWith(".test.js"))],{cwd:root,timeout:5000});return{exitCode:0,stdout:result.stdout,stderr:result.stderr,durationMs:Date.now()-started};}catch(error){const value=error as {stdout?:string;stderr?:string;code?:number};return{exitCode:Number(value.code??1),stdout:value.stdout??"",stderr:value.stderr??"",durationMs:Date.now()-started};}}finally{await rm(root,{recursive:true,force:true});}};
describe("question compiler",()=>{it("releases only when plausible incorrect code passes visible and fails hidden",async()=>{const {report}=await compileQuestion(design,async(files)=>({exitCode:files["queue.ts"]==="incorrect"&&"hidden.test.ts" in files?1:0,stdout:"",stderr:"",durationMs:5}));expect(report.valid).toBe(true);});it("rejects weak hidden tests",async()=>{const {report}=await compileQuestion({...design,expectedFailureSignatures:[]},async()=>({exitCode:0,stdout:"",stderr:"",durationMs:1}));expect(report.valid).toBe(false);});});

it("rejects misconception files that do not replace the reference implementation",async()=>{
  let runs=0;
  const {report}=await compileQuestion({...design,knownIncorrectFiles:[{"wrong-path.ts":"incorrect"}]},async()=>{runs+=1;return{exitCode:0,stdout:"",stderr:"",durationMs:1};});
  expect(report.valid).toBe(false);
  expect(report.checks.find(check=>check.name==="known incorrect 1 replaces reference implementation")?.detail).toContain("queue.ts");
  expect(runs).toBe(2);
});

it("materializes JavaScript assertion oracles from the isolated reference solution",async()=>{
  const wrongExpected={...actual,hiddenTests:{"tests/hidden.test.js":"import test from \"node:test\";import assert from \"node:assert/strict\";import {firstStableBatch} from \"../src/batch.js\";test(\"must stop at first valid invariant\",()=>assert.deepEqual(firstStableBatch([3,3,9],5),[3,3,9]));"}};
  const compiled=await compileQuestion(wrongExpected,run);
  expect(compiled.report.valid, JSON.stringify(compiled.report.checks.filter((check)=>!check.passed))).toBe(true);
  expect(compiled.design.hiddenTests["tests/hidden.test.js"]).toContain("[3,3]");
});

it("materializes a bounded differential hidden counterexample",async()=>{
  const weakHidden={...actual,hiddenTests:{"tests/hidden.test.js":actual.visibleTests["tests/visible.test.js"]}};
  const compiled=await compileQuestion(weakHidden,run);
  expect(compiled.report.valid).toBe(true);
  expect(Object.keys(compiled.design.hiddenTests)).toContain("src/.spar-generated-1.hidden.test.js");
});

it("synthesizes a visible-safe targeted mutant when the model gives an equivalent implementation",async()=>{
  const equivalent={...actual,knownIncorrectFiles:[actual.referenceFiles]};
  const compiled=await compileQuestion(equivalent,run);
  expect(compiled.report.valid).toBe(true);
  expect(compiled.design.knownIncorrectFiles[0]?.["src/batch.js"]).not.toBe(actual.referenceFiles["src/batch.js"]);
});

it("repairs a visible-failing branch misconception with a deterministic assignment mutant",async()=>{
  const branchDesign={
    title:"Predict branch updates",language:"javascript" as const,kind:"function" as const,difficulty:"foundation" as const,
    statement:"Return the final a and b values after applying the selected JavaScript branch.",
    starterFiles:{"src/branches.js":"export function branchValues(usePrimary) { throw new Error('implement') }"},
    referenceFiles:{"src/branches.js":"export function branchValues(usePrimary) { let a = 1; let b = 2; if (usePrimary) { b = 5; } else { a = 3; } return { a, b }; }"},
    visibleTests:{"test/visible.test.js":"import test from 'node:test'; import assert from 'node:assert/strict'; import { branchValues } from '../src/branches.js'; test('else branch', () => assert.deepStrictEqual(branchValues(false), { a: 3, b: 2 }));"},
    hiddenTests:{"test/hidden.test.js":"import test from 'node:test'; import assert from 'node:assert/strict'; import { branchValues } from '../src/branches.js'; test('primary branch', () => assert.deepStrictEqual(branchValues(true), { a: 1, b: 5 }));"},
    knownIncorrectFiles:[{"src/branches.js":"export function branchValues() { return { a: 1, b: 2 }; }"}],
    runCommand:"node --test",accidentalDifficulty:[],expectedFailureSignatures:["does not update b in the primary branch"],
  };
  const compiled=await compileQuestion(branchDesign,run);
  expect(compiled.report.valid,JSON.stringify(compiled.report.checks.filter((check)=>!check.passed))).toBe(true);
  expect(compiled.design.knownIncorrectFiles[0]?.["src/branches.js"]).toContain("b = b");
});

it("keeps validation failures concise and strips runner paths and stacks",async()=>{
  const compiled=await compileQuestion(actual,async()=>({exitCode:1,stdout:"TAP version 13\n# Subtest: returns the final values\nnot ok 1\n  location: '/private/validation/solution.test.js:5:1'\n  stack: |-\n    TestContext.<anonymous>",stderr:"",durationMs:179}));
  const detail=compiled.report.checks.find((check)=>check.name==="reference solution")?.detail??"";
  expect(detail).toBe("Exited 1 in 179ms: returns the final values");
  expect(detail).not.toContain("/private/validation");
  expect(detail).not.toContain("stack");
});

it("reports a CommonJS target whose return contract hides the misconception",async()=>{
  const commonjs={title:"Longest typed stream",language:"javascript" as const,kind:"function" as const,statement:"Return the longest contiguous event stream containing at most k distinct event types.",starterFiles:{"src/window.js":"function solve(){throw new Error('implement')} module.exports={solve};"},referenceFiles:{"src/window.js":"function solve(events,k){const counts=new Map();let left=0,best=0;for(let right=0;right<events.length;right++){counts.set(events[right],(counts.get(events[right])||0)+1);while(counts.size>k){const value=events[left++];counts.set(value,counts.get(value)-1);if(counts.get(value)===0)counts.delete(value)}best=Math.max(best,right-left+1)}return best} module.exports={solve};"},visibleTests:{"test/visible.test.js":"const test=require('node:test');const assert=require('node:assert/strict');const {solve}=require('../src/window.js');test('simple',()=>assert.equal(solve('ab',1),1));"},hiddenTests:{"test/hidden.test.js":"const test=require('node:test');const assert=require('node:assert/strict');const {solve}=require('../src/window.js');test('repeat',()=>assert.equal(solve('abc',1),1));"},knownIncorrectFiles:[{"path":"src/window.js","content":"function solve(events,k){const counts=new Map();let left=0,best=0;for(let right=0;right<events.length;right++){counts.set(events[right],(counts.get(events[right])||0)+1);if(counts.size>k){const value=events[left++];counts.set(value,counts.get(value)-1);if(counts.get(value)===0)counts.delete(value)}best=Math.max(best,right-left+1)}return best} module.exports={solve};"}],runCommand:"node --test",accidentalDifficulty:[],expectedFailureSignatures:["shrinks only once"]};
  const compiled=await compileQuestion(commonjs,run);
  expect(compiled.report.valid).toBe(false);
  expect(compiled.report.checks.find((check)=>check.name==="known incorrect 1 fails hidden")?.detail).toContain("return contract may hide");
},10_000);

it("executes real visible and hidden tests against reference and plausible wrong code",async()=>{
  const compiled=await compileQuestion(actual,run);expect(compiled.report.valid).toBe(true);expect(compiled.report.checks.find(check=>check.name==="known incorrect 1 passes visible")?.passed).toBe(true);expect(compiled.report.checks.find(check=>check.name==="known incorrect 1 fails hidden")?.passed).toBe(true);expect(compiled.report.checks.find(check=>check.name==="reference solution")?.passed).toBe(true);
});
