import { toAiTool } from "@agntn/tools/ai";

import { webTools } from "./tools.ts";

const [search, searchImage, read, providers] = webTools();

/** `web_search` for the AI SDK: the model reads the text, your code reads `result`. */
export const searchTool = toAiTool(search);

/** `web_image_search` for the AI SDK, with the matches as `result`. */
export const searchImageTool = toAiTool(searchImage);

/** `web_read` for the AI SDK, with the page or batch as `result`. */
export const readTool = toAiTool(read);

/** `web_providers` for the AI SDK, with the build and provider statuses as `result`. */
export const providersTool = toAiTool(providers);
