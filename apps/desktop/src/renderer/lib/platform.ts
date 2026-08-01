/**
 * Platform-dependent copy. Credentials go to whatever secret store keytar binds
 * to, and that store has a different name on every OS — naming the wrong one is
 * worse than naming none, because this text is what tells someone where their
 * API key actually went.
 */
const platform = window.spar?.chrome.platform ?? "darwin";

export const isMac = platform === "darwin";

/** What to call the machine the app is running on. */
export const deviceNoun = isMac ? "Mac" : platform === "win32" ? "PC" : "computer";

/** The OS secret store keytar writes to here. */
export const credentialStore = isMac
  ? "the macOS Keychain"
  : platform === "win32"
    ? "Windows Credential Manager"
    : "the system keyring";

/** Modifier shown in shortcut hints. */
export const modKey = isMac ? "⌘" : "Ctrl";
