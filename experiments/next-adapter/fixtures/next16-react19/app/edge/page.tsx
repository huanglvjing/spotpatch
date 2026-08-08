export const runtime = "edge";

export default function EdgePage() {
  const runtimeName = "edge";

  return (
    <main data-spotpatch-loader-probe="inactive" data-runtime={runtimeName}>
      Edge marker
    </main>
  );
}
