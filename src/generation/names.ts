import { Rng } from '../util/rng';

const PREFIX = [
  'Al', 'Bel', 'Cor', 'Dra', 'El', 'Fen', 'Gor', 'Hy', 'Ix', 'Jor',
  'Kel', 'Lu', 'Mor', 'Ny', 'Or', 'Pra', 'Qu', 'Rho', 'Sy', 'Ta',
  'Ul', 'Va', 'Wex', 'Xan', 'Yr', 'Zor',
];
const MIDDLE = [
  'a', 'e', 'i', 'o', 'u', 'ae', 'ei', 'ou', 'ar', 'en', 'ir', 'on', 'us',
];
const SUFFIX = [
  'ra', 'nor', 'lis', 'tor', 'nia', 'dus', 'ven', 'thys', 'mar', 'gon',
  'plex', 'vane', 'dor', 'ques', 'rion', 'tara', 'lox', 'phon',
];

const GREEK = [
  'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta',
  'Iota', 'Kappa', 'Lambda', 'Sigma', 'Omega', 'Tau', 'Rho',
];

export function systemName(rng: Rng): string {
  // Occasionally use a "Greek + number" designation for flavour variety.
  if (rng.float() < 0.22) {
    return `${rng.pick(GREEK)} ${rng.int(1, 99)}`;
  }
  let name = rng.pick(PREFIX);
  if (rng.float() < 0.55) name += rng.pick(MIDDLE);
  name += rng.pick(SUFFIX);
  return name;
}

const EMPIRE_FORMS = [
  (core: string) => `${core} Empire`,
  (core: string) => `${core} Republic`,
  (core: string) => `${core} Federation`,
  (core: string) => `${core} Dominion`,
  (core: string) => `${core} Hegemony`,
  (core: string) => `${core} Collective`,
  (core: string) => `Star Kingdom of ${core}`,
  (core: string) => `${core} Union`,
];

export function empireName(rng: Rng): string {
  const core = rng.pick(PREFIX) + rng.pick(SUFFIX);
  return rng.pick(EMPIRE_FORMS)(core);
}
