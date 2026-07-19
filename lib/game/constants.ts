// Single source of truth for guess limits -- daily and infinite both used to
// declare their own local `MAX_GUESSES = 5` copies (five separate places),
// which is exactly the kind of duplicated-constant drift that let the daily
// pool go stale. Duel is unlimited-within-timer and doesn't use this.
export const MAX_GUESSES = 6;
