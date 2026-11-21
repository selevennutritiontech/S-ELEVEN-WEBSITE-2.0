/* Eleven AI settings.
   AI_ENDPOINT: the address of your assistant Worker (see backend/assistant-worker.js), e.g.
     'https://seleven-assistant.s-eleventech.workers.dev/assistant'
   Leave it empty and Eleven runs in OFFLINE mode (built-in rules: orders, prices, offers, add-to-cart). */
/* REQUIRE_2FA: false = staff sign in with user ID and password only (current setting).
   Set it to true to bring back the Google Authenticator code at sign-in (the code is still in js/auth.js). */
/* CLEAN_START_ID: the first time this version opens in a browser it ERASES the old sample data in that browser once and starts from zero (only the Host login remains).
   Change this value to wipe again on the next open. The erase and sample-data buttons have been removed permanently. */
window.SEL_CONFIG = { AI_ENDPOINT: '', REQUIRE_2FA: false, CLEAN_START_ID: '2026-10-24-zero' };
