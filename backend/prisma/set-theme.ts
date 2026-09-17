/**
 * Set the platform theme from the command line.
 *
 * The control panel is the normal way to change this, but a one-off run is handy after a
 * test leaves the platform on the wrong palette:
 *
 *   npx ts-node prisma/set-theme.ts rhododendron rhododendron
 *
 * Names must match THEME_PALETTES / THEME_BACKGROUNDS in
 * src/modules/settings/dto/settings.dto.ts, which is what the API validates against.
 */
import { PrismaClient } from '@prisma/client';

const PALETTES = [
  'prayer-flag', 'rhododendron', 'himalaya-dawn', 'teahouse',
  'forest-trail', 'monsoon', 'lakeside-sunset', 'night-bus',
];
const BACKGROUNDS = [
  'none', 'rhododendron', 'prayer-flags', 'himalaya',
  'terraced-fields', 'newar-lattice', 'paper-grain',
];

async function main() {
  const [palette, background] = process.argv.slice(2);
  if (!palette) {
    console.error(`Usage: ts-node prisma/set-theme.ts <palette> [background]
  palettes:    ${PALETTES.join(', ')}
  backgrounds: ${BACKGROUNDS.join(', ')}`);
    process.exit(1);
  }
  if (!PALETTES.includes(palette)) {
    console.error(`Unknown palette "${palette}". Choose one of: ${PALETTES.join(', ')}`);
    process.exit(1);
  }
  if (background && !BACKGROUNDS.includes(background)) {
    console.error(`Unknown background "${background}". Choose one of: ${BACKGROUNDS.join(', ')}`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const data = { themePalette: palette, ...(background ? { themeBackground: background } : {}) };
    // The row is created by the migration, but upsert keeps this usable on a fresh database.
    const setting = await prisma.platformSetting.upsert({
      where: { id: 'app' },
      update: data,
      create: { id: 'app', ...data },
    });
    console.log(`Theme is now ${setting.themePalette} / ${setting.themeBackground}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
