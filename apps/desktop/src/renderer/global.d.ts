import type { SparApi } from "../shared/api";
declare global { interface Window { spar: SparApi; MonacoEnvironment: { getWorker(moduleId:string,label:string):Worker } } }
export {};
