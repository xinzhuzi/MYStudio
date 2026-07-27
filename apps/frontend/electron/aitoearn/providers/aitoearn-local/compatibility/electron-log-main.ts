const originalLog = console.log.bind(console);
const originalError = console.error.bind(console);

const log = {
  transports: { file: { level: "info", maxSize: 10 * 1024 * 1024, resolvePathFn: undefined as (() => string) | undefined } },
  initialize() {},
  log: originalLog,
  error: originalError,
};

export default log;
