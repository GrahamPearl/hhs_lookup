/* namespace.js
   Creates the single shared namespace every other seating-plan module attaches
   to. Load this file FIRST, before any other js/seating/*.js file.

   Why a namespace object instead of ES modules? This page (and the rest of the
   site) is served as plain static files with classic <script src="..."> tags —
   no bundler, and potentially opened straight off disk in some environments —
   so `type="module"` (with its stricter CORS/file:// rules) was avoided in
   favour of a pattern that behaves identically to the original single-file
   version. Each feature module below wraps itself in an IIFE and attaches its
   public functions to `Seating.<moduleName>`, keeping the global scope to a
   single `Seating` variable while still giving each concern its own file. */
window.Seating = window.Seating || {};
