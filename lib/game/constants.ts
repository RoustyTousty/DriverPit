// Single source of truth for guess limits -- daily and infinite both used to
// declare their own local `MAX_GUESSES = 5` copies (five separate places),
// which is exactly the kind of duplicated-constant drift that let the daily
// pool go stale. Duel is unlimited-within-timer and doesn't use this.
//
// It is still mirrored in plpgsql, which can't import it: daily_state
// (drizzle/0031) and daily_submit_guess (drizzle/0044) as `v_max`,
// infinite_submit_guess (drizzle/0044) as two bare literals. Changing this
// number alone gives the board more rows than the server will accept.
// `poolWindow.sqlParity.test.ts` (database CI tier) pins all three to this file.
export const MAX_GUESSES = 6;
