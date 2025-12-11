import chalk from "chalk";

export const logger = (tableName: string) => {
  if (
    process.env.NODE_ENV != null &&
    process.env.NODE_ENV !== "development" &&
    process.env.NODE_ENV !== "production"
  ) {
    return {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };
  }
  return {
    debug: (...args: unknown[]) => {
      console.debug(
        chalk.gray(`[${new Date().toISOString()}] [${tableName}] [DEBUG]`),
        ...args
      );
    },
    info: (...args: unknown[]) => {
      console.info(
        chalk.green(`[${new Date().toISOString()}] [${tableName}] [INFO]`),
        ...args
      );
    },
    warn: (...args: unknown[]) => {
      console.warn(
        chalk.yellow(`[${new Date().toISOString()}] [${tableName}] [WARN]`),
        ...args
      );
    },
    error: (...args: unknown[]) => {
      console.error(
        chalk.red(`[${new Date().toISOString()}] [${tableName}] [ERROR]`),
        ...args
      );
    },
  };
};

