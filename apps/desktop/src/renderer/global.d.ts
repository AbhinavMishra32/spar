import type { PracticeApi } from "../shared/api";
declare global { interface Window { practice: PracticeApi; MonacoEnvironment: { getWorker(moduleId:string,label:string):Worker } } }
export {};
