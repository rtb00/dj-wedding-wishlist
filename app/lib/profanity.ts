const BLOCKED = [
  // Deutsch
  'scheiß', 'scheiss', 'arschloch', 'wichser', 'ficken', 'ficker', 'hure',
  'hurensohn', 'nutte', 'schlampe', 'fotze', 'spasti', 'wixer', 'kacke',
  // Englisch
  'fuck', 'fucker', 'fucking', 'shit', 'asshole', 'bitch', 'cunt',
  'pussy', 'faggot', 'nigger', 'nigga', 'motherfucker', 'whore', 'slut',
];

export function containsProfanity(text: string): boolean {
  const lower = text.toLowerCase();
  return BLOCKED.some((w) => lower.includes(w));
}
