import { useState, type JSX } from "react";

function RepeatedCard({ product }: { readonly product: number }): JSX.Element {
  return (
    <article id="repeated-card" data-testid="repeated-card" className="fixture-card">
      <h3>Product {product}</h3>
      <div>
        <button data-testid="repeated-edit" type="button">
          Edit
        </button>
      </div>
    </article>
  );
}

export function RepeatedCardsFixture(): JSX.Element {
  const [reversed, setReversed] = useState(false);
  const [replacement, setReplacement] = useState(false);
  const products = Array.from({ length: 20 }, (_, index) => index + 1);
  if (reversed) products.reverse();
  return (
    <section data-testid="repeated-cards">
      <h2>Repeated component instances</h2>
      <button
        type="button"
        onClick={() => {
          setReversed((value) => !value);
        }}
      >
        Reverse cards
      </button>
      <button
        type="button"
        onClick={() => {
          setReplacement(true);
        }}
      >
        Recycle product 3
      </button>
      <div className="fixture-grid">
        {products.map((product) => (
          <RepeatedCard
            key={product}
            product={product === 3 && replacement ? 103 : product}
          />
        ))}
      </div>
    </section>
  );
}
