import {
  bootstrapSpotPatch,
  type RuntimeConfig,
  type SpotPatchController,
} from "@spotpatch/runtime";

declare const __SPOTPATCH_ASTRO_CONFIG__: Extract<
  RuntimeConfig,
  { framework: "astro" }
>;

let controller: SpotPatchController | undefined;
function unmount(): void {
  controller?.dispose();
  controller = undefined;
}
function mount(): void {
  controller ??= bootstrapSpotPatch(__SPOTPATCH_ASTRO_CONFIG__);
}
document.addEventListener("astro:before-swap", unmount);
document.addEventListener("astro:page-load", mount);
mount();
import.meta.hot?.dispose(() => {
  document.removeEventListener("astro:before-swap", unmount);
  document.removeEventListener("astro:page-load", mount);
  unmount();
});
