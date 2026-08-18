import { describe, expect, test } from 'bun:test';
import { IndexerService } from '../../src/server/services/IndexerService';
import { CONSOLE_CATEGORIES } from '../../src/shared/categories';

// detectReleasePlatform is private; the detection table is the thing under test.
const detect = (title: string): string | null =>
  (IndexerService.prototype as never as { detectReleasePlatform(t: string): string | null })
    .detectReleasePlatform.call({}, title);

describe('release platform detection', () => {
  test('recognises current-gen systems', () => {
    expect(detect('Elden Ring PS5 [Repack]')).toBe('PlayStation 5');
    expect(detect('Some Game Nintendo Switch NSP')).toBe('Nintendo Switch');
    expect(detect('Halo Xbox Series X')).toBe('Xbox Series X|S');
  });

  test('recognises retro systems', () => {
    expect(detect('Gran Turismo 4 PS2 (USA)')).toBe('PlayStation 2');
    expect(detect('Demons Souls PS3 [EUR]')).toBe('PlayStation 3');
    expect(detect('Super Mario 64 N64')).toBe('Nintendo 64');
    expect(detect('Chrono Trigger SNES')).toBe('Super Nintendo Entertainment System');
    expect(detect('Metroid Prime GameCube')).toBe('Nintendo GameCube');
  });

  test('longer system names win over the shorter ones they contain', () => {
    // "Wii" is a substring of "Wii U", and "Xbox" of "Xbox 360" / "Xbox One".
    expect(detect('Some Game Wii U')).toBe('Wii U');
    expect(detect('Some Game Xbox 360')).toBe('Xbox 360');
    expect(detect('Some Game Xbox One')).toBe('Xbox One');
  });

  test('leaves untagged releases undetected rather than guessing', () => {
    // A wrong guess costs -200 in scoring, so no match is the safer answer.
    expect(detect('[DL] Dark Souls III [P] [RUS + ENG] (2016, RPG) [Portable]')).toBeNull();
    expect(detect('Assassins Creed Genesis')).toBeNull();
  });
});

describe('console categories', () => {
  const byId = new Map(CONSOLE_CATEGORIES.map((c) => [c.id, c.name]));

  test('match the Torznab tree Prowlarr serves', () => {
    expect(byId.get(1180)).toBe('Console/PS4');
    expect(byId.get(1140)).toBe('Console/Xbox One');
    expect(byId.get(1130)).toBe('Console/Wii U');
    expect(byId.get(1090)).toBe('Console/Other');
    expect(byId.get(1080)).toBe('Console/PS3');
    expect(byId.get(1020)).toBe('Console/PSP');
  });
});
