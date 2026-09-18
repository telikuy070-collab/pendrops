export interface RetryOptions {
  retries?: number;
  baseDelay?: number;
  maxDelay?: number;
  backoff?: 'exponential' | 'linear';
  retryable?: (error: Error) => boolean;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { retries = 3, baseDelay = 1000, maxDelay = 10000, backoff = 'exponential', retryable } = options;

  let lastError: Error;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt === retries) throw error;
      if (retryable && !retryable(error as Error)) throw error;

      const delay = backoff === 'exponential'
        ? Math.min(baseDelay * Math.pow(2, attempt), maxDelay)
        : Math.min(baseDelay * (attempt + 1), maxDelay);

      await new Promise(r => setTimeout(r, delay + Math.random() * 100));
    }
  }
  throw lastError!;
}