type LogLevel = 'info' | 'warn' | 'error';

function emit(level: LogLevel, event: string, data?: Record<string, unknown>) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...data });
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
}

export function logInfo(event: string, data?: Record<string, unknown>) {
  emit('info', event, data);
}

export function logWarn(event: string, data?: Record<string, unknown>) {
  emit('warn', event, data);
}

export function logError(event: string, error: unknown, data?: Record<string, unknown>) {
  const reason = error instanceof Error ? error.message : String(error);
  emit('error', event, { ...data, reason });
}
