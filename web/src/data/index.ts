import type { DataSource } from "./source.ts";
import { fixtureSource } from "./fixtureSource.ts";
import { apiSource } from "./apiSource.ts";
import { TOKEN } from "./token.ts";

/**
 * VITE_DATA_SOURCE wins when set. Otherwise a launch token means the local API is there
 * (demo mode), and no token means the bundled SYNTHETIC fixtures.
 */
const explicit = import.meta.env.VITE_DATA_SOURCE as string | undefined;
const mode = explicit ?? (TOKEN ? "api" : "fixtures");
export const dataSource: DataSource = mode === "api" ? apiSource : fixtureSource;
