import { defineBuildConfig } from 'obuild/config'

export default defineBuildConfig({
  entries: [
    {
      type: 'bundle',
      input: [
        './src/index.ts',
        './src/cli.ts',
        './src/ai.ts',
        './src/opencode.ts',
      ],
    },
  ],
  hooks: {
    rolldownConfig(config) {
      config.external = config.external.filter((entry) =>
        typeof entry === 'string'
          ? entry !== '@opencode-ai/plugin'
          : !entry.test('@opencode-ai/plugin/tool'),
      )
    },
  },
})
