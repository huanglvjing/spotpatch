import { ClientProbe } from "./components/client-probe";
import { ServerProbe } from "./components/server-probe";

export default function HomePage() {
  const heading = "SpotPatch Next Loader POC";

  return (
    <main data-spotpatch-loader-probe="inactive">
      <h1>{heading}</h1>
      <ServerProbe />
      <ClientProbe />
    </main>
  );
}
