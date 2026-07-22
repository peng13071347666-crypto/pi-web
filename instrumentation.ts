/**
 * Next.js Instrumentation — runs once when the server starts.
 * Used here to install global error handlers so uncaught exceptions
 * in the Pi Agent SDK (or anywhere else) don't silently kill the process.
 */
export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    process.on("uncaughtException", (err) => {
      console.error("[pi-web] Uncaught exception (process kept alive):", err);
    });

    process.on("unhandledRejection", (reason) => {
      console.error("[pi-web] Unhandled rejection (process kept alive):", reason);
    });
  }
}
