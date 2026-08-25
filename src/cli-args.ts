const passthroughFirstArgs = new Set([
  'search',
  'read',
  'providers',
  'mcp',
])

const helpOrVersionFlags = new Set([
  '-h',
  '--help',
  '-v',
  '--version',
])

export function normalizeMainArgs(rawArgs: string[]): string[] {
  const [firstArg] = rawArgs

  if (!firstArg) {
    return rawArgs
  }

  if (passthroughFirstArgs.has(firstArg) || helpOrVersionFlags.has(firstArg)) {
    return rawArgs
  }

  return ['search', ...rawArgs]
}
