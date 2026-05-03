import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repo layout: carethread/demo-data, carethread/server/src */
export const DEMO_DATA_DIR = join(__dirname, "..", "..", "demo-data");
