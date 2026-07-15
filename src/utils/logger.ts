/**
 * Logger Utility
 * MCP は stdio で JSON-RPC を喋るため console.log(stdout) は禁止。
 * すべて stderr（console.error）へ寄せてプロトコル汚染を防ぐ。
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface Logger {
  debug(context: string, message: string): void;
  info(context: string, message: string): void;
  warn(context: string, message: string): void;
  error(context: string, message: string, error?: Error): void;
}

function formatMessage(_level: LogLevel, context: string, message: string): string {
  return `[${context}] ${message}`;
}

export const logger: Logger = {
  debug(context, message) {
    if (process.env.DEBUG) {
      console.error(formatMessage('debug', context, message));
    }
  },
  info(context, message) {
    console.error(formatMessage('info', context, message));
  },
  warn(context, message) {
    console.error(formatMessage('warn', context, message));
  },
  error(context, message, error) {
    console.error(formatMessage('error', context, message));
    if (error && process.env.DEBUG) {
      console.error(error.stack);
    }
  },
};
