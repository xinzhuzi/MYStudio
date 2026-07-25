function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function signalSpawnedApp(childProcess, signal, detached) {
  const pid = childProcess.pid;
  if (!pid) return;
  if (detached && process.platform !== "win32") {
    try {
      process.kill(-pid, signal);
      return;
    } catch (error) {
      if (error?.code === "ESRCH") return;
    }
  }
  try {
    childProcess.kill(signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

export async function terminateSpawnedApp(
  childProcess,
  { detached = true, logPrefix = "[smoke]" } = {},
) {
  const pid = childProcess.pid;
  if (!pid) return;
  signalSpawnedApp(childProcess, "SIGTERM", detached);
  const deadline = Date.now() + 2_500;
  while (isProcessRunning(pid) && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  if (isProcessRunning(pid)) signalSpawnedApp(childProcess, "SIGKILL", detached);
  childProcess.unref();
  console.log(`${logPrefix} terminated smoke app: pid=${pid}`);
}
