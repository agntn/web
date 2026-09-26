import { defineCommand } from "citty";
import { styleText } from "node:util";
import { consola } from "consola";
import { version } from "../version.ts";
import { formatProviderCapabilities } from "../tui.ts";

export default defineCommand({
  meta: {
    name: "providers",
    description: "List registered providers, configuration, and operation capabilities",
  },
  args: {
    json: {
      type: "boolean",
      description: "Print providers as JSON with configuration and capability details",
      default: false,
    },
  },
  async run({ args }) {
    const { listProviders } = await import("../core/resolve.ts");
    const status = listProviders();

    if (args.json) {
      process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
      return;
    }

    consola.log(`web ${version}`);
    for (const provider of status) {
      const capabilityLabel = `  ${styleText("gray", formatProviderCapabilities(provider))}`;
      if (provider.configured) {
        consola.log(`  ${styleText("green", "\u2713")} ${provider.name}${capabilityLabel}`);
      } else {
        consola.log(
          `  ${styleText("red", "\u2717")} ${provider.name}  ${styleText("gray", `${provider.envVar} not set`)}${capabilityLabel}`,
        );
      }
    }
  },
});
