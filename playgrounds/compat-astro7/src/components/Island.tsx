import { useState } from "react";

export default function Island() {
  const [count, setCount] = useState(0);
  async function load() {
    const response = await fetch("/models/api/data.json?island=private");
    if (response.ok) setCount((value) => value + 1);
  }
  return (
    <button
      id="island"
      onClick={() => {
        void load();
      }}
    >
      Island {count}
    </button>
  );
}
