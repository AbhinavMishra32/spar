import { existsSync, globSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { Language } from "@spar/domain";
import { planCppBuild } from "./cppBuild.js";
import { TEST_FLAGS } from "./testCommand.js";

export type RunnerStage={bin:string;args:string[]};
export type StageResolution={stages:RunnerStage[]}|{error:string};

export function resolveLanguageStages(root:string,language:Language,command:"test"|"run"):StageResolution{
  const tests=(pattern:string)=>globSync(pattern,{cwd:root}).sort();
  if(language==="javascript")return{stages:[{bin:process.execPath,args:command==="test"?[...TEST_FLAGS,...tests("**/*.test.js")]:[existsSync(path.join(root,"index.js"))?"index.js":"src/index.js"]}]};
  if(language==="typescript"){const tsxCli=createRequire(import.meta.url).resolve("tsx/cli");return{stages:[{bin:process.execPath,args:[tsxCli,...(command==="test"?[...TEST_FLAGS,...tests("**/*.test.ts")]:[existsSync(path.join(root,"index.ts"))?"index.ts":"src/index.ts"])]}]};}
  const standalone=(pattern:string,bin:string):StageResolution=>{const files=tests(pattern);return files.length?{stages:files.map(file=>({bin,args:[file]}))}:{error:`No ${language} test sources found.\n`};};
  if(language==="python")return standalone("**/{test_*.py,*_test.py}","python3");
  if(language==="ruby")return standalone("**/{*_test.rb,*.test.rb}","ruby");
  /* -v/--nocapture are part of Spar's case protocol, not developer noise: both
     runners otherwise swallow stdout from passing cases, which makes a correct
     run indistinguishable from a silent assert-only binary to the result UI. */
  if(language==="go")return tests("**/*_test.go").length?{stages:[{bin:"go",args:["test","-v","./..."]}]}:{error:"No Go test sources found. Use *_test.go files.\n"};
  const output=path.join(root,".spar");mkdirSync(output,{recursive:true});
  if(language==="java"){const files=tests("**/*.java");const testFiles=files.filter(file=>/Test\.java$/.test(file));if(!testFiles.length)return{error:"No Java test sources found. Use classes in files ending Test.java.\n"};const classes=path.join(output,"classes");rmSync(classes,{recursive:true,force:true});mkdirSync(classes,{recursive:true});return{stages:[{bin:"javac",args:["-d",classes,...files]},...testFiles.map(file=>({bin:"java",args:["-ea","-cp",classes,path.basename(file,".java")]}))]};}
  if(language==="rust"){const testFiles=tests("**/{*_test.rs,*.test.rs}");if(!testFiles.length)return{error:"No Rust test sources found. Use *_test.rs or *.test.rs files.\n"};return{stages:testFiles.flatMap((file,index)=>{const binary=path.join(output,`rust-test-${index}`);rmSync(binary,{force:true});return[{bin:"rustc",args:["--edition=2021","--test",file,"-o",binary]},{bin:binary,args:["--nocapture"]}];})};}
  if(language==="swift"){const files=tests("**/*.swift");const testFiles=files.filter(file=>/\.test\.swift$/.test(file));const sources=files.filter(file=>!/\.test\.swift$/.test(file));if(!testFiles.length)return{error:"No Swift test sources found. Use *.test.swift files with an @main test type.\n"};return{stages:testFiles.flatMap((file,index)=>{const binary=path.join(output,`swift-test-${index}`);rmSync(binary,{force:true});return[{bin:"swiftc",args:[...sources,file,"-o",binary]},{bin:binary,args:[]}];})};}
  if(language==="c"){const files=tests("**/*.{c,h}");const testFiles=files.filter(file=>/\.test\.c$/.test(file));const sources=files.filter(file=>file.endsWith(".c")&&!/\.test\.c$/.test(file));if(!testFiles.length)return{error:"No C test sources found. Use *.test.c files.\n"};return{stages:testFiles.flatMap((file,index)=>{const binary=path.join(output,`c-test-${index}`);rmSync(binary,{force:true});return[{bin:"clang",args:["-std=c17","-O2","-Wall","-Wextra","-pedantic","-Isrc","-Iinclude","-o",binary,file,...sources]},{bin:binary,args:[]}];})};}
  const plan=planCppBuild({files:tests("**/*.{cpp,cc,cxx,h,hpp,hh,hxx}"),outputDir:output,command});if("error"in plan)return plan;for(const binary of plan.binaries)rmSync(binary,{force:true});return{stages:plan.stages};
}
