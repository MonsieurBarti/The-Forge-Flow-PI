import { readFileSync } from "node:fs";
import { join } from "node:path";

const PROMPT_PATH = join(import.meta.dirname, "../../../resources/prompts/compressor-notation.md");

export const COMPRESSOR_PROMPT = readFileSync(PROMPT_PATH, "utf-8").trim();
