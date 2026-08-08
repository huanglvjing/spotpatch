export function ServerProbe() {
  const runtime = "node";

  return (
    <article data-spotpatch-loader-probe="inactive" data-runtime={runtime}>
      Server Component marker
    </article>
  );
}
