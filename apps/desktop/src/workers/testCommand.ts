/**
 * The flags every JavaScript and TypeScript test run is launched with.
 *
 * The reporter is named rather than inherited. Node picks its default from
 * whether stdout is a TTY, and the runtime here is Electron's Node, which chose
 * the human-readable `spec` reporter even on a pipe — a format with no
 * machine-readable per-case detail in it. So every run in the app arrived as a
 * wall of text and the result panel could never show a single case, while the
 * same command under system Node emitted TAP and looked fine. Asking for TAP
 * explicitly is what makes the two agree.
 *
 * Its own module because the runner is a worker entry that throws on import
 * outside a utility process, and the fallback test builds the same command.
 */
export const TEST_FLAGS = ["--test", "--test-reporter=tap"];
