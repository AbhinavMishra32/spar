import { app, Notification, type BrowserWindow } from "electron";
import type { LocalStore } from "./store.js";

/*
 * The one nudge a spaced review needs: something is due.
 *
 * The Dock badge carries the count all the time, because a review that is due and
 * not seen is a review that slides into overdue. A notification fires only when
 * the count has risen since the last look and the window is not already in
 * front. A learner mid-session does not need to be told about a card they can
 * see the badge for, and the same due card is announced once, not every tick.
 */

const CHECK_MS = 30 * 60_000;

export class ReviewReminders {
  private timer: NodeJS.Timeout | null = null;
  private announced = 0;

  constructor(private readonly store: LocalStore, private readonly window: () => BrowserWindow | null) {}

  start() {
    this.refresh(false);
    this.timer = setInterval(() => this.refresh(true), CHECK_MS);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Recount now. `announce` is false for changes the learner just made. */
  refresh(announce = true) {
    let due = 0;
    try { due = this.store.reviews.overview().dueCount; } catch { return; }
    const enabled = this.store.getSetting<boolean>("review-reminders-enabled", true) !== false;
    app.setBadgeCount(enabled ? due : 0);
    if (!announce || !enabled) { this.announced = due; return; }
    if (due > this.announced && !this.window()?.isFocused() && Notification.isSupported()) {
      const notice = new Notification({
        title: due === 1 ? "A review is due" : `${due} reviews are due`,
        body: "A few minutes now keeps the patterns you solved from fading.",
        silent: true,
      });
      notice.on("click", () => {
        const window = this.window();
        if (!window) return;
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
        window.webContents.send("reviews:open");
      });
      notice.show();
    }
    this.announced = due;
  }
}
