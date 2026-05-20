#!/usr/bin/env node

import { defineCommand, runMain } from 'citty'
import { normalizeMainArgs } from './cli-args.ts'
import { version } from './version.ts'

const main = defineCommand({
  meta: {
    name: 'askweb',
    version,
    description: 'Unified web search and read provider for agents and CLI',
  },
  subCommands: {
    search: () => import('./commands/search.ts').then(m => m.default),
    read: () => import('./commands/read.ts').then(m => m.default),
    providers: () => import('./commands/providers.ts').then(m => m.default),
  },
})

await runMain(main, { rawArgs: normalizeMainArgs(process.argv.slice(2)) })
