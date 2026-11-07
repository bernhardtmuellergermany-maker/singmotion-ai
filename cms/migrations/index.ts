import * as studioSettings from "./20261027_220000_studio_settings";
import * as migration_20261023_140953_initial_cms from "./20261023_140953_initial_cms";

export const migrations = [
  {
    up: migration_20261023_140953_initial_cms.up,
    down: migration_20261023_140953_initial_cms.down,
    name: "20261023_140953_initial_cms",
  },
  {
    up: studioSettings.up,
    down: studioSettings.down,
    name: "20261027_220000_studio_settings",
  },
];
