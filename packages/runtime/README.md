# @spotpatch/runtime

The browser-only SpotPatch runtime containing the element picker, bounded DOM
and CSS collectors, localized Shadow DOM workbench, and prompt composer.

Applications should install and configure
[`@spotpatch/vite`](https://www.npmjs.com/package/@spotpatch/vite). The Vite
plugin injects this runtime only during development and verifies that it is
absent from production output.
