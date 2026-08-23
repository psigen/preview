/**
 * Prettier owns formatting. Everything here is a default except two settings, each recorded
 * with the reason it earns an exception — anything not listed is deliberately left alone.
 *
 * @type {import('prettier').Config}
 */
export default {
  /**
   * Default is double quotes. This repo and the sister app it mirrors are unanimously single
   * quoted — 361 import statements here and 39 in videoclip, none double — so the default
   * would churn every file and diverge the two codebases for no gain.
   */
  singleQuote: true,

  /**
   * Default is 80. The code is written to 100 and reads that way: at 80, over 1,100 lines in
   * src alone reflow, and the explanatory comments this project leans on end up as narrow
   * ragged columns. 100 matches both how it was written and videoclip's own convention.
   */
  printWidth: 100,
};
